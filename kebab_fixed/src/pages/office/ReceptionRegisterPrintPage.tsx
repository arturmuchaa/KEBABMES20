/**
 * Rejestr przyjęcia artykułów pochodzenia zwierzęcego — karty 1.1.1 i 1.1.1/2
 * (oPRP), PUSTE druki do wypełnienia długopisem.
 *
 * MES ich nie wypełnia: przyjęcia biuro prowadzi ręcznie, poza systemem. MES
 * daje kartę ponumerowaną i w tym samym stylu co reszta księgi HACCP, żeby
 * segregator nie był zlepkiem druków z trzech epok. Ten sam mechanizm co
 * arkusz dopuszczenia i karta temperatur (routes/haccp_forms.py → PDF).
 *
 * Karta = MIESIĄC (lib/haccpCardHistory). Jeden wiersz to jedna dostawa, więc
 * karta dzienna byłaby w większości pusta; gdy miesiąc nie mieści się na
 * kartce, biuro dodrukowuje kolejną i wpisuje „Strona" ręcznie.
 *
 * WYGLĄD = karta 5.1.1.1 (TemperatureLogPrintPage): ta sama typografia, belka,
 * pola meta, paski nagłówków i stopka. Kolor wyłącznie w logo — reszta w skali
 * szarości, żeby karta dobrze się kserowała.
 *
 * Wobec starego druku (Edycja 2) zmienia się WYŁĄCZNIE forma:
 *  • czerwone nazwy pól → czarne (czerwień znikała na kserokopii),
 *  • nagłówki pisane pionowo → poziomo drobnym pismem (pionowe były
 *    nieczytelne po zeskanowaniu),
 *  • „Oceniane parametry" rozdzielone na ocenę (f–k) i potwierdzenie (l–m) —
 *    wykonał/sprawdził nigdy nie były parametrem oceny.
 * Zestaw, kolejność i LITERY kolumn bez zmian: opisy niezgodności powołują się
 * na litery, więc nie wolno ich przenumerować.
 *
 * Samodzielne strony (wzór SanitaryCheckPrintPage) — auto-print po załadowaniu:
 *   /office/rejestr-przyjecia/druk              (1.1.1)
 *   /office/rejestr-przyjecia-szczegolowy/druk  (1.1.1/2)
 *     ?od=YYYY-MM-DD  dowolny dzień z miesiąca karty (domyślnie dziś)
 *     ?pdf=1          wyłącza auto-print (render do PDF)
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { receptionCardNo } from '@/lib/haccpCardHistory'
import { receptionChecksApi, receptionsApi } from '@/lib/apiClient'
import { useApi } from '@/hooks/useApi'
import { detailRows, mainRows, paginate, type Cell } from '@/lib/receptionRegisterRows'
import { NOTA_PODPISOW_ELEKTRONICZNYCH } from '@/lib/notaPodpisow'
import { drukuj } from '@/lib/print'
import { PrintToolbar } from '@/components/print/PrintToolbar'

/** Pusty wiersz do wypełnienia — tyle, ile mieści się na jednej kartce. */
const ROWS_MAIN = 12
const ROWS_DETAIL = 13

/** Szerokości w mm; muszą sumować się do szerokości kolumny tekstu (283 mm). */
const SHEET_MM = 283

export type Col = { letter: string; w: number; label: string }

const COLS_MAIN: Col[] = [
  { letter: 'a', w: 16, label: 'Numer przyjęcia' },
  { letter: 'b', w: 27, label: 'Skrócona nazwa dostawcy' },
  { letter: 'c', w: 34, label: 'Asortyment' },
  { letter: 'd', w: 16, label: 'Data dostawy' },
  { letter: 'e', w: 30, label: 'HDI lub numer faktury, WZ lub inny dokument przywozowy' },
  { letter: 'f', w: 24, label: 'Ocena wizualna dostawy. Książka mycia pojazdu' },
  { letter: 'g', w: 15, label: 'Komora [°C]' },
  { letter: 'h', w: 15, label: 'Mięso [°C]' },
  { letter: 'i', w: 22, label: 'Zgodność kg z zamówieniem i dokumentami' },
  { letter: 'j', w: 30, label: 'Uwagi' },
  { letter: 'k', w: 18, label: 'Ocena całej dostawy' },
  { letter: 'l', w: 18, label: 'Wykonał' },
  { letter: 'm', w: 18, label: 'Sprawdził' },
]

const COLS_DETAIL: Col[] = [
  { letter: 'a', w: 26, label: 'Numer przyjęcia' },
  { letter: 'b', w: 30, label: 'Numer przyjęcia zewnętrznego' },
  { letter: 'c', w: 24, label: 'Waga [kg]' },
  { letter: 'd', w: 26, label: 'Data uboju' },
  { letter: 'e', w: 30, label: 'Termin ważności' },
  { letter: 'f', w: 22, label: 'Cena [zł/kg]' },
  { letter: 'g', w: 24, label: 'Mięso [kg]' },
  { letter: 'h', w: 65, label: 'Uwagi' },
  // Ostatnia kolumna oryginału była bez opisu — i tak służyła za podpis.
  { letter: 'i', w: 36, label: 'Podpis' },
]

const pct = (mm: number) => `${((mm / SHEET_MM) * 100).toFixed(3)}%`

/** Miesiąc karty z `?od=` (dowolny dzień miesiąca) — domyślnie bieżący. */
function cardMonth(od: string | null): Date {
  const seed = od && /^\d{4}-\d{2}-\d{2}$/.test(od) ? new Date(`${od}T00:00:00`) : new Date()
  const d = isNaN(+seed) ? new Date() : seed
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/** Pierwszy i ostatni dzień miesiąca karty — okno zapytania o dostawy. */
function monthRange(month: Date): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    from: iso(new Date(month.getFullYear(), month.getMonth(), 1)),
    to:   iso(new Date(month.getFullYear(), month.getMonth() + 1, 0)),
  }
}

/**
 * RegisterCard — karta jako CAŁOŚĆ: tyle kartek, ile trzeba na dane miesiąca.
 *
 * Bez `?dane=1` drukuje się jedna pusta karta do wypełnienia długopisem —
 * tak, jak zakład prowadzi ją dziś. Z `?dane=1` MES wypełnia to, co wie
 * (numery, dostawca, asortyment, daty, dokument); kolumny oceny zostają puste,
 * bo to zapis z pomiaru przy aucie, a nie z bazy.
 */
export function RegisterCard(props: {
  od: string | null; isPdf: boolean; withData: boolean; title: string; subtitle: string
  cols: Col[]; rows: number; card: string; legend: ReactNode; head?: ReactNode
  build: (recs: any[], cols: number, checks?: Record<string, any>) => Cell[][]
  /** Skąd wziąć wiersze miesiąca. Domyślnie przyjęcia surowca (karty 1.1.1
   *  i 1.1.1/2); karta 1.3.1 podaje tu rejestr DDFiP — oprawa, siatka i CSS
   *  zostają te same, bo to JEDNA karta księgi w dwóch odmianach. */
  fetch?: (range: { from: string; to: string }) => Promise<any[]>
}) {
  const { od, isPdf, withData, rows, build, cols, fetch } = props
  const month = cardMonth(od)
  const range = useMemo(() => monthRange(month), [month.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps

  const pobierz = fetch ?? receptionsApi.list
  const { data } = useApi(
    () => withData ? pobierz(range) : Promise.resolve([]),
    [withData, range.from, range.to],
  )

  // Wpisy kontroli HACCP miesiąca — źródło kolumn f-m karty 1.1.1.
  // Osobne żądanie, nie doładowanie listy przyjęć: ta lista jest używana
  // w pięciu innych miejscach i nie ma po co wozić tam podpisów.
  const { data: checks } = useApi(
    () => withData ? receptionChecksApi.forRange(range.from, range.to) : Promise.resolve([]),
    [withData, range.from, range.to],
  )
  const checksById = useMemo(() => {
    const out: Record<string, any> = {}
    for (const c of (checks ?? []) as any[]) out[c.receptionId] = c
    return out
  }, [checks])

  const pages = useMemo(
    () => paginate(withData ? build(data ?? [], cols.length, checksById) : [], rows),
    [withData, data, build, cols.length, rows, checksById])

  useEffect(() => {
    document.title = props.title
    if (isPdf) return
    // Druk dopiero, gdy dane doszły — inaczej okno druku otwiera się nad
    // pustą kartą i operator drukuje niewypełnioną.
    if (withData && data === null) return
    const t = setTimeout(() => void drukuj(), 600)
    return () => clearTimeout(t)
  }, [isPdf, props.title, withData, data])

  return (
    <>
      {pages.map((pageRows, i) => (
        <RegisterSheet key={i} {...props} month={month}
          page={i + 1} pages={pages.length} data={pageRows} />
      ))}
    </>
  )
}

/** Komórka karty: tekst albo podpis. Obrazek skalujemy do WYSOKOŚCI kratki
 *  (9,5 mm w 1.1.1), żeby podpis nie rozpychał wiersza i karta nadal
 *  mieściła się na jednej kartce. */
function renderCell(cell: Cell | undefined) {
  if (!cell) return ''
  if (typeof cell === 'string') return cell
  // Obrazek + nazwisko muszą się zmieścić w kratce 9,5 mm, stąd niższy
  // podpis niż wcześniej. Nazwisko jest tu ważniejsze od rozmachu kreski:
  // rysunek jest ozdobą, dowodem jest imię i nazwisko z datą.
  return (
    <>
      <img className="sig" src={cell.png} alt="" />
      {cell.name ? <span className="signame">{cell.name}</span> : null}
      {cell.when ? <span className="sigwhen">{cell.when}</span> : null}
    </>
  )
}

/** Wspólna oprawa obu kart: nagłówek → belka → tytuł → pola meta → tabela. */
function RegisterSheet({ month, title, subtitle, cols, rows, card, legend, head,
                        page, pages, data }: {
  month: Date; title: string; subtitle: string
  cols: Col[]; rows: number; card: string; legend: ReactNode; head?: ReactNode
  page: number; pages: number; data: Cell[][]
}) {
  const monthLabel = month.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
  const children = head

  return (
    <div className="reg">
      <style>{CSS}</style>

      <div className="top">
        <img src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>
      <div className="rule" />

      <h1>{title}</h1>
      <div className="sub">{subtitle}</div>

      <div className="meta">
        <div className="fld"><div className="lb">Nr karty</div><div className="vl">{receptionCardNo(month)}</div></div>
        <div className="fld"><div className="lb">Miesiąc</div><div className="vl">{monthLabel}</div></div>
        <div className="fld sm">
          <div className="lb">Strona</div>
          <div className="vl">{pages > 1 ? `${page} / ${pages}` : ''}</div>
        </div>
        <div className="fld w2"><div className="lb">Osoba odpowiedzialna za przyjęcia</div><div className="vl" /></div>
      </div>

      <table className="reg-t">
        <colgroup>
          {cols.map(c => <col key={c.letter} style={{ width: pct(c.w) }} />)}
        </colgroup>
        {children ?? (
          <thead>
            <tr>{cols.map(c => <th key={c.letter} className="hd">{c.label}</th>)}</tr>
            <tr className="ltr">{cols.map(c => <th key={c.letter}>{c.letter}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {/* Zawsze pełna siatka wierszy: karta ma wyglądać identycznie pustą
              i wypełnioną, a wolne kratki służą do dopisania ręką. */}
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cols.map((c, i) => <td key={c.letter}>{renderCell(data[r]?.[i])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>

      {legend}

      {/* Obie karty mają kolumnę potwierdzenia wypełnianą podpisem
          elektronicznym, więc nota jest na obu. Gdyby kiedyś powstał
          arkusz BEZ podpisów, dopiero wtedy warto ją uzależnić od kolumn. */}
      <div className="enote">{NOTA_PODPISOW_ELEKTRONICZNYCH}</div>

      <div className="foot">
        <span className="l">Przechowywanie zapisu: min. 1 rok</span>
        <span>{card}</span>
      </div>
    </div>
  )
}

export function Legend({ items }: { items: string[] }) {
  return (
    <div className="legend">
      <PrintToolbar />
      <span className="ti">Zasady wypełniania</span>
      {items.map((t, i) => <span key={i} className="it">{t}</span>)}
    </div>
  )
}

/** Karta 1.1.1 — zbiorczy rejestr dostaw. */
export function ReceptionRegisterPrintPage() {
  const [params] = useSearchParams()
  const cols = COLS_MAIN
  return (
    <RegisterCard
      od={params.get('od')}
      isPdf={params.get('pdf') === '1'}
      withData={params.get('dane') === '1'}
      build={mainRows}
      title="Rejestr przyjęcia artykułów pochodzenia zwierzęcego"
      subtitle="Kontrola dostawy przy przyjęciu — wpis ręczny dla każdej dostawy, w dniu jej przyjęcia"
      cols={cols}
      rows={ROWS_MAIN}
      card="Karta 1.1.1 do instrukcji 1.1 — operacyjne programy warunków wstępnych (oPRP)"
      /* Oznaczenia DOKŁADNIE wg instrukcji 1.1 (b/z, N, K). Wcześniej karta
         miała ✓/✗/ND — symbole, których procedura w ogóle nie przewiduje. */
      legend={<Legend items={[
        'kol. f, i — ocena: b/z bez zastrzeżeń albo N niezgodne',
        'kol. k — kwalifikacja: K dostawa przyjęta albo N odmowa przyjęcia',
        'kol. g, h — NAJWYŻSZA zmierzona temperatura; drób do +4 °C, mięso czerwone do +7 °C',
        'surowiec MROŻONY (oznaczony w kol. c): do −12 °C — próg zakładowy, instrukcja 1.1 progu dla mrożonego jeszcze nie podaje',
        'niezgodność ilościowa: wpisać ilość rzeczywiście przyjętą, uwagę w kol. j i wyegzekwować korektę dokumentów od dostawcy',
        'dostawę odrzuconą również się rejestruje — służy do oceny dostawców',
      ]} />}
      head={<>{/* Szapka trójpoziomowa: para „Komora / Mięso” siedzi pod wspólnym
          nagłówkiem „Temperatura”, jak para „na chłodni / w mięsie” w karcie
          temperatur. Grupy są SZARE (nie białe) — biel czytała się jak dziura
          w tabeli, a nie jak akcent. */}
      <thead>
        <tr>
          {cols.slice(0, 5).map(c => <th key={c.letter} className="hd" rowSpan={3}>{c.label}</th>)}
          <th className="grp" colSpan={6}>Oceniane parametry</th>
          <th className="grp" colSpan={2}>Potwierdzenie</th>
        </tr>
        <tr>
          <th className="hd" rowSpan={2}>{cols[5].label}</th>
          {/* „najwyższa zmierzona" wprost w szapce: instrukcja 1.1 każe wpisywać
              NAJWYŻSZY odczyt (z rejestratora auta i z kolejnych palet), a nie
              średnią ani pierwszy pomiar — z samej kratki tego nie widać. */}
          <th className="hd" colSpan={2}>Temperatura — najwyższa zmierzona</th>
          {cols.slice(8, 13).map(c => <th key={c.letter} className="hd" rowSpan={2}>{c.label}</th>)}
        </tr>
        <tr>
          <th className="hd sub2">{cols[6].label}</th>
          <th className="hd sub2">{cols[7].label}</th>
        </tr>
        <tr className="ltr">{cols.map(c => <th key={c.letter}>{c.letter}</th>)}</tr>
      </thead>
      </>}
    />
  )
}

/** Karta 1.1.1/2 — rozbicie dostawy na numery porządkowe (partie). */
export function ReceptionRegisterDetailPrintPage() {
  const [params] = useSearchParams()
  return (
    <RegisterCard
      od={params.get('od')}
      isPdf={params.get('pdf') === '1'}
      withData={params.get('dane') === '1'}
      build={detailRows}
      title="Rejestr przyjęcia artykułów pochodzenia zwierzęcego — część szczegółowa"
      subtitle="Jeden wiersz na numer przyjęcia zewnętrznego z dostawy zarejestrowanej w karcie 1.1.1"
      cols={COLS_DETAIL}
      rows={ROWS_DETAIL}
      card="Karta 1.1.1/2 do instrukcji 1.1 — operacyjne programy warunków wstępnych (oPRP)"
      legend={<Legend items={[
        'numer przyjęcia — ten sam, co w karcie 1.1.1 (np. 1/08)',
        'numer przyjęcia zewnętrznego — roczny numer nadawany partii surowca (instrukcja 1.1)',
        'waga — z dokumentu dostawy; różnicę po ważeniu opisać w kol. „Uwagi”',
        '„Mięso [kg]” uzupełnia się po rozbiorze partii',
      ]} />}
    />
  )
}

const CSS = `
/* UWAGA: pliki -latin-ext zawierają WYŁĄCZNIE glify latin-ext. Bez wariantu
   -latin (i bez unicode-range) ASCII spada na Arial — tekst robi się szerszy
   i karta przestaje mieścić się na jednej stronie. */
@font-face { font-family:'RCReg'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCReg'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin.woff2') format('woff2'); }
@font-face { font-family:'RCReg'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCReg'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin.woff2') format('woff2'); }

/* Boki 7 mm — przy 5 mm drukarki biurowe ucinały skrajną ramkę tabeli. */
@page { size:A4 landscape; margin:5mm 7mm; }
.reg, .reg * { box-sizing:border-box; }
.reg { font-family:'RCReg',Arial,sans-serif; color:#111; font-size:7pt; line-height:1.15;
  background:#fff; width:283mm; margin:0 auto; padding:5mm;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media print { .reg { width:auto; margin:0; padding:0; } }
/* Karta miesięczna z danymi bywa wielostronicowa (ok. 2 dostawy dziennie).
   Każda kartka ma własną szapkę i numer strony, więc łamiemy PRZED kolejną,
   a nie po ostatniej — inaczej drukarka wypluwa pustą kartkę na końcu. */
.reg + .reg { break-before:page; page-break-before:always; }
@media screen { .reg + .reg { margin-top:8mm; } }

.reg .top { display:flex; align-items:flex-start; gap:6mm; }
.reg .top img { height:10mm; }
.reg .plant { flex:1; text-align:center; padding-top:.8mm; }
.reg .plant .nm { font-weight:700; font-size:9pt; letter-spacing:.02em; }
.reg .plant .ad { font-size:7pt; color:#333; }

/* Belka odsunięta od logo — dosunięta zlewała się ze sloganem w znaku. */
.reg .rule { height:1.4mm; margin:2.6mm 0 0; background:#9a9a9a; }
.reg h1 { font-size:11.5pt; font-weight:700; text-align:center; letter-spacing:.04em;
  margin:1.4mm 0 .5mm; text-transform:uppercase; }
.reg .sub { text-align:center; font-size:6.8pt; color:#444; margin-bottom:1.4mm; }

.reg .meta { display:flex; gap:2mm; margin-bottom:1.4mm; }
.reg .fld { flex:1; border:.35mm solid #777; padding:.9mm 1.6mm; min-height:8.5mm; }
.reg .fld.w2 { flex:2; }
.reg .fld.sm { flex:.5; }
.reg .fld .lb { font-size:6.4pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
.reg .fld .vl { font-size:10pt; font-weight:700; margin-top:.7mm; min-height:4mm; }

.reg table.reg-t { width:100%; border-collapse:collapse; table-layout:fixed; }
.reg table.reg-t th { border:.28mm solid #8c8c8c; padding:.8mm .5mm;
  text-align:center; vertical-align:middle; color:#1a1a1a; font-weight:700; }
/* Trzy szarości i tylko trzy: belka grup, nagłówek kolumny, pasek liter.
   Żadnych białych kafli w szapce — po wydruku wyglądały na braki w tabeli. */
.reg table.reg-t th.grp { background:#dcdcdc; font-size:7pt; text-transform:uppercase;
  letter-spacing:.06em; padding:.7mm .5mm; }
.reg table.reg-t th.hd { background:#ededed; font-size:6.2pt; text-transform:uppercase;
  letter-spacing:.02em; line-height:1.12; }
.reg table.reg-t th.hd.sub2 { font-size:6.6pt; letter-spacing:.03em; }
.reg table.reg-t tr.ltr th { background:#e6e6e6; color:#444; font-size:6.8pt;
  font-weight:400; padding:.6mm 0; letter-spacing:.06em; }
/* CZYSTA biel w polach do wpisania — litery długopisem mają być widoczne */
.reg table.reg-t td { border:.28mm solid #8c8c8c; height:9.5mm; padding:.2mm .5mm;
  background:#fff; }

/* Legenda leci CIĄGIEM z kropkami, nie flexem: przy pięciu pozycjach flex
   robił z niej pięć nierównych kolumn łamanych w losowych miejscach. */
.reg .legend { margin-top:1.4mm; border:.35mm solid #777; padding:.9mm 2mm;
  line-height:1.45; }
.reg .legend .ti { font-weight:700; font-size:6.8pt; text-transform:uppercase;
  letter-spacing:.04em; margin-right:3mm; }
.reg .legend .it { font-size:6.8pt; }
.reg .legend .it + .it::before { content:'•'; color:#888; margin:0 2.5mm; }

.reg .enote { margin-top:1.2mm; font-size:6pt; line-height:1.2; color:#555;
  text-align:justify; }
.reg .foot { display:flex; justify-content:space-between; margin-top:1.6mm;
  font-size:6.8pt; font-weight:700; color:#333; letter-spacing:.04em; }
.reg .sig { height:4.4mm; width:auto; max-width:100%; object-fit:contain; display:block; margin:0 auto; }
.reg .signame { display:block; text-align:center; font-size:4.8pt; line-height:1.02;
  color:#222; letter-spacing:0; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.reg .sigwhen { display:block; text-align:center; font-size:4.3pt; line-height:1.02;
  color:#555; white-space:nowrap; }
.reg .foot .l { font-weight:400; color:#555; }
`
