/**
 * KARTA PRODUKCJI KEBAB — kartka dla kierownika produkcji.
 *
 * Odwzorowanie arkusza, który biuro wypełniało dotąd ręcznie w Excelu:
 * te same kolumny, ta sama kolejność, ten sam nagłówek. Ludzie są do niej
 * przyzwyczajeni, a to rozwiązanie TYMCZASOWE — do czasu, aż hala dostanie
 * kiosk. Do tego momentu biuro planuje w MES i drukuje kartkę.
 *
 * Kolumna NR PARTII niesie podział na partie z planu („1x470, 19x472"),
 * bo bez HMI to jedyny nośnik tej informacji na produkcji.
 *
 * Samodzielna strona (wzór MixingPlanPrintPage):
 * /office/plan-produkcji/druk?planId=…  — auto-print po załadowaniu.
 *   ?pdf=1  wyłącza auto-print (podgląd i render do PDF)
 *
 * Kartka wypełnia CAŁĄ stronę niezależnie od liczby pozycji: wysokość
 * wiersza liczymy z dostępnej wysokości, a przy wielu pozycjach schodzimy
 * do zwartego wiersza i pozwalamy tabeli przejść na kolejną stronę
 * (nagłówek powtarza się dzięki thead).
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { productionPlansApi } from '@/lib/apiClient'
import { buildProductionCard } from '@/features/production-plan/productionCard'
import { useClientNames } from '@/lib/clientNames'

// Kartka ma być ZAWSZE taka sama: stała wysokość wiersza i stała czcionka,
// a resztę strony wypełniają puste pola. Wysokość dobierana do liczby pozycji
// (6–20 mm) rozjeżdżała układ — przy kilku pozycjach wiersze robiły się
// ogromne i kartka wyglądała za każdym razem inaczej (uwaga biura 13.08).
const ROW_MM   = 9        // wysokość wiersza — stała
const FONT_PT  = 10       // czcionka tabeli — stała
const BODY_MM  = 144      // obszar tabeli po nagłówku kartki (zmierzone renderem)
/** Ile wierszy mieści się na stronie — tyle zawsze rysujemy. */
export const ROWS_PER_PAGE = Math.floor(BODY_MM / ROW_MM)

const fmtDate = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function ProductionCardPrintPage() {
  // Na kartce klient ma być pod nazwą wyświetlaną („SZUMERA"), a nie pełną
  // nazwą rejestrową z formą prawną — kierownik czyta ją w biegu.
  const clientDisplay = useClientNames()
  const [params] = useSearchParams()
  const planId = params.get('planId') ?? ''
  const isPdf  = params.get('pdf') === '1'

  const { data: plan, loading } = useApi(
    () => planId ? productionPlansApi.byId(planId) : Promise.resolve(null),
    [planId],
  )

  useEffect(() => {
    document.title = 'Karta produkcji kebab'
    if (isPdf || !plan) return
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [isPdf, plan])

  if (loading) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Wczytywanie planu…</div>
  if (!plan)   return <div style={{ padding: 24, fontFamily: 'Arial' }}>Nie znaleziono planu.</div>

  const card = buildProductionCard(plan as any, {
    rowsPerPage: ROWS_PER_PAGE,
    clientName: clientDisplay,
  })

  return (
    <div className="kpk">
      <style>{CSS}</style>

      <div className="hdr">
        <img className="logo" src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div>ZAKŁAD PRODUKCJI KEBAB</div>
          <div>ul. Dunajewskiego 83</div>
          <div>32-064 Rudawa</div>
        </div>
      </div>

      <div className="title">KARTA PRODUKCJI KEBAB</div>

      <div className="meta">
        <div><span className="lb">DATA PRODUKCJI:</span> <span className="vl">{fmtDate(card.planDate)}</span>
          <span className="wd">{card.weekday}</span></div>
        <div><span className="lb">ILOŚĆ:</span> <span className="vl">{Math.round(card.totalKg)}kg</span></div>
      </div>

      <table style={{ fontSize: `${FONT_PT}pt` }}>
        <thead>
          <tr>
            <th className="tick" />
            <th>ILOŚĆ SZT.</th>
            <th>WAGA</th>
            <th className="kind">RODZAJ</th>
            <th>TULEJE</th>
            <th>KLIENT</th>
            <th>WAGA</th>
            <th className="lot">NR PARTII</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r, i) => (
            <tr key={i} style={{ height: `${ROW_MM}mm` }}>
              <td className="tick" />
              <td className="b">{r.blank ? '' : `${r.qty}szt.`}</td>
              <td className="b">{r.blank ? '' : `${r.kgPerUnit}kg`}</td>
              <td>{r.kind}</td>
              <td>{r.sleeve}</td>
              <td>{r.client}</td>
              <td>{r.blank ? '' : `${Math.round(r.totalKg)}kg`}</td>
              <td className="lot">{r.batches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CSS = `
/* Boki 10 mm, nie 8 — przy 8 mm skrajna ramka tabeli wypadała dokładnie na
   granicy obszaru druku i drukarki biurowe ją ucinały (strefa niedrukowalna
   ok. 6,4 mm). Sprawdzone renderem. */
@page { size: A4 landscape; margin: 6mm 10mm; }
.kpk, .kpk * { box-sizing: border-box; }
.kpk { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
  width: 277mm; margin: 0 auto; padding: 4mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .kpk { width: auto; margin: 0; padding: 0; } }

.kpk .hdr { display: flex; align-items: flex-start; }
.kpk .logo { height: 12mm; width: auto; flex-shrink: 0; }
.kpk .plant { flex: 1; text-align: center; font-size: 10pt; line-height: 1.3;
  margin-left: -12mm; }

/* Ramka tytułu na całą szerokość — jak na dotychczasowej kartce. */
.kpk .title { border: .3mm solid #000; text-align: center; font-weight: 700;
  font-size: 10.5pt; padding: 1mm; margin: 2mm 0 3mm; letter-spacing: .02em; }

.kpk .meta { font-size: 11pt; font-weight: 700; margin: 0 0 2mm 4mm; }
.kpk .meta .lb { display: inline-block; min-width: 42mm; }
.kpk .meta .vl { display: inline-block; min-width: 30mm; }
.kpk .meta .wd { margin-left: 4mm; }

.kpk table { width: 100%; border-collapse: collapse; table-layout: fixed; }
/* Nagłówek powtarza się, gdy pozycji jest tyle, że kartka schodzi na drugą stronę. */
.kpk thead { display: table-header-group; }
.kpk tr { page-break-inside: avoid; }
.kpk th, .kpk td { border: .25mm solid #000; padding: 0 1.5mm; text-align: center;
  overflow: hidden; }
.kpk th { background: #f2f2f2; font-weight: 700; font-size: .95em; height: 8mm; }
.kpk td.b { font-weight: 700; }
.kpk .tick { width: 12mm; }           /* kolumna na odhaczenie długopisem */
.kpk .kind { width: 15%; }
/* NR PARTII szerzej: podział bywa długi („2x472, 6xPP13, 1x472/PP13") i przy
   15% zawijał się do dwóch linii, rozpychając wiersz i spychając kartkę na
   drugą stronę. Zawijanie zostaje jako awaryjne — nie wolno uciąć partii. */
.kpk .lot  { width: 22%; }
`
