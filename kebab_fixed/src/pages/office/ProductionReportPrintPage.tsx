/**
 * KARTA REALIZACJI PRODUKCJI — formularz 2.5.1 oPRP (instrukcja 2.5).
 *
 * Wg AKTUALNEJ księgi HACCP (2026.01.525), nie poprzedniego „Zalecenia
 * produkcyjnego": numer `PK/N/MM/RR`, JEDNA tabela składników (mięso +
 * dodatki + opakowania) z numerem dostawy przy każdej pozycji, dalej
 * terminy przydatności, mrożenie, strata i uwagi.
 *
 * Instrukcja 2.5 czyni z numeru PK spinacz identyfikowalności — dlatego
 * kolumna NUMER DOSTAWY stoi w tej samej tabeli co składnik, a skład partii
 * PP („z wsadu: 440 — 60 kg, 441 — 58 kg") jest i przy mięsie, i przy partii
 * wyrobu. To pytanie pada przy kontroli najczęściej.
 *
 * Karta ZAWSZE mieści się na jednej stronie A4 — przy dużym dniu schodzimy
 * progiem gęstości zamiast pozwolić jej zjechać na drugą kartkę.
 *
 * /office/zalecenie-produkcyjne/druk?data=YYYY-MM-DD&receptura=<id>
 *   ?pdf=1  wyłącza auto-print (podgląd i render do PDF)
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { productionReportsApi } from '@/lib/apiClient'

const fmtDate = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${Number(d)}.${m}.${y}`
}
const nkg = (v: number) =>
  Number(v || 0).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export function ProductionReportPrintPage() {
  const [params]  = useSearchParams()
  const data      = params.get('data') ?? ''
  const receptura = params.get('receptura') ?? ''
  const isPdf     = params.get('pdf') === '1'

  const { data: k, loading, error } = useApi(
    () => data && receptura ? productionReportsApi.card(data, receptura) : Promise.resolve(null),
    [data, receptura],
  )

  useEffect(() => {
    document.title = 'Karta realizacji produkcji'
    if (isPdf || !k) return
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [isPdf, k])

  if (loading) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Wczytywanie karty…</div>
  if (error || !k) {
    return (
      <div style={{ padding: 24, fontFamily: 'Arial' }}>
        Nie udało się złożyć karty: {error || 'brak produkcji tej receptury w tym dniu'}.
      </div>
    )
  }

  const wierszy = (k.components?.length ?? 0) + (k.batches?.length ?? 0)
  const gestosc = wierszy > 26 ? ' d2' : wierszy > 17 ? ' d1' : ''

  return (
    <div className={`kp${gestosc}`}>
      <style>{CSS}</style>

      <div className="hdr">
        <img className="logo" src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>

      <h1>KARTA REALIZACJI PRODUKCJI</h1>

      <table className="meta">
        <tbody>
          <tr>
            <th>NUMER KARTY</th><td className="mono b">{k.cardNo}</td>
            <th>DATA</th><td className="b">{fmtDate(k.planDate)}</td>
          </tr>
          <tr>
            <th>NAZWA WYROBU</th><td className="b">{k.productName}</td>
            <th>REALIZOWANA ILOŚĆ</th><td className="b">{nkg(k.producedKg)} kg</td>
          </tr>
        </tbody>
      </table>

      <div className="sect">SKŁADNIKI</div>
      <table>
        <thead>
          <tr>
            <th className="w-kind">RODZAJ</th>
            <th>SKŁADNIK</th>
            <th className="w-del">NUMER DOSTAWY</th>
            <th className="r w-kg">KG</th>
            <th>UWAGI</th>
          </tr>
        </thead>
        <tbody>
          {k.components.map((c: any, i: number) => (
            <tr key={i}>
              <td className="kind">{c.kind}</td>
              <td className="b">{c.name}</td>
              <td className="mono">{c.deliveryNo || <span className="fill" />}</td>
              <td className="r b">{c.kg == null ? '—' : `${nkg(c.kg)}${c.unit === 'L' ? ' L' : ''}`}</td>
              <td className="note">{c.note}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={3}>SUMA</td>
            <td className="r">{nkg(k.componentsTotalKg)} kg</td>
            <td>Wykonał: <span className="fill" /></td>
          </tr>
        </tbody>
      </table>

      <div className="sect">TERMINY PRZYDATNOŚCI — PARTIE WYROBU</div>
      <table>
        <thead>
          <tr>
            <th>NUMER PARTII</th><th>OPAKOWANIA (SZT. × WAGA)</th>
            <th>PRZECHOWYWANIE</th><th>DATA PRODUKCJI</th>
            <th>NALEŻY SPOŻYĆ DO</th><th className="r">WAGA</th>
          </tr>
        </thead>
        <tbody>
          {k.batches.map((b: any, i: number) => (
            <tr key={i}>
              <td className="mono b">
                {b.batchNo}
                {b.origin && <div className="orig">z wsadu: {b.origin}</div>}
              </td>
              <td>{b.packages}</td>
              <td>{b.storage}</td>
              <td>{fmtDate(b.producedDate)}</td>
              <td className="b">{fmtDate(b.bestBefore)}</td>
              <td className="r b">{nkg(b.kg)} kg</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={5}>SUMA PRODUKCJI</td>
            <td className="r">{nkg(k.producedKg)} kg</td>
          </tr>
        </tbody>
      </table>

      <div className="sect">ZAMRAŻANIE, OCENA I STRATA</div>
      <table>
        <thead>
          <tr>
            <th>TEMPERATURA NA KONIEC MROŻENIA WEWNĄTRZ SZYSZKI [°C]<div className="req">wymóg: −18 °C</div></th>
            <th>CZAS TRWANIA ZAMRAŻANIA [H]<div className="req">wymóg: do 24 h</div></th>
            <th>OCENA ORGANOLEPTYCZNA PO WYCHŁODZENIU</th>
            <th>STRATA PRODUKCYJNA [KG]</th>
            <th>WYKONAŁ</th>
          </tr>
        </thead>
        <tbody><tr>{[0, 1, 2, 3, 4].map(i => <td key={i} className="tall" />)}</tr></tbody>
      </table>

      <div className="sect">UWAGI</div>
      <table><tbody><tr><td className="tall" /></tr></tbody></table>

      <table className="sign">
        <thead><tr><th>SPORZĄDZIŁ — DATA I PODPIS</th><th>ZATWIERDZIŁ — PIECZĄTKA I PODPIS</th></tr></thead>
        <tbody><tr><td className="tall" /><td className="tall" /></tr></tbody>
      </table>

      <div className="foot">
        <span>Przechowywanie zapisu: min. 1 rok</span>
        <span>Karta 2.5.1 do instrukcji 2.5 — oPRP Produkcja kebaba</span>
      </div>
    </div>
  )
}

const CSS = `
/* Karta MUSI mieścić się na jednej stronie A4 — wąskie marginesy, zwarta
   typografia i progi gęstości. Sprawdzone renderem. */
@page { size: A4 portrait; margin: 5mm 6mm; }
.kp, .kp * { box-sizing: border-box; }
.kp { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
  font-size: 7.6pt; line-height: 1.15; width: 198mm; margin: 0 auto;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .kp { width: auto; } }

.kp .hdr { display: flex; align-items: center; gap: 3mm; }
.kp .logo { height: 8.5mm; flex-shrink: 0; }
.kp .plant { flex: 1; text-align: center; }
.kp .plant .nm { font-weight: 700; font-size: 8.2pt; }
.kp .plant .ad { font-size: 6.8pt; }

.kp h1 { text-align: center; font-size: 11.5pt; font-weight: 700;
  letter-spacing: .05em; margin: 2mm 0 1.5mm; }

.kp table { width: 100%; border-collapse: collapse; margin-bottom: 1.2mm; }
.kp th, .kp td { border: .22mm solid #000; padding: .7mm 1.2mm; text-align: left;
  vertical-align: top; }
.kp thead th { background: #efefef; font-size: 6.8pt; font-weight: 700; }
.kp .r { text-align: right; }
.kp .b { font-weight: 700; }
.kp .mono { font-family: 'Courier New', monospace; font-size: 7.2pt; }
.kp .sum td { background: #f5f5f5; font-weight: 700; }
.kp .req { font-weight: 400; font-size: 6pt; }
.kp .tall { height: 9mm; }
.kp .kind { font-size: 6.4pt; text-transform: uppercase; color: #333; }
.kp .note { font-size: 6.8pt; }
/* Pole do wpisania długopisem — MES tej wartości nie zna. */
.kp .fill { display: inline-block; width: 100%; border-bottom: .2mm dotted #666; height: 3mm; }
/* Skład wsadu — odpowiedź na „skąd wzięła się partia PP". */
.kp .orig { font-family: Arial; font-weight: 400; font-size: 6.4pt; margin-top: .4mm; }

.kp .w-kind { width: 16mm; }
.kp .w-del  { width: 26mm; }
.kp .w-kg   { width: 20mm; }
.kp .meta th { background: #efefef; width: 26mm; font-size: 6.8pt; }
.kp .sect { background: #dcdcdc; border: .22mm solid #000; border-bottom: 0;
  font-weight: 700; font-size: 7.4pt; padding: .7mm 1.2mm; letter-spacing: .03em; }
.kp .sign th { width: 50%; }
.kp .foot { display: flex; justify-content: space-between; font-size: 6.4pt; margin-top: .8mm; }

/* Progi gęstości — karta zawsze na jednej stronie A4. */
.kp.d1 { font-size: 7pt; }
.kp.d1 th, .kp.d1 td { padding: .45mm 1mm; }
.kp.d1 .tall { height: 7mm; }
.kp.d1 h1 { font-size: 10.5pt; margin: 1.2mm 0 1mm; }
.kp.d1 .logo { height: 7.5mm; }

.kp.d2 { font-size: 6.3pt; }
.kp.d2 th, .kp.d2 td { padding: .3mm .8mm; }
.kp.d2 .mono { font-size: 6pt; }
.kp.d2 thead th { font-size: 5.9pt; }
.kp.d2 .tall { height: 5.5mm; }
.kp.d2 h1 { font-size: 10pt; margin: 1mm 0 .8mm; }
.kp.d2 .logo { height: 6.5mm; }
.kp.d2 .sect { font-size: 6.6pt; padding: .5mm 1mm; }
.kp.d2 .orig, .kp.d2 .note { font-size: 5.8pt; }
`
