/**
 * MixingPlanPrintPage — plan dnia masowania do druku dla operatora.
 *
 * Na mieszaniu nie ma jeszcze monitora — planista drukuje kartkę:
 *   1. kolejka pozycji (receptura, kg mięsa, partie z kg, rodzaj, dostawca),
 *   2. przyprawy ŁĄCZNIE na cały plan (ile operator musi przygotować),
 *   3. przepis każdej receptury przeliczony na wsady 200 kg i 600 kg
 *      (rozmiary masownic) — bez liczenia na kartce.
 *
 * Samodzielna strona (bez sidebara, wzór DeboningReportPrintPage):
 * /office/plan-masowania/druk — auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mixingOrdersApi, meatStockApi, recipesApi } from '@/lib/apiClient'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

// Wsady masownic w zakładzie — kolumny przepisu na wydruku.
const MACHINE_BATCHES_KG = [200, 600]

const S = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24, background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 12 } as const,
  h1: { fontSize: 20, fontWeight: 800, letterSpacing: 0.5, margin: 0 } as const,
  section: { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.6, margin: '18px 0 6px', borderBottom: '2px solid #111', paddingBottom: 3 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11.5 },
  th: { border: '1px solid #bfbfbf', background: '#efefef', padding: '4px 6px',
    fontSize: 10, textTransform: 'uppercase' as const, fontWeight: 700, textAlign: 'center' as const },
  td: { border: '1px solid #bfbfbf', padding: '3.5px 6px', textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  tdL: { border: '1px solid #bfbfbf', padding: '3.5px 6px', textAlign: 'left' as const },
  tdR: { border: '1px solid #bfbfbf', padding: '3.5px 6px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
}

const STATUS_PL: Record<string, string> = {
  planned: 'w kolejce', confirmed: 'w kolejce',
  in_progress: 'W MASOWNICY', done: 'gotowe',
}

export function MixingPlanPrintPage() {
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const [plan, setPlan] = useState<any[] | null>(null)
  const [recipes, setRecipes] = useState<any[]>([])
  const [meat, setMeat] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      mixingOrdersApi.dayPlan(),
      (recipesApi as any).list(),
      meatStockApi.list(),
    ]).then(([p, r, m]) => {
      setPlan(p.items ?? [])
      setRecipes(Array.isArray(r) ? r : (r as any)?.data ?? [])
      setMeat((m as any)?.data ?? [])
    }).catch(() => setPlan([]))
  }, [])

  useEffect(() => {
    if (plan && plan.length > 0 && !isPdf) setTimeout(() => window.print(), 400)
  }, [plan, isPdf])

  const meatById = useMemo(() => new Map(meat.map((m: any) => [m.id, m])), [meat])
  const recipeById = useMemo(() => new Map(recipes.map((r: any) => [r.id, r])), [recipes])

  // Przyprawy ŁĄCZNIE na cały plan (dawka/100 kg × kg mięsa pozycji).
  const spiceTotals = useMemo(() => {
    const acc = new Map<string, { name: string; unit: string; qty: number; isUnlimited: boolean }>()
    for (const o of plan ?? []) {
      const rec: any = recipeById.get(o.recipeId)
      if (!rec || !o.meatKg) continue
      for (const ri of rec.ingredients ?? []) {
        const cur = acc.get(ri.ingredientId) ?? {
          name: ri.ingredientName, unit: ri.unit, qty: 0, isUnlimited: !!ri.isUnlimited,
        }
        cur.qty += (ri.qtyPer100kg * o.meatKg) / 100
        acc.set(ri.ingredientId, cur)
      }
    }
    return [...acc.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [plan, recipeById])

  // Receptury użyte w planie (w kolejności pierwszego wystąpienia) + suma kg.
  const usedRecipes = useMemo(() => {
    const out: { recipe: any; planKg: number }[] = []
    for (const o of plan ?? []) {
      const rec: any = recipeById.get(o.recipeId)
      if (!rec) continue
      const found = out.find(x => x.recipe.id === rec.id)
      if (found) found.planKg += o.meatKg
      else out.push({ recipe: rec, planKg: o.meatKg })
    }
    return out
  }, [plan, recipeById])

  if (!plan) return <div style={{ padding: 24 }}>Ładowanie…</div>
  if (plan.length === 0) return <div style={{ padding: 24 }}>Brak planu masowania na dziś.</div>

  const today = new Date().toISOString().slice(0, 10)
  const totalMeat = plan.reduce((s, o) => s + (o.meatKg || 0), 0)
  const totalOutput = plan.reduce((s, o) => s + (o.plannedOutputKg || 0), 0)

  return (
    <div style={S.page}>
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm } }`}</style>

      {/* ── Nagłówek ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '3px solid #111', paddingBottom: 10, marginBottom: 6 }}>
        <div>
          <h1 style={S.h1}>PLAN MASOWANIA</h1>
          <div style={{ fontSize: 12, color: '#444' }}>dzień: <b>{fmtD(today)}</b></div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#555' }}>
          wydrukowano {new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
          <div style={{ fontSize: 13, color: '#111', marginTop: 2 }}>
            mięso: <b>{nf0.format(totalMeat)} kg</b>
            {totalOutput > 0 && <> → półprodukt: <b>{nf0.format(totalOutput)} kg</b></>}
          </div>
        </div>
      </div>

      {/* ── 1. Kolejka pozycji ── */}
      <div style={S.section}>Kolejka masowania</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: 26 }}>Lp</th>
            <th style={S.th}>Receptura</th>
            <th style={{ ...S.th, width: 70 }}>Mięso [kg]</th>
            <th style={S.th}>Partie mięsa (nr · kg · rodzaj · dostawca)</th>
            <th style={{ ...S.th, width: 80 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((o: any, i: number) => (
            <tr key={o.id}>
              <td style={S.td}><b>{i + 1}</b></td>
              <td style={{ ...S.tdL, fontWeight: 700 }}>{o.recipeName || '—'}</td>
              <td style={{ ...S.tdR, fontWeight: 700 }}>{nf0.format(o.meatKg)}</td>
              <td style={S.tdL}>
                {(o.meatLots ?? []).map((l: any, j: number) => {
                  const ms: any = meatById.get(l.meatLotId)
                  const parts = [
                    `${l.meatLotNo || ms?.lotNo || '?'} · ${nf0.format(l.kgPlanned)} kg`,
                    ms?.materialName || 'Mięso z/s',
                    ms?.supplierName,
                  ].filter(Boolean)
                  return <div key={j} style={{ whiteSpace: 'nowrap' }}>{parts.join(' · ')}</div>
                })}
              </td>
              <td style={S.td}>{STATUS_PL[o.status] ?? o.status}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...S.tdL, fontWeight: 800, background: '#efefef' }} colSpan={2}>RAZEM</td>
            <td style={{ ...S.tdR, fontWeight: 800, background: '#efefef' }}>{nf0.format(totalMeat)}</td>
            <td style={{ ...S.td, background: '#efefef' }} colSpan={2} />
          </tr>
        </tbody>
      </table>

      {/* ── 2. Przyprawy łącznie ── */}
      <div style={S.section}>Przyprawy i dodatki — łącznie na cały plan</div>
      {spiceTotals.length === 0 ? (
        <div style={{ fontSize: 11, color: '#555' }}>Receptury planu nie mają składników.</div>
      ) : (
        <table style={{ ...S.table, maxWidth: 460 }}>
          <thead>
            <tr>
              <th style={S.th}>Składnik</th>
              <th style={{ ...S.th, width: 110 }}>Do przygotowania</th>
            </tr>
          </thead>
          <tbody>
            {spiceTotals.map(s => (
              <tr key={s.name}>
                <td style={{ ...S.tdL, color: s.isUnlimited ? '#666' : '#111' }}>
                  {s.name}{s.isUnlimited ? ' (bez limitu)' : ''}
                </td>
                <td style={{ ...S.tdR, fontWeight: 700 }}>{nf2.format(s.qty)} {s.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── 3. Przepisy na wsady maszyn ── */}
      {usedRecipes.map(({ recipe, planKg }) => {
        const ings: any[] = recipe.ingredients ?? []
        const outFor = (kg: number) =>
          kg + ings
            .filter(ri => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
            .reduce((s, ri) => s + (ri.qtyPer100kg * kg) / 100, 0)
        return (
          <div key={recipe.id} style={{ pageBreakInside: 'avoid' as const }}>
            <div style={S.section}>
              Przepis — {recipe.name}
              <span style={{ float: 'right', fontWeight: 700, textTransform: 'none' }}>
                w planie: {nf0.format(planKg)} kg mięsa
              </span>
            </div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Składnik</th>
                  {MACHINE_BATCHES_KG.map(kg => (
                    <th key={kg} style={{ ...S.th, width: 120 }}>Wsad {kg} kg mięsa</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ings.map((ri: any) => (
                  <tr key={ri.ingredientId}>
                    <td style={S.tdL}>{ri.ingredientName}</td>
                    {MACHINE_BATCHES_KG.map(kg => (
                      <td key={kg} style={{ ...S.tdR, fontWeight: 700 }}>
                        {nf2.format((ri.qtyPer100kg * kg) / 100)} {ri.unit}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...S.tdL, fontWeight: 800, background: '#efefef' }}>PÓŁPRODUKT ŁĄCZNIE</td>
                  {MACHINE_BATCHES_KG.map(kg => (
                    <td key={kg} style={{ ...S.tdR, fontWeight: 800, background: '#efefef' }}>
                      {nf1.format(outFor(kg))} kg
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}

      <div style={{ marginTop: 18, fontSize: 10, color: '#777', borderTop: '1px solid #bbb', paddingTop: 6 }}>
        Kolejność pozycji = kolejność masowania. Dawki przepisów podane na wsad mięsa 200 / 600 kg —
        przy innym wsadzie licz proporcjonalnie. Wygenerowano z planu dnia w Kebab MES.
      </div>
    </div>
  )
}
