import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi, finishedGoodsApi,
  deboningApi, productionSessionsApi,
} from '@/lib/apiClient'
import { computeDisplayStatus } from '@/components/ui/badge'
import { getExpiryStatus, todayIso, fmtDatePl } from '@/lib/utils'

const POLL_MS = 7000
export const KG_PER_CONTAINER = 15

export const PROCESS_LABEL: Record<string, string> = {
  deboning: 'Rozbiór', mixing: 'Masowanie', production: 'Produkcja',
}
export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: 'Szkic', confirmed: 'Potwierdzone', in_production: 'W produkcji',
  done: 'Zrealizowane', cancelled: 'Anulowane',
}

/**
 * Współdzielony hook danych pulpitu biura — całe pobieranie + derywacje
 * w jednym miejscu, żeby warstwa prezentacji (DashboardV2Page) była czysta.
 * Live-polling co POLL_MS. Nie modyfikuje istniejącego DashboardPage.
 */
export function useDashboardData() {
  const batchRes    = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const meatRes     = useApi(() => meatStockApi.list())
  const seasonedRes = useApi(() => seasonedMeatApi.list())
  const plansRes    = useApi(() => productionPlansApi.list())
  const mixingRes   = useApi(() => mixingOrdersApi.list())
  const ordersRes   = useApi(() => clientOrdersApi.list())
  const finishedRes = useApi(() => finishedGoodsApi.list())
  const deboningRes = useApi(() => deboningApi.list())
  const pendingRes  = useApi(() => productionSessionsApi.pending())

  const refetchAll = useCallback(() => {
    batchRes.refetch(); meatRes.refetch(); seasonedRes.refetch()
    plansRes.refetch(); mixingRes.refetch(); ordersRes.refetch()
    finishedRes.refetch(); deboningRes.refetch(); pendingRes.refetch()
  }, [batchRes.refetch, meatRes.refetch, seasonedRes.refetch,
      plansRes.refetch, mixingRes.refetch, ordersRes.refetch,
      finishedRes.refetch, deboningRes.refetch, pendingRes.refetch])

  useEffect(() => {
    const t = setInterval(refetchAll, POLL_MS)
    return () => clearInterval(t)
  }, [refetchAll])

  const initialLoading =
    (batchRes.loading    && !batchRes.data) ||
    (meatRes.loading     && !meatRes.data)  ||
    (seasonedRes.loading && !seasonedRes.data)

  const allBatches  = batchRes.data?.data    ?? []
  const allMeat     = meatRes.data?.data     ?? []
  const allSeasoned = seasonedRes.data       ?? []
  const allPlans    = plansRes.data          ?? []
  const allMixing   = mixingRes.data         ?? []
  const allOrders   = ordersRes.data         ?? []
  const allFinished = finishedRes.data       ?? []
  const allDeboning = deboningRes.data?.data ?? []
  const pendingSessions = (pendingRes.data ?? []) as any[]

  const today = todayIso()

  // ── Rozbiór dziś ────────────────────────────────────────────────
  const todayDeb = useMemo(
    () => [...allDeboning]
      .filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today)
      .sort((a: any, b: any) =>
        ((b.createdAt ?? b.created_at ?? '') > (a.createdAt ?? a.created_at ?? '')) ? 1 : -1),
    [allDeboning, today],
  )
  const debKgQuarter = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)
  const debKgMeat    = todayDeb.reduce((s: number, d: any) => s + Number(d.kgMeat ?? d.kg_meat ?? 0), 0)
  const debYield     = debKgQuarter > 0 ? (debKgMeat / debKgQuarter) * 100 : 0

  // ── KPI: ćwiartka ───────────────────────────────────────────────
  const activeBatches = allBatches.filter(
    (b: any) => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const totalKgRaw      = activeBatches.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)
  const totalContainers = Math.ceil(totalKgRaw / KG_PER_CONTAINER)

  // ── Mięso z/s po rozbiorze, grupowane po partii surowca ─────────
  const availableMeat = allMeat.filter((m: any) => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat   = availableMeat.reduce((s: number, m: any) => s + Number(m.kgAvailable), 0)
  const meatByBatch = useMemo(() => {
    const m = new Map<string, { rawBatchNo: string; kg: number; lots: number; earliestExpiry: string }>()
    availableMeat.forEach((item: any) => {
      const key = item.rawBatchNo ?? '—'
      const cur = m.get(key)
      if (cur) {
        cur.kg += Number(item.kgAvailable); cur.lots += 1
        if (item.expiryDate && (!cur.earliestExpiry || item.expiryDate < cur.earliestExpiry)) cur.earliestExpiry = item.expiryDate
      } else {
        m.set(key, { rawBatchNo: key, kg: Number(item.kgAvailable), lots: 1, earliestExpiry: item.expiryDate ?? '' })
      }
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableMeat])

  // ── Mięso przyprawione, grupowane po recepturze ─────────────────
  const availableSeasoned = allSeasoned.filter((s: any) => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s: number, b: any) => s + Number(b.kgAvailable), 0)
  const seasonedByRecipe = useMemo(() => {
    const m = new Map<string, { recipeName: string; kg: number; batches: number }>()
    availableSeasoned.forEach((b: any) => {
      const key = b.recipeName || '—'
      const cur = m.get(key)
      if (cur) { cur.kg += Number(b.kgAvailable); cur.batches += 1 }
      else m.set(key, { recipeName: key, kg: Number(b.kgAvailable), batches: 1 })
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableSeasoned])

  // ── Krótki termin ───────────────────────────────────────────────
  const expired  = activeBatches.filter((b: any) => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter((b: any) => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })
  const shortTermCount = expired.length + critical.length + warnings.length

  // ── Produkcja live ──────────────────────────────────────────────
  const activePlans = allPlans.filter((p: any) => p.status === 'active')
  const plansToConfirm = activePlans.filter((p: any) => p.tabletFinishedAt && !p.officeConfirmedAt)
  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => { const k = f.planNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0)) })
    return m
  }, [allFinished])
  const producedKgForPlan = useCallback((p: any) => {
    const finished = finishedKgByPlan.get(p.planNo) ?? 0
    const inProgress = (p.lines ?? []).reduce((s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0), 0)
    return finished + inProgress
  }, [finishedKgByPlan])
  const prodPlanned  = activePlans.reduce((s: number, p: any) => s + Number(p.totalKg), 0)
  const prodProduced = activePlans.reduce((s: number, p: any) => s + producedKgForPlan(p), 0)
  const prodPct      = prodPlanned > 0 ? (prodProduced / prodPlanned) * 100 : 0

  // ── Masowanie live ──────────────────────────────────────────────
  const activeMixing = allMixing.filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
  const mixPlanned   = activeMixing.reduce((s: number, o: any) => s + Number(o.meatKg), 0)
  const mixDone      = activeMixing.reduce((s: number, o: any) => s + Number(o.kgDone), 0)
  const mixPct       = mixPlanned > 0 ? (mixDone / mixPlanned) * 100 : 0

  // ── Zamówienia ──────────────────────────────────────────────────
  const finishedQtyByOrderNo = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => { const k = f.clientOrderNo ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + Number(f.qty ?? 0)) })
    return m
  }, [allFinished])
  const inProgressQtyByOrderId = useMemo(() => {
    const byOrder = new Map<string, number>()
    for (const p of activePlans) for (const l of (p.lines ?? [])) {
      const orderId = (l as any).clientOrderId || ''
      const qtyDone = Number((l as any).qtyDone) || 0
      if (qtyDone > 0 && orderId) byOrder.set(orderId, (byOrder.get(orderId) ?? 0) + qtyDone)
    }
    return byOrder
  }, [activePlans])
  const visibleOrders = useMemo(() =>
    [...allOrders]
      .filter((o: any) => o.status !== 'done' && o.status !== 'cancelled')
      .sort((a: any, b: any) => (a.deliveryDate || '9999-12-31').localeCompare(b.deliveryDate || '9999-12-31')),
    [allOrders])

  // ── Live? ───────────────────────────────────────────────────────
  const debLive  = todayDeb.length > 0
  const mixLive  = activeMixing.some((o: any) => o.status === 'in_progress')
  const prodLive = activePlans.some((p: any) => (p.lines ?? []).some((l: any) => (l.lineStatus ?? '') === 'IN_PROGRESS'))
  const live = debLive || mixLive || prodLive

  // ── Akcje: potwierdzenia ────────────────────────────────────────
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null)
  const approvePendingSession = useCallback(async (s: any) => {
    if (!confirm(`Potwierdzić zakończenie: ${PROCESS_LABEL[s.processType] ?? s.processType} z dnia ${fmtDatePl(s.sessionDate)}?`)) return
    setConfirmBusy(s.id)
    try { await productionSessionsApi.approve(s.id, { approvedBy: 'office' }); pendingRes.refetch() }
    catch (e) { alert(e instanceof Error ? e.message : 'Błąd potwierdzania') }
    finally { setConfirmBusy(null) }
  }, [pendingRes])
  const confirmPlanFinish = useCallback(async (p: any) => {
    if (!confirm(`Potwierdzić zakończenie planu ${p.planNo}? Kebab trafi do magazynu wyrobów gotowych.`)) return
    setConfirmBusy(p.id)
    try { await productionPlansApi.officeConfirm(p.id); plansRes.refetch() }
    catch (e) { alert(e instanceof Error ? e.message : 'Błąd potwierdzania') }
    finally { setConfirmBusy(null) }
  }, [plansRes])

  return {
    initialLoading, live, today,
    // KPI
    totalKgRaw, totalContainers, activeBatchesCount: activeBatches.length,
    totalKgMeat, meatPartiesCount: meatByBatch.length,
    totalKgSeasoned, seasonedRecipesCount: seasonedByRecipe.length,
    shortTermCount, expired, critical, warnings,
    // procesy
    todayDeb, debKgQuarter, debKgMeat, debYield, debLive,
    mixPlanned, mixDone, mixPct, mixLive, activeMixingCount: activeMixing.length,
    prodPlanned, prodProduced, prodPct, prodLive, activePlansCount: activePlans.length,
    // listy
    meatByBatch, seasonedByRecipe, visibleOrders,
    finishedQtyByOrderNo, inProgressQtyByOrderId,
    // potwierdzenia
    pendingSessions, plansToConfirm, confirmBusy,
    approvePendingSession, confirmPlanFinish,
    refetchAll,
  }
}

export type DashboardData = ReturnType<typeof useDashboardData>
