/**
 * Etykieta partii przyprawionej — ZPL 100 × 150 mm, drukowana PO ODBIORZE
 * z masownicy, zaraz po wpisaniu zważonych kilogramów.
 *
 * Idzie na paletę z gotowym mięsem i ma odpowiedzieć na pytania, które padają
 * przy niej przez następne dni: co to za partia, z czego powstała, kiedy była
 * masowana i czy zgadza się waga. Numer partii jest największym napisem — po
 * niego operator sięga z drugiego końca hali; skład (palety i partie surowca)
 * jest tym, czego nie da się odtworzyć z pamięci po dwóch dniach.
 *
 * Rozmiar inny niż reszta etykiet (tamte 50 × 80 mm), bo to inna rolka: 100 mm
 * w poprzek taśmy daje miejsce na skład, którego na wąskiej nie było jak
 * zmieścić. Pułapki taśmy te same co w `byproductLabelZpl`: `^MNY` dla etykiet
 * wykrawanych i `^LH0,0` kasujące przesunięcie zapisane w drukarce.
 *
 * Czysta funkcja bez DOM — testowana jednostkowo (mixingLabelZpl.test.ts).
 */
import { LABEL_DPI, fmtLabelDate, fmtLabelKg, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_DOTS_H, LOGO_DOTS_W, labelLogoZpl } from '@/lib/labelLogo'

/** Rolka masowni: 100 mm w poprzek taśmy, 150 mm wzdłuż podawania. */
export const LABEL_W_MM = 100
export const LABEL_H_MM = 150

/** Rozdzielczość drukarki masowni — kiosk pamięta ją między uruchomieniami.
 *
 *  Ta sama etykieta wysłana na drukarkę 300 dpi wychodzi w dwóch trzecich
 *  rozmiaru i „od połowy", bo punkty są fizycznie mniejsze. Modelu nie da się
 *  zapytać jednostronnym drukiem, więc rozdzielczość ustawia się raz w menu
 *  serwisowym, zamiast zgadywać ją w kodzie. */
export const LABEL_DPI_KEY = 'kebab.masownia.labelDpi'

export function labelDpi(): number {
  try {
    const zapisane = Number(localStorage.getItem(LABEL_DPI_KEY))
    return zapisane === 300 || zapisane === 203 ? zapisane : LABEL_DPI
  } catch {
    return LABEL_DPI   // prywatne okno / zablokowane dane — działa jak 203
  }
}

/** Wysokość wiersza składu w mm. */
const WIERSZ_MM = 6.5
/** Ile milimetrów u dołu rezerwujemy na blok „masowanie" (godziny, maszyna).
 *  Skład rośnie z liczbą palet, więc to on musi ustąpić, a nie czasy — te są
 *  na etykiecie zawsze tak samo potrzebne. */
const STOPKA_MM = 22

const NA_SLUPKI = 'mat-mieso-zs'

export interface MixingLabelMeat {
  /** Numer palety z ważenia zbiorczego; pusty, gdy kilogramy szły bez palety. */
  palletNo?: string | null
  lotNo: string
  kg: number
  materialName?: string | null
  materialTypeId?: string | null
}

export interface MixingLabelInput {
  /** Numer partii przyprawionej — „563" albo „PP26". */
  batchNo: string
  recipeName?: string | null
  orderNo?: string | null
  machineId?: number | null
  /** Kilogramy mięsa włożone do masownicy. */
  kgMeat: number
  /** Ile powinno wyjść wg receptury (mięso + przyprawy + woda). */
  kgExpected: number
  /** Ile operator zważył paleciakiem po odbiorze. */
  kgWeighed: number
  /** ISO — start maszyny (nie załadunek: liczy się to, co maszyna przepracowała). */
  startedAt?: string | null
  /** ISO — odbiór. */
  finishedAt?: string | null
  mixMinutes?: number | null
  /** Numer palety wyrobu — własny ciąg od 1, nadawany przy odbiorze. */
  palletNo?: number | null
  meat: MixingLabelMeat[]
}

export interface MixingLabelOptions {
  dpi?: number
  copies?: number
}

/** Znaki sterujące ZPL z DANYCH (^ ~) rozbiłyby komendy — wycinamy je. */
function esc(value: string): string {
  return (value ?? '').replace(/[\^~]/g, ' ')
}

/** ISO → „HH:MM". Brak/śmieć → pusto: „Invalid Date" na etykiecie towaru to
 *  gorzej niż pusta rubryka. */
export function fmtLabelTime(iso?: string | null): string {
  const d = new Date(iso ?? '')
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function text(xMm: number, yMm: number, fontMm: number, value: string, dpi: number): string {
  const h = mmToDots(fontMm, dpi)
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^A0N,${h},${h}^FD${esc(value)}^FS`
}

/** Napis dosunięty do PRAWEJ krawędzi pola zadruku (ZPL ^FB z justowaniem).
 *  Kolumna kilogramów ustawiana „na oko" na stałym X zachodziła na dłuższe
 *  opisy palet — przy „PAL/18/09/26/3 · partia 563" zlewała się w jeden ciąg. */
function textRight(xMm: number, yMm: number, wMm: number, fontMm: number, value: string, dpi: number): string {
  const h = mmToDots(fontMm, dpi)
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^A0N,${h},${h}`
    + `^FB${mmToDots(wMm, dpi)},1,0,R^FD${esc(value)}^FS`
}

function line(xMm: number, yMm: number, wMm: number, dpi: number): string {
  const t = Math.max(1, mmToDots(0.6, dpi))
  return `^FO${mmToDots(xMm, dpi)},${mmToDots(yMm, dpi)}^GB${mmToDots(wMm, dpi)},${t},${t}^FS`
}

/** Surowce inne niż codzienne mięso z/s — na etykiecie widoczne wielkimi
 *  literami, tak samo jak na kafelkach panelu. */
export function surowceEtykiety(meat: MixingLabelMeat[]): string[] {
  const nazwy = new Set<string>()
  for (const m of meat ?? []) {
    if ((m.materialTypeId || NA_SLUPKI) === NA_SLUPKI) continue
    const n = (m.materialName || '').trim().toUpperCase()
    if (n) nazwy.add(n)
  }
  return [...nazwy]
}

/** Partie surowca, z których powstała ta partia przyprawiona. */
export function partieSurowca(meat: MixingLabelMeat[]): string[] {
  return [...new Set((meat ?? []).map(m => String(m.lotNo || '').trim()).filter(Boolean))].sort()
}

export function mixingLabelZpl(
  input: MixingLabelInput,
  { dpi = labelDpi(), copies = 1 }: MixingLabelOptions = {},
): string {
  const M = 4                       // margines mm
  const W = LABEL_W_MM - 2 * M      // 92 mm pola zadruku
  const partie = partieSurowca(input.meat)
  const surowce = surowceEtykiety(input.meat)
  const pozycje = (input.meat ?? []).filter(m => Number(m.kg) > 0)
  const roznica = Math.round((Number(input.kgWeighed) - Number(input.kgExpected)) * 10) / 10

  const body: string[] = [
    // ── Nagłówek: znak firmowy i co to za towar ────────────────────────────
    labelLogoZpl(mmToDots(M, dpi), mmToDots(3, dpi)),
    text(M + (LOGO_DOTS_W * 25.4) / LABEL_DPI + 5, 3.5, 5, 'MIĘSO PRZYPRAWIONE', dpi),
    line(M, 3 + (LOGO_DOTS_H * 25.4) / LABEL_DPI + 2, W, dpi),

    // ── Numer partii: największy napis na etykiecie ────────────────────────
    //
    // ^FO podaje GÓRNĄ krawędź napisu, więc każdy wiersz zajmuje pas o
    // wysokości fontu w dół. Podpis „PARTIA" (3,6 mm) startował na 12 i sięgał
    // 15,6, a numer zaczynał się na 14 — i na wydruku z hali cyfry wchodziły
    // w podpis (18.09.2026). Odstępy muszą być większe od fontu, nie „na oko".
    text(M, 11.5, 3.6, 'PARTIA', dpi),
    text(M, 16, 18, input.batchNo || '—', dpi),
  ]

  // Numer palety wyrobu — drugi identyfikator etykiety, obok numeru partii.
  // Dwie palety tej samej receptury i tej samej partii stoją obok siebie
  // nie do odróżnienia; ten numer jest jedynym, po którym hala je rozdziela.
  if (input.palletNo) {
    body.push(textRight(M, 11.5, W, 3.6, 'PALETA NR', dpi))
    body.push(textRight(M, 16, W, 13, String(input.palletNo), dpi))
  }

  let y = 36
  if (partie.length > 1) {
    body.push(text(M, y, 4.4, `łączona z partii: ${partie.join(' + ')}`, dpi))
    y += 6.5
  }
  body.push(line(M, y, W, dpi))
  y += 3

  // ── Receptura i rodzaj surowca ──────────────────────────────────────────
  body.push(text(M, y, 3.6, 'RECEPTURA', dpi))
  body.push(text(M, y + 4, 7, input.recipeName || '—', dpi))
  y += 12.5
  if (surowce.length) {
    body.push(text(M, y, 5.5, surowce.join(' + '), dpi))
    y += 7.5
  }
  body.push(line(M, y, W, dpi))
  y += 3

  // ── Waga: zważone WIELKIE, kontrola spodziewanego pod spodem ───────────
  //
  // Pierwsza wersja stawiała „zważono" i „spodziewane" w dwóch kolumnach
  // i przy czterocyfrowej wadze napisy wchodziły na siebie. Jedna kolumna:
  // liczba, po którą operator sięga wzrokiem, zostaje największa, a kontrola
  // idzie linijkę niżej — i tak czyta się ją dopiero wtedy, gdy coś nie gra.
  body.push(text(M, y, 3.6, 'ZWAŻONO', dpi))
  body.push(text(M, y + 4, 11, `${fmtLabelKg(input.kgWeighed)} kg`, dpi))
  y += 17.5
  // Kontrola w JEDNEJ linijce: spodziewane, różnica i wsad mięsa. Osobne
  // wiersze zjadały 7 mm, których brakowało potem składowi palet — a to skład
  // jest tym, czego nie da się odtworzyć z pamięci po dwóch dniach.
  body.push(text(M, y, 4.4,
    `spodziewane ${fmtLabelKg(input.kgExpected)} kg  ·  różnica ${roznica > 0 ? '+' : ''}${fmtLabelKg(roznica)} kg`, dpi))
  y += 7.5
  body.push(line(M, y, W, dpi))
  y += 3

  // ── Skład: palety zważone po rozbiorze, które operator wskazał do wsadu ──
  body.push(text(M, y, 3.6, 'SKŁAD PARTII — PALETY', dpi))
  body.push(textRight(M, y, W, 3.6, `wsad mięsa ${fmtLabelKg(input.kgMeat)} kg`, dpi))
  y += 5

  // Stopka (godziny, masownica) jest ZAKOTWICZONA u dołu etykiety, a skład
  // rośnie w jej stronę. Dzięki temu 150 mm taśmy jest wykorzystane, a nie
  // zapisane w dwóch trzecich, i etykieta wygląda tak samo przy jednej
  // palecie, co przy czterech.
  const yStopka = LABEL_H_MM - STOPKA_MM
  const mieszczaSie = Math.max(1, Math.floor((yStopka - y) / WIERSZ_MM))
  const wszystkie = pozycje.length <= mieszczaSie
  const widoczne = wszystkie ? pozycje : pozycje.slice(0, mieszczaSie - 1)
  const reszta = pozycje.length - widoczne.length

  for (const m of widoczne) {
    const gdzie = (m.palletNo || '').trim()
    body.push(text(M, y, 5, gdzie || `partia ${m.lotNo}`, dpi))
    body.push(textRight(M, y, W, 4.4, `partia ${m.lotNo} · ${fmtLabelKg(m.kg)} kg`, dpi))
    y += WIERSZ_MM
  }
  if (reszta > 0) {
    body.push(text(M, y, 4.4, `+ ${reszta} poz. — komplet w systemie`, dpi))
  }

  // ── Czasy i stanowisko — zawsze u dołu etykiety ────────────────────────
  const start = fmtLabelTime(input.startedAt)
  const koniec = fmtLabelTime(input.finishedAt)
  body.push(line(M, yStopka, W, dpi))
  body.push(text(M, yStopka + 3, 3.6, 'MASOWANIE', dpi))
  body.push(text(M, yStopka + 7.5, 6.5,
    `${start || '—'} → ${koniec || '—'}${input.mixMinutes ? `  ·  ${Math.round(input.mixMinutes)} min` : ''}`, dpi))
  // Trzy rzeczy w jednej linijce nie mieściły się w 92 mm („Masownica 3 ·
  // MAS/18/09/26/2 · 18.09.2026" wychodziło poza taśmę), a to ostatni wiersz
  // etykiety — więc datę dosuwamy do prawej, zamiast doklejać ją do reszty.
  body.push(text(M, yStopka + 16, 3.9,
    [input.machineId ? `Masownica ${input.machineId}` : '', input.orderNo || '']
      .filter(Boolean).join('  ·  '), dpi))
  body.push(textRight(M, yStopka + 16, W, 3.9,
    fmtLabelDate((input.finishedAt || '').slice(0, 10)), dpi))

  const n = Math.max(1, Math.round(copies))
  if (n > 1) body.push(`^PQ${n},0,0,Y`)

  return [
    '^XA',
    '^CI28',                             // UTF-8 — polskie znaki (MIĘSO, ŁĄCZONA)
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,   // szerokość TAŚMY — za duża ucina wiersze
    `^LL${mmToDots(LABEL_H_MM, dpi)}`,
    '^LH0,0',
    // `^LT0` kasuje przesunięcie GÓRY etykiety zapisane w pamięci drukarki.
    // Bez tego wydruk potrafi zjechać o pół etykiety i wyjść poza taśmę —
    // `^LH` tego ustawienia NIE zeruje (zgłoszenie z hali 18.09.2026).
    '^LT0',
    '^MNY',                              // etykiety wykrawane — szukaj przerwy
    '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}


/**
 * Etykieta TESTOWA — ramka pola zadruku i podziałka co 10 mm.
 *
 * Służy do ustawienia drukarki na hali: jeśli ramka nie trafia w krawędzie
 * etykiety albo podziałka nie zgadza się z linijką, problemem jest drukarka
 * (rozdzielczość, kalibracja mediów, przesunięcie góry), a nie treść wydruku.
 */
export function labelTestZpl({ dpi = labelDpi() }: { dpi?: number } = {}): string {
  const M = 4
  const W = LABEL_W_MM - 2 * M
  const H = LABEL_H_MM - 2 * M
  const gr = Math.max(1, mmToDots(0.8, dpi))
  const body: string[] = [
    `^FO${mmToDots(M, dpi)},${mmToDots(M, dpi)}^GB${mmToDots(W, dpi)},${mmToDots(H, dpi)},${gr}^FS`,
    text(M + 3, M + 4, 6, `TEST ${LABEL_W_MM} × ${LABEL_H_MM} mm`, dpi),
    text(M + 3, M + 12, 4.5, `${dpi} dpi`, dpi),
    text(M + 3, M + 19, 4, 'Ramka ma trafić w krawędzie etykiety.', dpi),
    text(M + 3, M + 25, 4, 'Podziałka co 10 mm — sprawdź linijką.', dpi),
  ]
  // Podziałka wzdłuż lewej krawędzi: co 10 mm kreska, co 50 mm dłuższa z opisem.
  for (let mm = 10; mm < H; mm += 10) {
    const dluga = mm % 50 === 0
    body.push(`^FO${mmToDots(M, dpi)},${mmToDots(M + mm, dpi)}^GB${mmToDots(dluga ? 12 : 6, dpi)},${gr},${gr}^FS`)
    if (dluga) body.push(text(M + 14, M + mm - 2, 4, `${mm} mm`, dpi))
  }
  return [
    '^XA', '^CI28',
    `^PW${mmToDots(LABEL_W_MM, dpi)}`,
    `^LL${mmToDots(LABEL_H_MM, dpi)}`,
    '^LH0,0', '^LT0', '^MNY', '^LS0',
    ...body,
    '^XZ',
  ].join('\n')
}
