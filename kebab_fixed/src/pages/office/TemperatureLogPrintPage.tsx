/**
 * TemperatureLogPrintPage — karta odczytu temperatur pomieszczeń zakładu,
 * do druku i wypełnienia długopisem. W stopce numer karty 5.1.1.1 do
 * instrukcji 5.1 (PRPs); stary numer FIH 09/2/1 należał do poprzedniej
 * księgi HACCP i nie jest przenoszony.
 *
 * ZAKRES = nowy HACCP: dokładnie te pomieszczenia, które w karcie 5.1.1.1
 * (Ocena SSZiZ) mają „lokalny wpis temperatury", z ich numerami i temperaturą
 * wymaganą (Infom_Temp). Temperaturę odczytuje się RĘCZNIE podczas obchodu
 * i wpisuje długopisem — karta jest zapisem tego odczytu, nie wydrukiem
 * z systemu (instrukcja 5.1 PRPs).
 *
 * FORMA = stara karta kontroli temperatury: szeroka siatka dat × punktów
 * pomiarowych, podpis w każdym wierszu, a dla magazynów chłodzonych PARA
 * kolumn „na chłodni / w mięsie". Stara karta była czytelniejsza od nowej
 * listy pionowej — jedna kartka pokrywa cały okres, a odchylenie widać
 * w kolumnie od razu.
 *
 * CZĘSTOTLIWOŚĆ = raz dziennie, wbrew starej karcie (miała dwie kontrole).
 * 5.1 PRPs mówi tylko „oceny dokonuje się codziennie", a odczyt temperatury
 * jest elementem obchodu SSZiZ; zdanie o obserwacjach „przed rozpoczęciem
 * produkcji, a także w trakcie produkcji" dotyczy stanu sanitarnego, nie
 * temperatury — dla kontroli w czasie procesu instrukcja każe jedynie dopisać
 * adnotację. Ciągły zapis prowadzi centralny system rejestracji.
 *
 * WYGLĄD = arkusz dopuszczenia zakładu do pracy (SanitaryCheckPrintPage):
 * ta sama typografia, belka pod nagłówkiem, paski nagłówków tabel, ramkowane
 * pola meta i legenda. Kolor wyłącznie w logo — reszta w skali szarości, żeby
 * karta dobrze się kserowała. Belki są SZARE, nie czarne: przy tygodniowej
 * karcie szapka zajmuje sporą część strony i czerń robiła się ciężka.
 *
 * Karta = jeden tydzień (pon–ndz). Siedem wierszy zamiast kilkunastu zwalnia
 * pionu na tyle, że kratka i opisy są znacznie większe — cała ta przestrzeń
 * idzie w czytelność, nie w puste marginesy.
 * Numer karty = tydzień w miesiącu, np. 01/08/2026 (lib/temperatureLogCard).
 *
 * Samodzielna strona (wzór SanitaryCheckPrintPage):
 * /office/kontrola-temperatury/druk — auto-print po załadowaniu.
 *   ?od=YYYY-MM-DD  dowolny dzień z żądanego okresu (domyślnie dziś)
 *   ?pdf=1          wyłącza auto-print (render do PDF)
 */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cardPeriod } from '@/lib/temperatureLogCard'
import { drukuj } from '@/lib/print'
import { PrintToolbar } from '@/components/print/PrintToolbar'

/** Jedna kratka pomiarowa: opcjonalna podetykieta + temperatura wymagana. */
type Col = { label?: string; req: string; w: number }
type Room = { group: string; no: number; name: string; cols: Col[] }

/** Magazyny chłodzone mierzy się dwukrotnie, więc ich kolumny są węższe.
 *  Wartości są WAGAMI, nie procentami — realną szerokość liczy `colPct`. */
const SPLIT_W = 5.0
const PLAIN_W = 6.25

/**
 * Pomieszczenia wg karty 5.1.1.1 (kolumna „Numer" i „Infom_Temp").
 * Kolejność: pogrupowana funkcjonalnie, nie po numerze — tak jak w starej
 * karcie, gdzie chłodnie stały obok siebie, a mroźnie obok siebie.
 *
 * Magazyn surowców i porozbiorowy mają PARĘ kolumn (powietrze + mięso), jak
 * w starej karcie: sama temperatura w komorze nie mówi, czy wychłodził się
 * towar. Pozostałe pomieszczenia to jedna kratka — tam mierzy się otoczenie.
 */
const plain = (req: string): Col[] => [{ req, w: PLAIN_W }]
const withMeat = (req: string, meat: string): Col[] => [
  { label: 'na chłodni', req, w: SPLIT_W },
  { label: 'w mięsie', req: meat, w: SPLIT_W },
]

/**
 * Miękki dywiz (U+00AD) w długich nazwach: przy 15 pomieszczeniach kolumna ma
 * ~14 mm i słowa typu „przepakowania" muszą się złamać. Bez podpowiedzi
 * przeglądarka łamie je w losowym miejscu („PRZEPAKOWAN|IA") — z dywizem
 * łamie po sylabie i stawia kreskę, jak w składzie. Znak jest niewidoczny,
 * dopóki łamanie nie nastąpi.
 */
const SHY = '­'

const ROOMS: Room[] = [
  { group: 'Magazyny chłodzone',      no: 3,  name: 'Magazyn surowców',                        cols: withMeat('do +3 °C', 'do +4 °C') },
  { group: 'Magazyny chłodzone',      no: 4,  name: `Magazyn poroz${SHY}biorowy`,              cols: withMeat('do +3 °C', 'do +4 °C') },
  { group: 'Hale produkcyjne',        no: 7,  name: `Hala rozbioru i przepako${SHY}wania`,     cols: plain('do +12 °C') },
  // Pomieszczenia produkcji 14/15/8 — ten sam zestaw i ta sama kolejność co
  // w arkuszu dopuszczenia zakładu do pracy (SanitaryCheckPrintPage), żeby
  // obchód SSZiZ szedł oboma kartami w tej samej kolejności pomieszczeń.
  { group: 'Hale produkcyjne',        no: 14, name: `Pomieszcze${SHY}nie produkcji`,               cols: plain('do +12 °C') },
  { group: 'Hale produkcyjne',        no: 15, name: `Pomieszcze${SHY}nie produkcji`,               cols: plain('do +12 °C') },
  { group: 'Hale produkcyjne',        no: 8,  name: `Pomieszcze${SHY}nie produkcji`,               cols: plain('do +12 °C') },
  { group: 'Hale produkcyjne',        no: 12, name: `Hala masownia i leżako${SHY}wania`,           cols: plain('+4 do +6 °C') },
  // Nazwy i podział ściśle wg arkusza dopuszczenia (SanitaryCheckPrintPage):
  // szokowe 6/26 mrożą (-24 °C), składowe 29/38 przechowują (-18 °C).
  { group: 'Mroźnie', no: 6,  name: `Mroźnia szoko${SHY}wa`,                  cols: plain('-24 °C') },
  { group: 'Mroźnie', no: 26, name: `Mroźnia szoko${SHY}wa`,                  cols: plain('-24 °C') },
  { group: 'Mroźnie', no: 29, name: `Mroźnia skła${SHY}dowa`,                 cols: plain('-18 °C') },
  { group: 'Mroźnie', no: 38, name: `Mroźnia skła${SHY}dowa`,                 cols: plain('-18 °C') },
  { group: 'Ekspedycja',              no: 35, name: `Rampa ekspedy${SHY}cyjna`,                    cols: plain('do +12 °C') },
  { group: 'Ekspedycja',              no: 37, name: `Pomieszcze${SHY}nie komple${SHY}tacji przed wysyłką`, cols: plain('do +12 °C') },
  // grupa krótko „UPPZ" — „Magazyn UPPZ" zawijało belkę grup do dwóch linii
  { group: 'UPPZ',                    no: 32, name: 'Magazyn UPPZ',                            cols: plain('do +7 °C') },
]

/** Wszystkie kratki pomiarowe po kolei — do szerokości kolumn i numeracji. */
const ALL_COLS = ROOMS.flatMap(r => r.cols)

/**
 * Kolumny opisowe mają stałą szerokość, całą resztę strony dzielą kratki
 * pomiarowe PROPORCJONALNIE do swoich wag (SPLIT_W/PLAIN_W). Wcześniej były to
 * sztywne procenty sumujące się do 100 — dopisanie pomieszczenia rozjeżdżało
 * tabelę poza stronę i nikt by tego nie zauważył przed wydrukiem.
 */
const W_DATE = 6, W_HOUR = 5.3, W_SIGN = 7.8
const W_MEAS = 100 - W_DATE - W_HOUR - W_SIGN
const W_UNITS = ALL_COLS.reduce((s, c) => s + c.w, 0)
const colPct = (c: Col) => (c.w / W_UNITS) * W_MEAS

/** Grupy do nagłówka scalonego (colspan liczony w kratkach, nie w pokojach). */
function groupSpans(): { name: string; span: number }[] {
  const out: { name: string; span: number }[] = []
  for (const r of ROOMS) {
    const last = out[out.length - 1]
    if (last && last.name === r.group) last.span += r.cols.length
    else out.push({ name: r.group, span: r.cols.length })
  }
  return out
}

const WD = ['ndz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob']

const dm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`

export function TemperatureLogPrintPage() {
  const [params] = useSearchParams()
  const isPdf = params.get('pdf') === '1'
  const od = params.get('od')

  useEffect(() => {
    document.title = 'Karta kontroli temperatury pomieszczeń'
    if (isPdf) return
    const t = setTimeout(() => void drukuj(), 600)
    return () => clearTimeout(t)
  }, [isPdf])

  const seed = od && /^\d{4}-\d{2}-\d{2}$/.test(od) ? new Date(`${od}T00:00:00`) : new Date()
  const { no, days } = cardPeriod(isNaN(+seed) ? new Date() : seed)
  const first = days[0]
  const last = days[days.length - 1]
  const period = `${dm(first)} – ${dm(last)}.${last.getFullYear()}`

  const groups = groupSpans()
  const COLS = 2 + ALL_COLS.length + 1 // data + godzina + kratki pomiarowe + podpis

  return (
    <div className="tmp">
      <PrintToolbar />
      <style>{CSS}</style>

      <div className="top">
        <img src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>
      <div className="rule" />

      <h1>Karta kontroli temperatury pomieszczeń zakładu</h1>
      <div className="sub">
        Odczyt ręczny — raz dziennie, w ramach obchodu SSZiZ
      </div>

      <div className="meta">
        <div className="fld"><div className="lb">Nr karty</div><div className="vl">{no}</div></div>
        <div className="fld w2"><div className="lb">Okres</div><div className="vl">{period}</div></div>
        <div className="fld w2"><div className="lb">Osoba dokonująca odczytu</div></div>
      </div>

      <table className="log">
        {/* szerokości procentowe — kratki par „chłodnia + mięso" są węższe,
            żeby nie zjadły miejsca pozostałym pomieszczeniom */}
        <colgroup>
          <col style={{ width: `${W_DATE}%` }} />
          <col style={{ width: `${W_HOUR}%` }} />
          {ALL_COLS.map((c, i) => <col key={i} style={{ width: `${colPct(c).toFixed(3)}%` }} />)}
          <col style={{ width: `${W_SIGN}%` }} />
        </colgroup>
        <thead>
          <tr>
            <th className="dt" rowSpan={3}>Data</th>
            <th className="ck" rowSpan={3}>Godz.<br />odczytu</th>
            {groups.map(g => (
              <th key={g.name} className="grp" colSpan={g.span}>{g.name}</th>
            ))}
            <th className="sg" rowSpan={3}>Podpis osoby<br />kontrolującej</th>
          </tr>
          <tr>
            {ROOMS.map(r => (
              <th key={r.no} className="rm" colSpan={r.cols.length}>
                <span className="rn">{r.no}</span>
                <span className="rl">{r.name}</span>
              </th>
            ))}
          </tr>
          <tr>
            {ROOMS.map(r => r.cols.map((c, i) => (
              <th key={`${r.no}-${i}`} className="rq">
                {c.label && <span className="sc">{c.label}</span>}
                <span className="rt">{c.req}</span>
              </th>
            )))}
          </tr>
          <tr className="numr">
            {Array.from({ length: COLS }, (_, i) => <th key={i}>{i + 1}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={+d}>
              {/* weekend wyszarzony w kolumnie daty — od razu widać, gdzie kończy się tydzień */}
              <td className={d.getDay() % 6 === 0 ? 'dt wknd' : 'dt'}>
                <span className="dd">{dm(d)}</span>
                <span className="wd">{WD[d.getDay()]}</span>
              </td>
              <td className="ck" />
              {ALL_COLS.map((_, i) => <td key={i} className="v" />)}
              <td className="sg" />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="legend">
        <span className="ti">Zasady wypełniania</span>
        <span className="it">odczyt ręczny raz dziennie, w ramach obchodu SSZiZ — wartość w °C, z dokładnością do 0,1</span>
        <span className="it"><span className="sym">—</span>pomieszczenie nieużywane / puste</span>
        <span className="it">odczyt poza zakresem — zakreślić wartość i opisać w tabeli odchyleń</span>
        <span className="it">odczyt dodatkowy (w czasie procesu / na żądanie) — dopisać w tabeli odchyleń z adnotacją</span>
      </div>

      <div className="blk">
        <div className="cap">Odchylenia od temperatury wymaganej i działania korygujące</div>
        <table className="nz">
          <thead>
            <tr>
              <th style={{ width: '16mm' }}>Data</th>
              <th style={{ width: '14mm' }}>Godz.</th>
              <th style={{ width: '14mm' }}>Nr pom.</th>
              <th style={{ width: '18mm' }}>Odczyt [°C]</th>
              <th>Opis odchylenia i analiza zapisów systemu centralnego</th>
              <th>Działanie korygujące</th>
              <th style={{ width: '20mm' }}>Godz. usunięcia</th>
              <th style={{ width: '22mm' }}>Podpis</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map(i => <tr key={i}><td /><td /><td /><td /><td /><td /><td /><td /></tr>)}
          </tbody>
        </table>
      </div>

      <div className="blk">
        <div className="cap">
          Pomiar kontrolny w produkcie — przy wątpliwościach co do warunków środowiskowych
        </div>
        <table className="nz">
          <thead>
            <tr>
              <th style={{ width: '16mm' }}>Data</th>
              <th style={{ width: '14mm' }}>Godz.</th>
              <th style={{ width: '14mm' }}>Nr pom.</th>
              <th>Surowiec / półprodukt / wyrób gotowy — nr partii</th>
              <th style={{ width: '24mm' }}>Temp. w produkcie [°C]</th>
              <th>Decyzja</th>
              <th style={{ width: '22mm' }}>Podpis</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2].map(i => <tr key={i}><td /><td /><td /><td /><td /><td /><td /></tr>)}
          </tbody>
        </table>
      </div>

      <div className="sign">
        <div className="dec">
          <div className="q">Ocena okresu objętego kartą</div>
          <div className="opts">
            <span><span className="box" /><b>bez zastrzeżeń</b> — temperatury w zakresach wymaganych</span>
            <span><span className="box" /><b>odchylenia</b> — opisane w tabeli powyżej, działania podjęte</span>
          </div>
        </div>
        <div className="sg2">
          <div className="lb">Zweryfikował — osoba odpowiedzialna za HACCP / data</div>
          <div className="ln" />
        </div>
      </div>

      <div className="foot">
        <span className="l">Przechowywanie zapisu: min. 1 rok</span>
        <span>Karta 5.1.1.1 do instrukcji 5.1 — Programy warunków wstępnych (PRPs)</span>
      </div>
    </div>
  )
}

const CSS = `
/* UWAGA: pliki -latin-ext zawierają WYŁĄCZNIE glify latin-ext. Bez wariantu
   -latin (i bez unicode-range) ASCII spada na Arial — tekst robi się szerszy
   i karta przestaje mieścić się na jednej stronie. */
@font-face { font-family:'RCTmp'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCTmp'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin.woff2') format('woff2'); }
@font-face { font-family:'RCTmp'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCTmp'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin.woff2') format('woff2'); }

/* Boki 7 mm — przy 5 mm drukarki biurowe ucinały skrajną ramkę tabeli. */
@page { size:A4 landscape; margin:5mm 7mm; }
.tmp, .tmp * { box-sizing:border-box; }
.tmp { font-family:'RCTmp',Arial,sans-serif; color:#111; font-size:7pt; line-height:1.15;
  background:#fff; width:283mm; margin:0 auto; padding:5mm;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media print { .tmp { width:auto; margin:0; padding:0; } }

.tmp .top { display:flex; align-items:flex-start; gap:6mm; }
.tmp .top img { height:10mm; }
.tmp .plant { flex:1; text-align:center; padding-top:.8mm; }
.tmp .plant .nm { font-weight:700; font-size:9pt; letter-spacing:.02em; }
.tmp .plant .ad { font-size:7pt; color:#333; }

/* Kolor wyłącznie w logo — reszta karty w skali szarości (dobrze kseruje).
   Trzy poziomy szarości i tylko trzy: belka nadrzędna, belka nagłówka,
   ramka. Więcej odcieni robi z karty papkę. */
.tmp .rule { height:1.4mm; margin:2.6mm 0 0; background:#9a9a9a; }
.tmp h1 { font-size:11.5pt; font-weight:700; text-align:center; letter-spacing:.04em;
  margin:1.1mm 0 .5mm; text-transform:uppercase; }
.tmp .sub { text-align:center; font-size:6.8pt; color:#444; margin-bottom:1.2mm; }

.tmp .meta { display:flex; gap:2mm; margin-bottom:1.2mm; }
.tmp .fld { flex:1; border:.35mm solid #777; padding:.9mm 1.6mm; min-height:8mm; }
.tmp .fld.w2 { flex:2; }
.tmp .fld .lb { font-size:6.4pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
/* wartość wstawiana przez system (nr karty, okres) — nie do wypełniania ręcznie */
.tmp .fld .vl { font-size:10.5pt; font-weight:700; margin-top:.7mm;
  font-variant-numeric:tabular-nums; }

.tmp table.log { width:100%; border-collapse:collapse; table-layout:fixed; }
.tmp table.log th { background:#ededed; color:#1a1a1a; font-weight:700;
  border:.28mm solid #8c8c8c; padding:.8mm .5mm; text-align:center; vertical-align:middle; }
/* wysokość kratki dobrana empirycznie do maksimum mieszczącego się na jednej
   stronie — cały zapas z siedmiodniowej karty idzie w kratkę, nie w marginesy */
.tmp table.log td { border:.28mm solid #8c8c8c; height:7.3mm; padding:.2mm .5mm;
  text-align:center; vertical-align:middle; }

.tmp table.log th.dt, .tmp table.log td.dt { width:19mm; }
.tmp table.log th.ck, .tmp table.log td.ck { width:17mm; }
.tmp table.log th.sg, .tmp table.log td.sg { width:26mm; }
.tmp table.log th.dt, .tmp table.log th.ck, .tmp table.log th.sg {
  font-size:6.8pt; text-transform:uppercase; letter-spacing:.03em; line-height:1.2; }

/* belka grup — o ton ciemniejsza od nagłówków pomieszczeń, bo jest nadrzędna */
.tmp table.log th.grp { background:#dcdcdc; font-size:7pt; text-transform:uppercase;
  letter-spacing:.06em; padding:.7mm .5mm; }
/* Nazwy pomieszczeń MUSZĄ zostać w swojej kratce: przy 15 pomieszczeniach
   kolumna ma ~14 mm, a „PRZEPAKOWANIA" jest od niej szersze. Bez łamania
   długich słów napis wychodzi na sąsiednią kolumnę i karta robi się nieczytelna. */
.tmp table.log th.rm { padding:.6mm .4mm; overflow:hidden; }
.tmp table.log th.rm .rn { display:block; font-size:9pt; font-variant-numeric:tabular-nums;
  border-bottom:.25mm solid #999; margin:0 auto .5mm; width:7mm; }
/* BEZ overflow-wrap: awaryjne łamanie „gdziekolwiek" wygrywa z miękkim dywizem
   (łamacz bierze ostatnią możliwą pozycję), więc nazwy dzieliły się w losowym
   miejscu. Bez niego jedynymi punktami podziału są dywizy z SHY, a overflow
   hidden na komórce jest siatką bezpieczeństwa, gdyby ktoś dopisał długą
   nazwę bez dywizu — przytnie ją zamiast wypuścić na sąsiednią kolumnę. */
.tmp table.log th.rm .rl { display:block; font-size:5.5pt; font-weight:400; line-height:1.1;
  text-transform:uppercase; letter-spacing:0; hyphens:manual; }
/* temperatura wymagana — jedyny biały pas w szapce, żeby zakres rzucał się w oczy */
.tmp table.log th.rq { background:#fff; color:#111; font-size:7pt;
  border:.28mm solid #8c8c8c; padding:.5mm .2mm;
  font-variant-numeric:tabular-nums; }
/* para „na chłodni / w mięsie" — podpis nad zakresem, jak w starej karcie.
   Podpis może się zawinąć, ale sam zakres („do +3 °C") nigdy — złamana
   temperatura byłaby myląca w dokumencie kontrolnym. */
.tmp table.log th.rq .sc { display:block; font-size:5.1pt; font-weight:400; color:#444;
  text-transform:uppercase; letter-spacing:0; line-height:1.05; }
.tmp table.log th.rq .rt { display:block; line-height:1.15; white-space:nowrap; }
/* pasek numeracji kolumn — jak w starej karcie, ułatwia opis odchylenia
   („odczyt w kol. 9"), więc cyfry muszą być czytelne, nie mikroskopijne */
.tmp table.log tr.numr th { background:#f2f2f2; color:#444; font-size:6.8pt; font-weight:400;
  border:.28mm solid #8c8c8c; padding:.7mm 0; letter-spacing:.06em; }

.tmp table.log td.dt { font-weight:700; white-space:nowrap; }
.tmp table.log td.dt .dd { font-size:10pt; font-variant-numeric:tabular-nums; }
.tmp table.log td.dt .wd { font-size:6.4pt; font-weight:400; color:#555;
  text-transform:uppercase; letter-spacing:.06em; margin-left:1mm; }
.tmp table.log td.dt.wknd { background:#efefef; }
/* CZYSTA biel w polach do wpisania — cyfra długopisem ma być dobrze widoczna */
.tmp table.log td.v, .tmp table.log td.ck, .tmp table.log td.sg { background:#fff; }

.tmp .legend { display:flex; align-items:center; gap:4mm; margin-top:1.3mm;
  border:.35mm solid #777; padding:.9mm 2mm; }
.tmp .legend .ti { font-weight:700; font-size:6.8pt; text-transform:uppercase;
  letter-spacing:.04em; white-space:nowrap; }
.tmp .legend .it { font-size:6.8pt; }
.tmp .legend .sym { display:inline-block; min-width:5mm; text-align:center;
  font-weight:700; border:.3mm solid #777; margin-right:1mm; padding:0 .6mm; }

.tmp .blk { margin-top:1.2mm; }
.tmp .blk .cap { font-size:6.8pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; margin-bottom:.5mm; }
.tmp table.nz { width:100%; border-collapse:collapse; table-layout:fixed; }
.tmp table.nz th { background:#ededed; color:#1a1a1a; font-size:6.4pt; font-weight:700;
  border:.28mm solid #8c8c8c; text-transform:uppercase; letter-spacing:.03em;
  padding:.9mm .8mm; text-align:left; }
.tmp table.nz td { border:.28mm solid #8c8c8c; height:6mm; padding:.3mm .8mm; background:#fff; }

.tmp .sign { display:flex; gap:3mm; margin-top:1.3mm; align-items:stretch; }
.tmp .dec { flex:2; border:.35mm solid #777; padding:1.2mm 2mm; }
.tmp .dec .q { font-weight:700; font-size:7.2pt; text-transform:uppercase; letter-spacing:.03em; }
.tmp .dec .opts { margin-top:1.4mm; font-size:7.2pt; display:flex; gap:8mm; }
.tmp .box { display:inline-block; width:4.4mm; height:4.4mm; border:.4mm solid #777;
  vertical-align:-1mm; margin-right:1.4mm; }
.tmp .sg2 { flex:1; border:.35mm solid #777; padding:1.2mm 2mm; display:flex;
  flex-direction:column; justify-content:space-between; }
.tmp .sg2 .lb { font-size:6.4pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
.tmp .sg2 .ln { border-bottom:.3mm dotted #777; height:4mm; }

.tmp .foot { display:flex; justify-content:space-between; margin-top:1.4mm;
  font-size:6.8pt; font-weight:700; color:#333; letter-spacing:.04em; }
.tmp .foot .l { font-weight:400; color:#555; }
`
