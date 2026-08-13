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

  // Karta ma ZAWSZE zmieścić się na jednej stronie A4. Przy dużym dniu
  // (dużo wsadów albo dużo partii wyrobu) schodzimy o próg niżej z gęstością
  // zamiast pozwolić kartce zjechać na drugą kartkę.
  const wierszy = (k.rawMaterials?.length ?? 0)
    + (k.ingredients?.length ?? 0) + (k.packing?.length ?? 0)
  const gestosc = wierszy > 26 ? ' d2' : wierszy > 17 ? ' d1' : ''

  return (
    <div className={`zp${gestosc}`}>
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
              <td className="mono">
                {r.batchNo || r.origin}
                {r.approx && <span className="approx"> (skład zlecenia — sesja sprzed zapisu rozbicia)</span>}
              </td>
              <td className="mono b">{r.seasonedBatchNo}</td>
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
/* Karta MUSI mieścić się na jednej stronie A4 — stąd wąskie marginesy
   i zwarta typografia. Sprawdzone renderem przy 12 partiach surowca. */
@page { size: A4 portrait; margin: 5mm 6mm; }
.zp, .zp * { box-sizing: border-box; }
.zp { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
  font-size: 7.6pt; line-height: 1.15; width: 198mm; margin: 0 auto;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { .zp { width: auto; } }

.zp .hdr { display: flex; align-items: center; gap: 3mm; }
.zp .logo { height: 8.5mm; flex-shrink: 0; }
.zp .plant { flex: 1; text-align: center; }
.zp .plant .nm { font-weight: 700; font-size: 8.2pt; }
.zp .plant .ad { font-size: 6.8pt; }

.zp h1 { text-align: center; font-size: 11pt; font-weight: 700; letter-spacing: .04em;
  margin: 1.8mm 0 0.3mm; }
.zp .sub { text-align: center; font-size: 6.8pt; margin-bottom: 1.5mm; }

.zp table { width: 100%; border-collapse: collapse; margin-bottom: 1.2mm; }
.zp th, .zp td { border: .22mm solid #000; padding: .7mm 1.2mm; text-align: left;
  vertical-align: top; }
.zp thead th { background: #efefef; font-size: 6.8pt; font-weight: 700; }
.zp .r { text-align: right; }
.zp .b { font-weight: 700; }
.zp .mono { font-family: 'Courier New', monospace; font-size: 7.2pt; }
.zp .sum td { background: #f5f5f5; font-weight: 700; }
.zp .req { font-weight: 400; font-size: 6pt; }
.zp .tall { height: 9mm; }
/* Pole do wpisania długopisem — MES tej wartości nie zna. */
.zp .fill { display: inline-block; width: 100%; border-bottom: .2mm dotted #666; height: 3mm; }
/* Skład wsadu przy partii — odpowiedź na „skąd wzięła się PP". */
.zp .orig { font-family: Arial; font-weight: 400; font-size: 6.4pt; margin-top: .4mm; }
/* Dane sprzed zapisu rozbicia per sesja — karta nie udaje precyzji. */
.zp .approx { font-family: Arial; font-size: 6.2pt; color: #444; }

.zp .meta th { background: #efefef; width: 24mm; font-size: 6.8pt; }
.zp .sect { background: #dcdcdc; border: .22mm solid #000; border-bottom: 0;
  font-weight: 700; font-size: 7.4pt; padding: .7mm 1.2mm; letter-spacing: .03em; }
.zp .sign th { width: 50%; }
.zp .foot { display: flex; justify-content: space-between; font-size: 6.4pt; margin-top: .8mm; }

/* Progi gęstości — karta zawsze na jednej stronie A4. Sprawdzone renderem:
   d1 do ~26 wierszy treści, d2 do ~40. */
.zp.d1 { font-size: 7pt; }
.zp.d1 th, .zp.d1 td { padding: .45mm 1mm; }
.zp.d1 .tall { height: 7mm; }
.zp.d1 h1 { font-size: 10pt; margin: 1.2mm 0 .2mm; }
.zp.d1 .logo { height: 7.5mm; }

.zp.d2 { font-size: 6.3pt; }
.zp.d2 th, .zp.d2 td { padding: .3mm .8mm; }
.zp.d2 .mono { font-size: 6pt; }
.zp.d2 thead th { font-size: 5.9pt; }
.zp.d2 .tall { height: 5.5mm; }
.zp.d2 h1 { font-size: 9.5pt; margin: 1mm 0 .2mm; }
.zp.d2 .sub { font-size: 6pt; margin-bottom: 1mm; }
.zp.d2 .logo { height: 6.5mm; }
.zp.d2 .sect { font-size: 6.6pt; padding: .5mm 1mm; }
.zp.d2 .orig, .zp.d2 .approx { font-size: 5.6pt; }
`
