/**
 * Karta 2.5.1 — ZALECENIE PRODUKCYJNE (raport z realizacji produkcji).
 *
 * Odwzorowanie karty papierowej P/ddmmrr/N, z dwiema świadomymi różnicami
 * wobec dotychczasowego wydruku:
 *  • JEDNA KARTA = JEDNA RECEPTURA (dotąd sześć receptur wchodziło na jedną),
 *  • żadnych pustych wierszy-widm — drukujemy wyłącznie realne pozycje.
 *
 * Weterynaria pyta, SKĄD WZIĘŁA SIĘ PARTIA PP. Skład wsadu pokazujemy więc
 * dwa razy: w sekcji surowca i przy samej partii w sekcji pakowania, żeby
 * kontrola nie musiała zestawiać tego z dwóch miejsc.
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
const fmtKg = (v: number) =>
  `${Number(v || 0).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`

export function ProductionReportPrintPage() {
  const [params] = useSearchParams()
  const data     = params.get('data') ?? ''
  const receptura = params.get('receptura') ?? ''
  const isPdf    = params.get('pdf') === '1'

  const { data: k, loading, error } = useApi(
    () => data && receptura
      ? productionReportsApi.card(data, receptura)
      : Promise.resolve(null),
    [data, receptura],
  )

  useEffect(() => {
    document.title = 'Zalecenie produkcyjne'
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

  return (
    <div className="zp">
      <style>{CSS}</style>

      <div className="hdr">
        <img className="logo" src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>

      <h1>ZALECENIE PRODUKCYJNE</h1>
      <div className="sub">Raport z realizacji produkcji — surowiec, masowanie i marynowanie, pakowanie</div>

      <table className="meta">
        <tbody>
          <tr>
            <th>NUMER KARTY</th><td className="mono b">{k.cardNo}</td>
            <th>DATA PRODUKCJI</th><td className="b">{fmtDate(k.planDate)}</td>
          </tr>
          <tr>
            <th>NAZWY PRODUKTÓW</th><td className="b" colSpan={3}>{k.productNames}</td>
          </tr>
        </tbody>
      </table>

      <div className="sect">SUROWIEC POBRANY DO PRODUKCJI</div>
      <table>
        <thead>
          <tr><th>SUROWIEC</th><th className="r">ILOŚĆ POBRANA</th><th>NUMER PORZĄDKOWY</th><th>PARTIE PRZYPRAWIONEGO</th></tr>
        </thead>
        <tbody>
          {k.rawMaterials.map((r: any, i: number) => (
            <tr key={i}>
              <td>{r.material || '—'}</td>
              <td className="r b">{fmtKg(r.kg)}</td>
              <td className="mono">{r.batchNo || r.origin}</td>
              <td className="mono">{(r.seasonedBatchNos || []).join(', ')}</td>
            </tr>
          ))}
          <tr className="sum">
            <td>SUMA MIĘSA</td><td className="r">{fmtKg(k.rawTotalKg)}</td><td /><td />
          </tr>
        </tbody>
      </table>

      <div className="sect">MASOWANIE I MARYNOWANIE</div>
      <table>
        <thead>
          <tr><th>SKŁADNIK</th><th className="r">ILOŚĆ</th><th>NUMER PRZYJĘCIA</th></tr>
        </thead>
        <tbody>
          {k.ingredients.map((g: any, i: number) => (
            <tr key={i}>
              <td>{g.name}</td>
              <td className="r b">{Number(g.qty).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} {g.unit}</td>
              <td className="mono">{g.receiptNo || <span className="fill" />}</td>
            </tr>
          ))}
          <tr className="sum"><td>SUMA</td><td className="r">{fmtKg(k.mixTotalKg)}</td><td /></tr>
          <tr><td>Folia</td><td /><td><span className="fill" /></td></tr>
          <tr>
            <td>Tuleje</td>
            <td className="mono" colSpan={2}>{(k.packagings || []).join(', ')}</td>
          </tr>
        </tbody>
      </table>

      <div className="sect">PAKOWANIE I ETYKIETOWANIE</div>
      <table>
        <thead>
          <tr>
            <th>RODZAJ KEBABU</th><th>PARTIA</th><th>OPAKOWANIA (SZT. × WAGA)</th>
            <th>DATA WEJŚCIA NA MROŹNIĘ</th><th>NALEŻY SPOŻYĆ DO</th><th className="r">WAGA</th>
          </tr>
        </thead>
        <tbody>
          {k.packing.map((p: any, i: number) => (
            <tr key={i}>
              <td>{p.productType}</td>
              <td className="mono b">
                {p.batchNo}
                {p.origin && <div className="orig">z wsadu: {p.origin}</div>}
              </td>
              <td>{p.packages}</td>
              <td>{fmtDate(p.frozenAt)}</td>
              <td>{fmtDate(p.bestBefore)}</td>
              <td className="r b">{fmtKg(p.kg)}</td>
            </tr>
          ))}
          <tr><td>UPPZ kat. 3 / ścinki</td><td /><td /><td /><td /><td className="r"><span className="fill" /></td></tr>
          <tr className="sum">
            <td>SUMA PRODUKCJI</td><td /><td /><td /><td /><td className="r">{fmtKg(k.packingTotalKg)}</td>
          </tr>
        </tbody>
      </table>

      <div className="sect">ZAMRAŻANIE I ZWOLNIENIE PARTII</div>
      <table>
        <thead>
          <tr>
            <th>TEMPERATURA W CENTRUM SZYSZKI [°C]<div className="req">wymóg: −18 °C</div></th>
            <th>CZAS ZAMRAŻANIA [H]<div className="req">wymóg: do 24 h</div></th>
            <th>OCENA ORGANOLEPTYCZNA PO WYCHŁODZENIU</th>
            <th>STRATA PRODUKCYJNA [KG]</th>
            <th>WYKONAŁ — DATA I PODPIS</th>
          </tr>
        </thead>
        <tbody><tr>{[0, 1, 2, 3, 4].map(i => <td key={i} className="tall" />)}</tr></tbody>
      </table>

      <table className="sign">
        <thead><tr><th>SPORZĄDZIŁ — DATA I PODPIS</th><th>ZATWIERDZIŁ — PIECZĄTKA I PODPIS</th></tr></thead>
        <tbody><tr><td className="tall" /><td className="tall" /></tr></tbody>
      </table>

      <div className="foot">
        <span>Przechowywanie zapisu: min. 1 rok</span>
        <span>Karta 2.5.1 do instrukcji 2.5 — Raport z realizacji produkcji</span>
      </div>
    </div>
  )
}

const CSS = `
@page { size: A4 portrait; margin: 8mm 10mm; }
.zp, .zp * { box-sizing: border-box; }
.zp { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
  font-size: 8.5pt; width: 190mm; margin: 0 auto;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .zp { width: auto; } }

.zp .hdr { display: flex; align-items: flex-start; gap: 4mm; }
.zp .logo { height: 11mm; flex-shrink: 0; }
.zp .plant { flex: 1; text-align: center; }
.zp .plant .nm { font-weight: 700; font-size: 9pt; }
.zp .plant .ad { font-size: 7.5pt; }

.zp h1 { text-align: center; font-size: 12pt; font-weight: 700; letter-spacing: .04em;
  margin: 3mm 0 0.5mm; }
.zp .sub { text-align: center; font-size: 7.5pt; margin-bottom: 2.5mm; }

.zp table { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
.zp th, .zp td { border: .25mm solid #000; padding: 1mm 1.5mm; text-align: left;
  vertical-align: top; }
.zp thead th { background: #efefef; font-size: 7.5pt; font-weight: 700; }
.zp .r { text-align: right; }
.zp .b { font-weight: 700; }
.zp .mono { font-family: 'Courier New', monospace; }
.zp .sum td { background: #f7f7f7; font-weight: 700; }
.zp .req { font-weight: 400; font-size: 6.5pt; }
.zp .tall { height: 12mm; }
/* Pole do wpisania długopisem — MES tej wartości nie zna. */
.zp .fill { display: inline-block; width: 100%; border-bottom: .2mm dotted #666; height: 3.2mm; }
/* Skład wsadu przy partii — to jest odpowiedź na „skąd wzięła się PP". */
.zp .orig { font-family: Arial; font-weight: 400; font-size: 6.8pt; margin-top: .6mm; }

.zp .meta th { background: #efefef; width: 26mm; font-size: 7.5pt; }
.zp .sect { background: #dcdcdc; border: .25mm solid #000; border-bottom: 0;
  font-weight: 700; font-size: 8pt; padding: 1mm 1.5mm; letter-spacing: .03em; }
.zp .sign th { width: 50%; }
.zp .foot { display: flex; justify-content: space-between; font-size: 7pt; margin-top: 1mm; }
`
