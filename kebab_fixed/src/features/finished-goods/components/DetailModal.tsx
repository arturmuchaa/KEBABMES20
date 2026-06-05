/**
 * DetailModal — szczegóły SKU (wyrób gotowy) z rozbiciem wg partii
 * + pełny łańcuch traceability per partia (accordion).
 *
 * Props: group: SkuGroup (zamiast pojedynczego FinishedGoodsItem).
 */
import { useState, useEffect } from 'react'
import { traceabilityApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { useClientNames } from '@/lib/clientNames'
import { GitBranch, Beef, Scissors, FlaskConical, Package2, ChevronRight } from 'lucide-react'
import type { SkuGroup } from '@/pages/office/FinishedGoodsPage'

import {
  CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

// ─── Task 4: dedupe + sort batch arrays in traceability steps ─────────────────
function uniqSortBatches(batches: { partia: string; sub?: string | null }[]) {
  const seen = new Set<string>()
  const out: { partia: string; sub?: string | null }[] = []
  for (const b of batches) {
    const k = b.partia || ''
    if (k && seen.has(k)) continue
    seen.add(k)
    out.push(b)
  }
  return out.sort((a, b) => (a.partia || '').localeCompare(b.partia || '', undefined, { numeric: true }))
}

// ─── Step card w łańcuchu traceability ───────────────────────
type StepConfig = {
  stepNo: number
  icon: React.ReactNode
  label: string
  accentBg: string
  accentBorder: string
  accentText: string
  badgeBg: string
  batches: { partia: string; sub?: string | null }[]
}

function TraceStep({ cfg }: { cfg: StepConfig }) {
  const isEmpty = cfg.batches.length === 0
  return (
    <div className="flex-1 min-w-[148px] max-w-[220px]">
      {/* header */}
      <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-lg border-b', cfg.accentBg, cfg.accentBorder)}>
        <span className={cn('shrink-0', cfg.accentText)}>{cfg.icon}</span>
        <div className="flex flex-col leading-none">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
            krok {cfg.stepNo}
          </span>
          <span className={cn('text-[11px] font-bold leading-tight', cfg.accentText)}>{cfg.label}</span>
        </div>
      </div>
      {/* body */}
      <div className={cn('rounded-b-lg border border-t-0 divide-y', cfg.accentBorder)}>
        {isEmpty ? (
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground italic">brak</div>
        ) : (
          cfg.batches.map((b, i) => (
            <div key={i} className="px-2.5 py-2 bg-white first:rounded-none last:rounded-b-lg">
              <div className="flex items-baseline gap-1.5">
                <span className={cn('text-[9px] font-bold uppercase tracking-wider', cfg.accentText, 'opacity-60')}>partia</span>
              </div>
              <code className={cn(
                'font-mono font-bold text-sm tracking-tight block leading-tight mt-0.5',
                cfg.accentText,
              )}>
                {b.partia || '—'}
              </code>
              {b.sub && (
                <div className="text-[10px] text-muted-foreground mt-1 leading-snug">{b.sub}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Arrow() {
  return (
    <div className="self-center shrink-0 flex flex-col items-center gap-0.5 text-slate-300 px-0.5">
      <div className="w-6 h-px bg-slate-300" />
      <svg width="7" height="8" viewBox="0 0 7 8" fill="none" className="text-slate-300 -mt-1.5 ml-5">
        <path d="M0 0L7 4L0 8V0Z" fill="currentColor"/>
      </svg>
    </div>
  )
}

export function LineageChain({ batchId }: { batchId: string }) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    traceabilityApi.backward(batchId)
      .then(r => { if (!cancelled) { setData(r); setError(null); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Błąd ładowania'); setLoading(false) } })
    return () => { cancelled = true }
  }, [batchId])

  if (loading) return <CardDescription className="text-xs italic animate-pulse">Wczytuję łańcuch partii…</CardDescription>
  if (error) return <CardDescription className="text-xs text-red-600">Błąd: {error}</CardDescription>
  if (!data) return null

  const rawBatches: any[]      = data.rawBatches      ?? []
  const deboning: any[]        = data.deboning        ?? []
  const mixingOrders: any[]    = data.mixingOrders    ?? []
  const seasonedBatches: any[] = data.seasonedBatches ?? []
  const suppliers: any[]       = data.suppliers       ?? []

  // Build supplier lookup by raw batch id
  const supplierByBatch = new Map<string, string>()
  rawBatches.forEach((rb: any) => {
    const sup = suppliers.find((s: any) => s.id === rb.supplier_id)
    if (sup) supplierByBatch.set(rb.id, sup.display_name || sup.name || '')
  })

  // Build mixing order lookup by order_no → recipe_name
  const recipeByOrderNo = new Map<string, string>()
  mixingOrders.forEach((mo: any) => {
    if (mo.order_no && mo.recipe_name) recipeByOrderNo.set(mo.order_no, mo.recipe_name)
  })

  // ── Krok 1: Surowiec (ćwiartka) ──────────────────────────
  const step1: StepConfig = {
    stepNo: 1,
    icon: <Beef size={12} />,
    label: 'Surowiec (ćwiartka)',
    accentBg: 'bg-sky-50',
    accentBorder: 'border-sky-200',
    accentText: 'text-sky-700',
    badgeBg: 'bg-sky-100',
    batches: uniqSortBatches(rawBatches.map(rb => ({
      partia: rb.internal_batch_no || rb.id?.slice(0, 8) || '—',
      sub: supplierByBatch.get(rb.id) || rb.supplier_name || null,
    }))),
  }

  // ── Krok 2: Rozbiór ───────────────────────────────────────
  const step2: StepConfig = {
    stepNo: 2,
    icon: <Scissors size={12} />,
    label: 'Rozbiór',
    accentBg: 'bg-emerald-50',
    accentBorder: 'border-emerald-200',
    accentText: 'text-emerald-700',
    badgeBg: 'bg-emerald-100',
    batches: uniqSortBatches(deboning.map(d => {
      const kg = Number(d.kgMeat ?? d.kg_meat ?? 0)
      return {
        partia: d.rawBatchNo || d.raw_batch_no || d.meatLotNo || d.meat_lot_no || d.id?.slice(0, 8) || '—',
        sub: kg > 0 ? `${fmtKg(kg, 1)} kg mięsa` : null,
      }
    })),
  }

  // ── Krok 3: Masowanie (scalony z mięsem przyprawionym) ────
  const step3: StepConfig = {
    stepNo: 3,
    icon: <FlaskConical size={12} />,
    label: 'Masowanie',
    accentBg: 'bg-violet-50',
    accentBorder: 'border-violet-200',
    accentText: 'text-violet-700',
    badgeBg: 'bg-violet-100',
    batches: uniqSortBatches(
      seasonedBatches.length > 0
        ? seasonedBatches.map(sm => {
            const kg = Number(sm.kg_produced ?? 0)
            const orderNo = sm.mixing_order_no || ''
            const recipe = recipeByOrderNo.get(orderNo) || ''
            const subParts: string[] = []
            if (orderNo) subParts.push(`zlec. ${orderNo}`)
            if (recipe) subParts.push(recipe)
            if (kg > 0) subParts.push(`${fmtKg(kg, 1)} kg`)
            return {
              partia: sm.batch_no || sm.id?.slice(0, 8) || '—',
              sub: subParts.length > 0 ? subParts.join(' · ') : null,
            }
          })
        : mixingOrders.map(mo => ({
            partia: '—',
            sub: `zlec. ${mo.order_no || ''}${mo.recipe_name ? ' · ' + mo.recipe_name : ''}`,
          }))
    ),
  }

  // ── Krok 4: Wyrób gotowy (bez dedupu — ta partia jest konkretna) ──
  const finishedBatchNo = (data.finishedGoods ?? [])[0]?.batch_no || batchId
  const step4: StepConfig = {
    stepNo: 4,
    icon: <Package2 size={12} />,
    label: 'Wyrób gotowy',
    accentBg: 'bg-amber-50',
    accentBorder: 'border-amber-300',
    accentText: 'text-amber-700',
    badgeBg: 'bg-amber-100',
    batches: [{ partia: finishedBatchNo, sub: null }],
  }

  const steps = [step1, step2, step3, step4]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <GitBranch size={13} className="text-primary"/>
        <CardDescription className="text-[10px] font-bold uppercase tracking-wider">
          Pełny łańcuch partii (traceability)
        </CardDescription>
      </div>
      <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3">
        <div className="flex flex-wrap gap-0 items-start">
          {steps.map((cfg, idx) => (
            <div key={cfg.stepNo} className="flex items-start">
              <TraceStep cfg={cfg} />
              {idx < steps.length - 1 && <Arrow />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DetailModal({ group, onClose }: { group: SkuGroup; onClose: () => void }) {
  const clientDisplay = useClientNames()
  const [openId, setOpenId] = useState<string | null>(
    group.batches.length === 1 ? group.batches[0].id : null
  )
  const workers = Array.from(new Set(group.batches.flatMap(b => b.producedBy ?? [])))

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {group.productTypeName} · {group.clientName ? clientDisplay(group.clientName) : '—'} · {group.kgPerUnit}KG
          </DialogTitle>
          <DialogDescription>
            {group.qty} szt · {fmtKg(group.totalKg)} kg · {group.batches.length} {group.batches.length === 1 ? 'partia' : 'partie/partii'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Receptura', val: group.recipeName || '—' },
              { label: 'Tuleja',    val: group.packagingName || '—' },
              { label: 'Klient',    val: group.clientName ? clientDisplay(group.clientName) : '—' },
              { label: 'Łącznie',   val: `${group.qty} szt · ${fmtKg(group.totalKg)} kg` },
            ].map(r => (
              <div key={r.label}>
                <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{r.label}</CardDescription>
                <CardTitle className="text-sm font-semibold">{r.val}</CardTitle>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <CardDescription className="text-[10px] font-bold uppercase tracking-wider">
              Skład wg partii ({group.batches.length})
            </CardDescription>
            <div className="space-y-2">
              {group.batches.map(b => {
                const open = openId === b.id
                const bKg = (b.qtyAvailable ?? b.qty) * b.kgPerUnit
                return (
                  <div key={b.id} className="rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      onClick={() => setOpenId(open ? null : b.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-slate-50/70 transition-colors text-left"
                    >
                      <span className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-90')}>
                        <ChevronRight size={15} />
                      </span>
                      <code className="font-mono font-bold text-sm tracking-tight text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        {b.batchNo || '—'}
                      </code>
                      <span className="font-bold text-sm tabular-nums">
                        {b.qtyAvailable ?? b.qty}
                        <span className="text-muted-foreground font-normal text-xs"> szt</span>
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs tabular-nums text-ink-2">{fmtKg(bKg)} kg</span>
                      <span className="ml-auto text-[11px] text-muted-foreground">{fmtDatePl(b.producedDate)}</span>
                    </button>
                    {open && (
                      <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/40">
                        <LineageChain batchId={b.id} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {workers.length > 0 && (
            <div className="space-y-1">
              <CardDescription className="text-[10px] font-bold uppercase">Pracownicy</CardDescription>
              <CardTitle className="text-sm font-medium">{workers.join(', ')}</CardTitle>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
