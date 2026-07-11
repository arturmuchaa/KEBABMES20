/**
 * MixingPlanPrintPage — plan dnia masowania do druku dla operatora.
 *
 * Na mieszaniu nie ma jeszcze monitora — planista drukuje kartkę:
 *   1. kolejka pozycji (receptura, kg mięsa, partie z kg, rodzaj, dostawca),
 *   2. przepis każdej receptury przeliczony na wsady 200 kg i 600 kg
 *      (rozmiary masownic) — bez liczenia na kartce,
 *   3. mała tabelka na końcu: przyprawy ŁĄCZNIE do przygotowania na cały plan.
 * Layout kompaktowy — całość ma zmieścić się na jednej stronie A4.
 *
 * Partia i dostawca partii mięsa idą WPROST z /mixing-orders/day-plan
 * (mixing_service.build_mixing_order robi własny JOIN meat_stock→raw_batches
 * →suppliers). Świadomie NIE korzystamy z meatStockApi.list() — ta lista
 * filtruje partie z wolnym stanem > 0, więc partia w pełni zarezerwowana
 * pod dzisiejszy plan (częsty przypadek — np. cały wolny kg wykorzystany)
 * znika z niej i dostawca/rodzaj by nie wyświetlił się na wydruku.
 *
 * Samodzielna strona (bez sidebara, wzór DeboningReportPrintPage):
 * /office/plan-masowania/druk — auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { mixingOrdersApi, recipesApi } from '@/lib/apiClient'
import { buildLotRows } from '@/lib/mixingPlanPrint'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

// Wsady masownic w zakładzie — kolumny przepisu na wydruku.
const MACHINE_BATCHES_KG = [200, 600]

// Layout ściśnięty celowo — cel: 1 strona A4 nawet przy 4-5 recepturach.
const S = {
  page: { maxWidth: 800, margin: '0 auto', padding: '10px 20px', background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11 } as const,
  h1: { fontSize: 17, fontWeight: 800, letterSpacing: 0.4, margin: 0 } as const,
  section: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, margin: '6px 0 2px', borderBottom: '1.5px solid #111', paddingBottom: 2 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  th: { border: '1px solid #bfbfbf', background: '#efefef', padding: '1px 4px',
    fontSize: 8.5, textTransform: 'uppercase' as const, fontWeight: 700, textAlign: 'center' as const },
  td: { border: '1px solid #bfbfbf', padding: '1px 4px', textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  tdL: { border: '1px solid #bfbfbf', padding: '1px 4px', textAlign: 'left' as const },
  tdR: { border: '1px solid #bfbfbf', padding: '1px 4px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  // Kg partii mięsa — jedyna liczba na wydruku, którą operator fizycznie odważa,
  // pogrubiona i lekko większa, ale bez przesady (czytelne bez krzyku).
  kgBig: { border: '1px solid #bfbfbf', padding: '1px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const, fontSize: 12, fontWeight: 700 },
}

const STATUS_PL: Record<string, string> = {
  planned: 'w kolejce', confirmed: 'w kolejce',
  in_progress: 'W MASOWNICY', done: 'gotowe',
}

export function MixingPlanPrintPage() {
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const planDate = sp.get('date') || new Date().toISOString().slice(0, 10)
  const [plan, setPlan] = useState<any[] | null>(null)
  const [recipes, setRecipes] = useState<any[]>([])

  useEffect(() => {
    Promise.all([
      mixingOrdersApi.dayPlan(planDate),
      (recipesApi as any).list(),
    ]).then(([p, r]) => {
      setPlan(p.items ?? [])
      setRecipes(Array.isArray(r) ? r : (r as any)?.data ?? [])
    }).catch(() => setPlan([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate])

  useEffect(() => {
    if (plan && plan.length > 0 && !isPdf) setTimeout(() => window.print(), 400)
  }, [plan, isPdf])

  const recipeById = useMemo(() => new Map(recipes.map((r: any) => [r.id, r])), [recipes])
  const lotRows = useMemo(() => buildLotRows(plan ?? []), [plan])

  // Przyprawy ŁĄCZNIE na cały plan (dawka/100 kg × kg mięsa pozycji).
  // Kolejność = kolejność składników w recepturach (backend: recipe_ingredients.seq),
  // NIE alfabetyczna — ma być spójna z tym, co operator widzi w przepisie,
  // żeby nie musiał szukać składnika w innej kolejności niż go dodaje.
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
    return [...acc.values()]
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
  if (plan.length === 0) return <div style={{ padding: 24 }}>Brak planu masowania na {fmtD(planDate)}.</div>

  const totalMeat = plan.reduce((s, o) => s + (o.meatKg || 0), 0)
  const totalOutput = plan.reduce((s, o) => s + (o.plannedOutputKg || 0), 0)

  return (
    <div style={S.page}>
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm } }`}</style>

      {/* ── Nagłówek ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '2px solid #111', paddingBottom: 6, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo-ksiezyc.png" alt="Księżyc" style={{ height: 46, width: 'auto' }} />
          <div>
            <h1 style={S.h1}>PLAN MASOWANIA</h1>
            <div style={{ fontSize: 11, color: '#444' }}>dzień: <b>{fmtD(planDate)}</b></div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: '#555' }}>
          wydrukowano {new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}
          <div style={{ fontSize: 12, color: '#111', marginTop: 1 }}>
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
            <th style={{ ...S.th, width: 20 }}>Lp</th>
            <th style={S.th}>Receptura</th>
            <th style={{ ...S.th, width: 74 }}>Nr partii</th>
            <th style={{ ...S.th, width: 78 }}>Kg partii</th>
            <th style={S.th}>Rodzaj</th>
            <th style={S.th}>Dostawca</th>
            <th style={{ ...S.th, width: 62 }}>Mięso [kg]</th>
            <th style={{ ...S.th, width: 68 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {lotRows.map(row => {
            const bg = row.zebra ? '#f2f2f2' : '#fff'
            return (
              <tr key={row.rowKey}>
                {row.isFirstRow && (
                  <>
                    <td style={{ ...S.td, background: bg }} rowSpan={row.rowSpan}><b>{row.lp}</b></td>
                    <td style={{ ...S.tdL, fontWeight: 700, background: bg }} rowSpan={row.rowSpan}>
                      {row.recipeName}
                    </td>
                  </>
                )}
                <td style={{ ...S.tdL, background: bg }}>{row.lotNo}</td>
                <td style={{ ...S.kgBig, background: bg }}>
                  {row.lotKg == null ? '—' : `${nf0.format(row.lotKg)} kg`}
                </td>
                <td style={{ ...S.tdL, background: bg }}>{row.materialName || '—'}</td>
                <td style={{ ...S.tdL, background: bg }}>{row.supplierName || '—'}</td>
                {row.isFirstRow && (
                  <>
                    <td style={{ ...S.tdR, fontWeight: 800, background: bg }} rowSpan={row.rowSpan}>
                      {nf0.format(row.meatKg)}
                    </td>
                    <td style={{ ...S.td, background: bg }} rowSpan={row.rowSpan}>
                      {STATUS_PL[row.status] ?? row.status}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
          <tr>
            <td style={{ ...S.tdL, fontWeight: 800, background: '#efefef' }} colSpan={6}>RAZEM</td>
            <td style={{ ...S.tdR, fontWeight: 800, background: '#efefef' }}>{nf0.format(totalMeat)}</td>
            <td style={{ ...S.td, background: '#efefef' }} />
          </tr>
        </tbody>
      </table>

      {/* ── 2. Przepisy na wsady maszyn ── */}
      {usedRecipes.map(({ recipe, planKg }) => {
        const ings: any[] = recipe.ingredients ?? []
        const outFor = (kg: number) =>
          kg + ings
            .filter(ri => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
            .reduce((s, ri) => s + (ri.qtyPer100kg * kg) / 100, 0)
        return (
          <div key={recipe.id} style={{ pageBreakInside: 'avoid' as const }}>
            {/* flex zamiast float — długa nazwa nie zawija się pod „w planie", nagłówek zostaje 1-linijkowy */}
            <div style={{ ...S.section, fontSize: 10, display: 'flex',
              justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <span style={{ minWidth: 0 }}>Przepis — {recipe.name}</span>
              <span style={{ fontWeight: 700, textTransform: 'none', whiteSpace: 'nowrap' }}>
                w planie: {nf0.format(planKg)} kg mięsa
              </span>
            </div>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Składnik</th>
                  {MACHINE_BATCHES_KG.map(kg => (
                    <th key={kg} style={{ ...S.th, width: 100 }}>Wsad {kg} kg mięsa</th>
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

      {/* ── 3. Mała tabelka na końcu: przyprawy do przygotowania łącznie ──
           pageBreakInside:avoid — przy gęstym planie cała sekcja schodzi na 2. stronę
           w całości, zamiast rozrywać się w połowie tabeli. */}
      <div style={{ pageBreakInside: 'avoid' as const }}>
        <div style={S.section}>Do przygotowania — przyprawy łącznie na cały plan</div>
        {spiceTotals.length === 0 ? (
          <div style={{ fontSize: 10, color: '#555' }}>Receptury planu nie mają składników.</div>
        ) : (
          <table style={{ ...S.table, maxWidth: 380 }}>
            <thead>
              <tr>
                <th style={S.th}>Składnik</th>
                <th style={{ ...S.th, width: 100 }}>Ilość</th>
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
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: '#777', borderTop: '1px solid #bbb', paddingTop: 4 }}>
        Kolejność pozycji = kolejność masowania. Dawki przepisów podane na wsad mięsa 200 / 600 kg —
        przy innym wsadzie licz proporcjonalnie. Wygenerowano z planu dnia w Kebab MES.
      </div>
    </div>
  )
}
