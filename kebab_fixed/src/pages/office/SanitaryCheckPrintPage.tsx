/**
 * SanitaryCheckPrintPage — arkusz kontroli techniczno-sanitarnej przed
 * rozpoczęciem pracy zakładu (FIH 06/1/1), do druku i wypełnienia długopisem.
 *
 * Jedna karta = jeden dzień roboczy. Arkusz jest PUSTY z założenia — MES go nie
 * wypełnia; to dokument papierowy dla osoby kontrolującej i dla inspekcji
 * weterynaryjnej. Stąd brak jakiegokolwiek pobierania danych z API.
 *
 * Zakres pomieszczeń pochodzi z zakładowego „wykazu pomieszczeń" + sekcja
 * MEDIA (prąd, woda) przeniesiona ze starego arkusza. Pozycje zbiorcze
 * z wykazu są ROZBITE na pojedyncze pomieszczenia (produkcja 14/15/8,
 * komory mrożenia 26/29, mroźnie składowe 6/30/38) — każde kontroluje się
 * i kwituje osobno. Kolor wyłącznie w logo — reszta czarno-biała, żeby
 * arkusz dobrze się kserował; pole „Wynik" czysto białe, żeby znaczek
 * długopisem był dobrze widoczny.
 *
 * Nr karty i data: wypełnia system. Jedna karta na dzień, więc numer
 * wyprowadzamy z daty (D/MM/RR) — bez licznika w bazie.
 *
 * Samodzielna strona (wzór MixingPlanPrintPage):
 * /office/arkusz-kontroli/druk — auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

const STD = ['posadzka', 'ściany, drzwi', 'sufit, osłony lamp + lampy', 'wyposażenie']
const STER = [...STD, 'sterylizacja narzędzi i wyposażenia']

// Sekcja 1 = MEDIA, dalej 19 pomieszczeń ściśle wg wykazu pomieszczeń.
const SECTIONS: [string, string[]][] = [
  ['MEDIA', ['prąd', 'woda']],
  ['STREFA PRZYJĘCIA SUROWCÓW', STD],
  ['MAGAZYN SUROWCÓW', STD],
  ['MAGAZYN POROZBIOROWY', STD],
  ['MAGAZYN SUROWCA MROŻONEGO', STD],
  ['HALA ROZBIORU I PRZEPAKOWANIA', STER],
  // Każde pomieszczenie produkcji osobno — kontroluje się je niezależnie.
  ['POMIESZCZENIE PRODUKCJI NR 14', STER],
  ['POMIESZCZENIE PRODUKCJI NR 15', STER],
  ['POMIESZCZENIE PRODUKCJI NR 8', STER],
  ['POMIESZCZENIA SOCJALNE', STD],
  ['HALA MASOWNIA I LEŻAKOWANIA', STD],
  ['ŚLUZA HIGIENY', STD],
  ['KORYTARZE', STD],
  ['KOMORA MROŻENIA NR 26', STD],
  ['KOMORA MROŻENIA NR 29', STD],
  ['STREFY MANIPULACYJNE', STD],
  ['MAGAZYN PRZYPRAW I OPAKOWAŃ: folie, etykiety', STD],
  ['MROŹNIE', STD],
  ['MROŹNIA SKŁADOWA NR 6', STD],
  ['MROŹNIA SKŁADOWA NR 30', STD],
  ['MROŹNIA SKŁADOWA NR 38', STD],
  ['MYJNIA I MAGAZYNY POJEMNIKÓW', STD],
  ['MAGAZYN UPPZ', STD],
  ['EKSPEDYCJA', STD],
  ['POMIESZCZENIE KOMPLETACJI PRZED WYSYŁKĄ', STD],
]

type Row = { kind: 'head' | 'item'; lp: string; text: string }

/** Sekcja = nierozerwalny blok: pomieszczenie nie może się rozjechać między kolumnami. */
function buildBlocks(): Row[][] {
  return SECTIONS.map(([name, subs], i) => {
    const idx = i + 1
    const rows: Row[] = [{ kind: 'head', lp: String(idx), text: name }]
    subs.forEach((sub, j) => rows.push({ kind: 'item', lp: `${idx}.${j + 1}`, text: sub }))
    return rows
  })
}

/** Rozkłada całe sekcje na n kolumn, wyrównując ich wysokość. */
function splitColumns(blocks: Row[][], n = 3): Row[][] {
  const total = blocks.reduce((s, b) => s + b.length, 0)
  const cols: Row[][] = []
  let cur: Row[] = []
  let used = 0
  for (const blk of blocks) {
    if (n - cols.length <= 1) { cur = cur.concat(blk); continue }
    const target = (total - used) / (n - cols.length)
    if (cur.length && Math.abs(cur.length + blk.length - target) > Math.abs(cur.length - target)) {
      cols.push(cur); used += cur.length; cur = [...blk]
    } else {
      cur = cur.concat(blk)
    }
  }
  cols.push(cur)
  while (cols.length < n) cols.push([])
  return cols
}

export function SanitaryCheckPrintPage() {
  const [params] = useSearchParams()
  const isPdf = params.get('pdf') === '1'

  useEffect(() => {
    document.title = 'Arkusz kontroli techniczno-sanitarnej'
    if (isPdf) return
    const t = setTimeout(() => window.print(), 600)
    return () => clearTimeout(t)
  }, [isPdf])

  const cols = splitColumns(buildBlocks(), 3)

  // Numer karty i data wypełniane przez system — jedna karta na dzień, więc
  // numer wyprowadzamy z daty (dzień/miesiąc/rok). 1 lipca 2026 → „1/07/26".
  const now = new Date()
  const cardNo = `${now.getDate()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`
  const dateStr = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="ark">
      <style>{CSS}</style>

      <div className="top">
        <img src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>
      <div className="rule" />

      <h1>Arkusz kontroli techniczno-sanitarnej przed rozpoczęciem pracy zakładu</h1>

      <div className="meta">
        <div className="fld"><div className="lb">Nr karty</div><div className="vl">{cardNo}</div></div>
        <div className="fld"><div className="lb">Data kontroli</div><div className="vl">{dateStr}</div></div>
        <div className="fld w3"><div className="lb">Podpis osoby kontrolującej</div></div>
      </div>

      <div className="grid">
        {cols.map((col, ci) => (
          <table className="chk" key={ci}>
            <thead>
              <tr>
                <th className="lp">LP</th>
                <th className="txt">Stan techniczno-sanitarny</th>
                <th className="res">Wynik</th>
              </tr>
            </thead>
            <tbody>
              {col.map(r => (
                <tr key={r.lp} className={r.kind === 'head' ? 'sec' : undefined}>
                  <td className="lp">{r.lp}</td>
                  <td className="txt">{r.text}</td>
                  <td className="res" />
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <div className="legend">
        <span className="ti">Legenda wyników kontroli</span>
        <span className="it"><span className="sym">✓</span>stan zgodny — dopuszczone do pracy</span>
        <span className="it"><span className="sym">✗</span>niezgodność — opisać poniżej i podjąć działanie korygujące</span>
        <span className="it"><span className="sym">ND</span>nie dotyczy</span>
      </div>

      <div className="nz">
        <table>
          <thead>
            <tr>
              <th style={{ width: '8mm' }}>LP</th>
              <th style={{ width: '14mm' }}>Poz.</th>
              <th>Opis stwierdzonej niezgodności</th>
              <th>Działanie korygujące</th>
              <th style={{ width: '20mm' }}>Godz. usunięcia</th>
              <th style={{ width: '22mm' }}>Podpis</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map(i => (
              <tr key={i}><td>{i}</td><td /><td /><td /><td /><td /></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sign">
        <div className="dec">
          <div className="q">Decyzja — dopuszczenie zakładu do pracy</div>
          <div className="opts">
            <div><span className="box" /><b>TAK</b> — zakład dopuszczony do rozpoczęcia produkcji</div>
            <div><span className="box" /><b>NIE</b> — praca wstrzymana do usunięcia niezgodności</div>
          </div>
        </div>
        <div className="sg">
          <div className="lb">Zatwierdził — kierownik zakładu / osoba upoważniona</div>
          <div className="ln" />
        </div>
      </div>

      <div className="foot">
        <span>FIH 06/1/1</span>
      </div>
    </div>
  )
}

const CSS = `
/* UWAGA: pliki -latin-ext zawierają WYŁĄCZNIE glify latin-ext. Bez wariantu
   -latin (i bez unicode-range) ASCII spada na Arial — tekst robi się szerszy
   i arkusz przestaje mieścić się na jednej stronie. */
@font-face { font-family:'RCArk'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCArk'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin.woff2') format('woff2'); }
@font-face { font-family:'RCArk'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCArk'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin.woff2') format('woff2'); }

/* Boki 7 mm, nie 5 — przy 5 mm drukarki biurowe (strefa niedrukowalna
   ok. 6,4 mm) ucinały skrajną ramkę tabeli. */
@page { size:A4 portrait; margin:5mm 7mm; }
.ark, .ark * { box-sizing:border-box; }
.ark { font-family:'RCArk',Arial,sans-serif; color:#111; font-size:7pt; line-height:1.15;
  background:#fff; width:200mm; margin:0 auto; padding:5mm;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media print { .ark { width:auto; margin:0; padding:0; } }

.ark .top { display:flex; align-items:flex-start; gap:6mm; }
.ark .top img { height:12mm; }
.ark .plant { flex:1; text-align:center; padding-top:1mm; }
.ark .plant .nm { font-weight:700; font-size:9pt; letter-spacing:.02em; }
.ark .plant .ad { font-size:7pt; color:#333; }

/* Kolor wyłącznie w logo — reszta arkusza czarno-biała (dobrze kseruje). */
.ark .rule { height:1.4mm; margin:2mm 0 0; background:#111; }
.ark h1 { font-size:10.5pt; font-weight:700; text-align:center; letter-spacing:.04em;
  margin:1.8mm 0 1.6mm; text-transform:uppercase; }

.ark .meta { display:flex; gap:2mm; margin-bottom:2mm; }
.ark .fld { flex:1; border:.35mm solid #111; padding:.8mm 1.4mm; min-height:8mm; }
.ark .fld .lb { font-size:5.8pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#444; }
/* wartość wstawiana przez system (nr karty, data) — nie do wypełniania ręcznie */
.ark .fld .vl { font-size:9pt; font-weight:700; margin-top:.6mm;
  font-variant-numeric:tabular-nums; }
.ark .fld.w3 { flex:3; }

.ark .grid { display:flex; gap:2.4mm; }
.ark table.chk { flex:1; border-collapse:collapse; table-layout:fixed; }
.ark table.chk th { background:#111; color:#fff; font-size:6pt; font-weight:700;
  text-transform:uppercase; letter-spacing:.03em; padding:.9mm .8mm; text-align:left; }
.ark table.chk td { border:.28mm solid #999; padding:.3mm .7mm; height:4.0mm;
  vertical-align:middle; }
.ark table.chk .lp { width:7.5mm; text-align:right; font-size:6pt; color:#444;
  font-variant-numeric:tabular-nums; }
/* CZYSTA biel — znaczek długopisem ma być dobrze widoczny */
.ark table.chk td.res { width:11mm; background:#fff; }
/* nagłówki muszą wygrać z kolorem klasy .lp/.res, inaczej znikają na czerni */
.ark table.chk th.lp, .ark table.chk th.res { color:#fff; background:#111; }
.ark table.chk th.res { text-align:center; width:11mm; }
.ark table.chk tr.sec .lp { font-weight:700; color:#111; font-size:7pt; }
.ark table.chk tr.sec .txt { font-weight:700; font-size:6.1pt; text-transform:uppercase;
  line-height:1.05; }
.ark table.chk tr.sec td { background:#e9e9e9; border-top:.5mm solid #111; }
.ark table.chk .txt { font-size:6.3pt; }

.ark .legend { display:flex; align-items:center; gap:4mm; margin-top:2.2mm;
  border:.35mm solid #111; padding:1.2mm 2mm; }
.ark .legend .ti { font-weight:700; font-size:6.2pt; text-transform:uppercase;
  letter-spacing:.04em; }
.ark .legend .it { font-size:6.4pt; }
.ark .legend .sym { display:inline-block; min-width:5mm; text-align:center;
  font-weight:700; border:.3mm solid #111; margin-right:1mm; padding:0 .6mm; }

.ark .nz { margin-top:2mm; }
.ark .nz table { width:100%; border-collapse:collapse; table-layout:fixed; }
.ark .nz th { background:#111; color:#fff; font-size:6pt; font-weight:700;
  text-transform:uppercase; letter-spacing:.03em; padding:.9mm .8mm; text-align:left; }
.ark .nz td { border:.28mm solid #999; height:7mm; padding:.5mm .8mm; }

.ark .sign { display:flex; gap:3mm; margin-top:2.4mm; align-items:stretch; }
.ark .dec { flex:1.5; border:.35mm solid #111; padding:1.4mm 2mm; }
.ark .dec .q { font-weight:700; font-size:7pt; text-transform:uppercase; }
.ark .dec .opts { margin-top:1.4mm; font-size:6.6pt; line-height:1.9; }
.ark .box { display:inline-block; width:4.5mm; height:4.5mm; border:.4mm solid #111;
  vertical-align:-1mm; margin-right:1.5mm; }
.ark .sg { flex:1; border:.35mm solid #111; padding:1.4mm 2mm; display:flex;
  flex-direction:column; justify-content:space-between; }
.ark .sg .lb { font-size:5.8pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#444; }
.ark .sg .ln { border-bottom:.3mm dotted #666; height:6mm; }
.ark .foot { display:flex; justify-content:flex-end; margin-top:1.6mm;
  font-size:6.4pt; font-weight:700; color:#222;
  letter-spacing:.04em; }
`
