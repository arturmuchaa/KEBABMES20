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

// Wysokość obszaru tabeli na A4 poziomo (210 mm) po odjęciu marginesów
// (2×6 mm), nagłówka kartki (~35 mm) i wiersza nagłówkowego tabeli (8 mm).
// Zmierzone renderem — przy 158 mm ostatni wiersz schodził na drugą stronę.
const BODY_MM = 150
const ROW_MIN_MM = 6.2      // niżej wiersz przestaje być czytelny na hali
const ROW_MAX_MM = 20       // wyżej kartka to już same linie

function rowHeightMm(rows: number): number {
  if (rows <= 0) return ROW_MAX_MM
  return Math.max(ROW_MIN_MM, Math.min(ROW_MAX_MM, BODY_MM / rows))
}

/** Czcionka rośnie razem z wierszem — mała kartka nie ma być rozstrzelona. */
function fontPt(rowH: number): number {
  if (rowH >= 14) return 12
  if (rowH >= 10) return 11
  if (rowH >= 8)  return 10
  if (rowH >= 7)  return 9
  return 8.5
}

const fmtDate = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export function ProductionCardPrintPage() {
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

  const card = buildProductionCard(plan as any)
  const rowH = rowHeightMm(card.rows.length)
  const fs   = fontPt(rowH)

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

      <table style={{ fontSize: `${fs}pt` }}>
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
            <tr key={i} style={{ height: `${rowH}mm` }}>
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
.kpk th, .kpk td { border: .25mm solid #000; padding: 0 2mm; text-align: center;
  overflow: hidden; }
.kpk th { background: #f2f2f2; font-weight: 700; font-size: .95em; height: 8mm; }
.kpk td.b { font-weight: 700; }
.kpk .tick { width: 12mm; }           /* kolumna na odhaczenie długopisem */
.kpk .kind { width: 17%; }
.kpk .lot  { width: 15%; }
`
