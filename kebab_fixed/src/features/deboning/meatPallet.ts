/**
 * Ważenie zbiorcze mięsa — kafelki celu i arytmetyka słupka.
 *
 * Po rozbiorze mięso jedzie do masowni w tym, co akurat stoi pod ręką: pięciu
 * ludzi odda po 100 kg, ktoś 40 kg, i na palecie ląduje zbieranina, o której
 * operator masowania nic nie wie. Ten ekran pozwala zbudować RÓWNE palety
 * i wózki, a etykieta mówi, co na nich leży.
 *
 * Kafelek niesie cel ŁĄCZNY i opcjonalnie cel SŁUPKA. Gdzie cel słupka jest,
 * ekran prowadzi stos po stosie (paleta: cztery równe słupki); gdzie go nie ma
 * (600 kg), operator dokłada swobodnie aż do celu łącznego.
 *
 * To NIE jest ruch magazynowy — mięso jest na stanie od chwili rozbioru.
 * Czysta logika bez DOM, testowana jednostkowo.
 */
import { E2_TARE_KG } from '@/features/deboning/utils/weighing'

/** Dopuszczalne odchylenie od celu — słupka i łącznego. */
export const TOLERANCE_KG = 0.5

export interface PalletTarget {
  key: string
  label: string
  totalKg: number
  /** Cel jednego słupka albo null, gdy kafelek nie dzieli palety. */
  stackKg: number | null
  /** Ile słupków przewiduje kafelek (null = dowolnie). */
  stacks: number | null
  hint: string
}

export const PALLET_TARGETS: PalletTarget[] = [
  { key: 't100', label: '100 kg', totalKg: 100, stackKg: 100, stacks: 1, hint: 'wózek' },
  { key: 't200', label: '200 kg', totalKg: 200, stackKg: 200, stacks: 1, hint: 'wózek' },
  { key: 't400', label: '400 kg', totalKg: 400, stackKg: 100, stacks: 4, hint: 'paleta — 4 słupki po 100 kg' },
  { key: 't600', label: '600 kg', totalKg: 600, stackKg: null, stacks: null, hint: 'paleta — bez podziału' },
  { key: 't800', label: '800 kg', totalKg: 800, stackKg: 200, stacks: 4, hint: 'paleta — 4 słupki po 200 kg' },
]

export function withinTolerance(kg: number, target: number): boolean {
  return Math.abs(kg - target) <= TOLERANCE_KG + 1e-9
}

/**
 * Netto słupka. Nośnik odejmujemy TYLKO przy pierwszym — potem paleta stoi na
 * wadze wytarowana przez operatora, a on dokłada kolejny stos. Pojemniki
 * odejmujemy przy każdym słupku, bo każdy ma swoje.
 */
export function stackNetKg(
  gross: number, carrierKg: number, containers: number, isFirstStack: boolean,
): number {
  const tare = (isFirstStack ? carrierKg : 0) + containers * E2_TARE_KG
  return Math.max(0, Math.round((gross - tare) * 10) / 10)
}

/** Cel szybkiej etykiety z ekranu głównego — typowy słupek z jednej ćwiartki. */
export const QUICK_TARGET_KG = 100

export interface LotPick { lotNo: string; kg: number }
export interface FefoResult {
  picks: LotPick[]
  /** Kilogramy, których nie ma z czego pokryć — ekran prosi o wskazanie partii. */
  unassignedKg: number
}

/**
 * Podział wagi palety na partie: bierz z najstarszej tyle, ile w niej zostało,
 * resztę z kolejnej. Lista wejściowa jest już w kolejności FEFO (API sortuje po
 * terminie), więc idziemy po niej wprost. Odpowiada to temu, jak pracuje hala:
 * pięciu ludzi odda po 100 kg z tej samej partii, a kto przywiózł nowszą,
 * ten wchodzi na końcu.
 *
 * Braku pokrycia NIE dopisujemy po cichu do ostatniego lotu — wraca jako
 * `unassignedKg`. Zgadywanie w tym miejscu kosztowałoby dokładnie tę
 * identyfikowalność, po którą powstaje etykieta.
 */
export function proposeLots(
  available: { lotNo: string; kgFree: number }[], kg: number,
): FefoResult {
  const r1 = (n: number) => Math.round(n * 10) / 10
  let zostalo = r1(kg)
  const picks: LotPick[] = []
  for (const lot of available) {
    if (zostalo <= 0.05) break
    const wziete = r1(Math.min(zostalo, lot.kgFree))
    if (wziete <= 0.05) continue
    picks.push({ lotNo: lot.lotNo, kg: wziete })
    zostalo = r1(zostalo - wziete)
  }
  return { picks, unassignedKg: Math.max(0, zostalo) }
}

export interface ActiveLotResult extends FefoResult {
  /** Ile kilogramów musi wejść z INNYCH partii niż ta z ekranu. 0 = paleta
   *  w całości z jednej partii. Ekran pyta o zgodę, zamiast dobierać po cichu. */
  fromOtherLotsKg: number
}

/**
 * Skład palety liczony OD PARTII, KTÓRĄ ROZBIERA HALA.
 *
 * `proposeLots` idzie po puli od najstarszego terminu i nie wie, co stoi na
 * wadze. 24.08.2026 wyjechała przez to paleta z etykietą „485", choć ważono
 * 503: 485 była najstarszym żywym lotem, więc ekran podpowiadał ją przy każdej
 * palecie, a operator musiał ją nadpisywać za każdym razem.
 *
 * Tutaj partia z ekranu idzie PIERWSZA i do wyczerpania, a dopiero brakującą
 * resztę dobieramy FEFO z pozostałych — i zwracamy ją osobno w
 * `fromOtherLotsKg`, żeby ekran mógł o nią zapytać zamiast milczeć.
 *
 * Bez wskazanej partii (albo gdy nie ma jej w puli) zachowujemy się dokładnie
 * jak dotąd — czyste FEFO. Brak wiedzy nie może zablokować ważenia.
 */
export function proposeLotsFromActive(
  activeLotNo: string | null | undefined,
  available: { lotNo: string; kgFree: number }[],
  kg: number,
): ActiveLotResult {
  const nr = (activeLotNo ?? '').trim()
  const active = nr ? available.find(l => l.lotNo === nr) : undefined
  if (!active) {
    const r = proposeLots(available, kg)
    return { ...r, fromOtherLotsKg: r.picks.reduce((s, p) => s + p.kg, 0) }
  }
  // Partia z ekranu przodem, reszta puli w niezmienionej kolejności FEFO.
  const r = proposeLots([active, ...available.filter(l => l.lotNo !== nr)], kg)
  const fromOther = r.picks
    .filter(p => p.lotNo !== nr)
    .reduce((s, p) => s + p.kg, 0)
  return { ...r, fromOtherLotsKg: Math.round(fromOther * 10) / 10 }
}

export interface LotProgress {
  lotNo: string
  /** Ile mięsa zważono z tej partii na rozbiorze (kg_initial lotu). */
  weighedKg: number
  /** Ile z tego zeszło już na palety. */
  onPalletsKg: number
  /** Ile jeszcze wolno wydać. */
  leftKg: number
}

/**
 * Postęp ważenia partii do licznika nad wagą: „zważone 493 · na paletach 300 ·
 * zostało 193". Bez tego strażnik jest niewidoczny — operator dowiadywał się
 * o limicie dopiero przy odmowie zapisu, a najczęściej wcale, bo dobieranie
 * FEFO po cichu przerzucało nadmiar na inną partię.
 *
 * `kgBulkFree` liczy backend (wydajność partii minus to, co na paletach).
 * Gdy go nie ma — starsza wersja backendu — nie udajemy wiedzy i pokazujemy
 * całą wydajność jako dostępną.
 */
export function lotProgress(
  m: { lotNo: string; kgInitial?: number | null; kgBulkFree?: number | null },
): LotProgress {
  const r1 = (n: number) => Math.round(n * 10) / 10
  const weighed = r1(Number(m.kgInitial ?? 0))
  const left = m.kgBulkFree == null ? weighed : r1(Number(m.kgBulkFree))
  return {
    lotNo: m.lotNo,
    weighedKg: weighed,
    onPalletsKg: r1(Math.max(0, weighed - left)),
    leftKg: left,
  }
}

/**
 * Czy kafelek celu da się w ogóle zrobić z tego, co zostało w partii.
 * Nieznany limit (null) niczego nie blokuje — brak wiedzy to nie zero.
 */
export function targetFitsLot(targetKg: number, leftKg: number | null | undefined): boolean {
  if (leftKg == null) return true
  return targetKg <= leftKg + BULK_TOL_KG + 1e-9
}

/** Co ekran robi z kafelkiem celu wobec reszty aktywnej partii. */
export type TargetGate =
  /** Mieści się w partii — zwykły wybór. */
  | 'ok'
  /** Ponad resztę partii, ale z tej reszty wyjdzie jeszcze cała mniejsza
   *  paleta — najpierw zużyj partię, potem łącz. */
  | 'blocked'
  /** Końcówka partii: nie wyjdzie z niej żadna cała paleta, więc wolno dobić
   *  mięsem z kolejnej — ze składem wypisanym na etykiecie. */
  | 'combine'

/**
 * Kiedy wolno połączyć partie na jednej palecie.
 *
 * Zasada z hali: partię wyczerpuje się CAŁYMI paletami, a dopiero końcówkę
 * dokłada do następnej. Z 490 kg wychodzi 200 + 200 i zostaje 90 — i dopiero
 * te 90 kg wolno dobić z kolejnej partii.
 *
 * Twarde blokowanie wszystkiego ponad resztę byłoby błędem w drugą stronę:
 * końcówki nie dałoby się wtedy zużyć wcale.
 */
export function targetGate(
  targetKg: number,
  leftKg: number | null | undefined,
  targets: readonly number[],
): TargetGate {
  if (leftKg == null) return 'ok'
  if (targetFitsLot(targetKg, leftKg)) return 'ok'
  const wyjdzieMniejsza = targets.some(t => targetFitsLot(t, leftKg))
  return wyjdzieMniejsza ? 'blocked' : 'combine'
}

export interface OverageHint {
  /** O ile kilogramów netto przekracza cel. */
  overKg:           number
  /** Ile pojemników tłumaczyłoby tę nadwyżkę — null, gdy nie da się tak
   *  wyjaśnić albo operator już je wpisał. */
  containersLikely: number | null
}

/**
 * Dlaczego wyszło za dużo.
 *
 * 24.08.2026 paleta zapisała się jako 218 kg przy ZEROWEJ liczbie pojemników
 * i celu 200 kg: tara E2 (9 × 2,0 kg) nie została odjęta, więc 18 kg plastiku
 * poszło na dokument jako mięso. Ekran przepuścił to bez słowa — zmienił
 * tylko kolor liczby.
 *
 * Gdy nadwyżka dzieli się równo przez tarę pojemnika, a operator wpisał ich
 * zero, potrafimy powiedzieć wprost ILE ich brakuje — to znacznie lepsza
 * podpowiedź niż „poza normą".
 *
 * Niedowaga nie jest problemem: operator dokłada mięso i patrzy na wagę.
 */
export function diagnoseOverage(
  netKg: number, targetKg: number, containers: number,
): OverageHint | null {
  if (!(targetKg > 0)) return null
  const over = Math.round((netKg - targetKg) * 10) / 10
  if (over <= TOLERANCE_KG) return null

  let containersLikely: number | null = null
  if ((containers ?? 0) <= 0) {
    const ile = over / E2_TARE_KG
    const zaokr = Math.round(ile)
    if (zaokr >= 1 && Math.abs(ile - zaokr) < 0.02) containersLikely = zaokr
  }
  return { overKg: over, containersLikely }
}

export interface LotOverBudget { lotNo: string; kg: number; freeKg: number }

/** Luz na zaokrąglenia wagi — ten sam, którym posługuje się backend. */
export const BULK_TOL_KG = 0.05

/**
 * Partie, z których paleta bierze więcej mięsa, niż w nich zostało.
 *
 * Ważenie zbiorcze nie rusza stanu magazynowego, więc nic samo z siebie nie
 * pilnowało, ile z partii już zeszło na palety — z partii o wydajności
 * 2 353 kg dało się zważyć 10 ton. Limit pilnuje backend (`validate_bulk_lots`),
 * a ten sam rachunek tutaj pokazuje go operatorowi ZANIM dojdzie do zapisu.
 *
 * `freeByLot` – ile z partii zostało; brak klucza = limit nieznany (mięso
 * z zewnątrz, stare dane) i wtedy nie zgłaszamy nic: brak wiedzy to nie zero.
 * Kilogramy sumujemy PO NUMERZE partii — inaczej dwa wiersze po połowie
 * przeszłyby pod limitem.
 */
export function overBudgetLots(
  lots: readonly LotPick[],
  freeByLot: ReadonlyMap<string, number>,
  tol = BULK_TOL_KG,
): LotOverBudget[] {
  const razem = new Map<string, number>()
  for (const l of lots) razem.set(l.lotNo, (razem.get(l.lotNo) ?? 0) + l.kg)

  const out: LotOverBudget[] = []
  for (const [lotNo, kg] of razem) {
    const freeKg = freeByLot.get(lotNo)
    if (freeKg == null) continue
    if (kg > freeKg + tol) out.push({ lotNo, kg: Math.round(kg * 10) / 10, freeKg })
  }
  return out
}

export interface QuickPalletInput {
  /** Zmierzone netto słupka — to ONO trafia na etykietę, nie okrągły cel. */
  netKg: number
  containers: number
  /** Numer partii zaznaczonej na ekranie; lot mięsa ma ten sam numer. */
  batchNo: string
  carrierLabel: string
  carrierKg: number
  operator: string
  productionDate: string
  expiryDate: string
}

export interface PalletDraft {
  targetKg: number
  stackKg: number | null
  kgNet: number
  containers: number
  carrierLabel: string
  carrierKg: number
  operator: string
  productionDate: string
  expiryDate: string
  lots: LotPick[]
}

/**
 * Szybka etykieta z ekranu głównego: pracownik oddaje ~97-100 kg z ćwiartki,
 * operator dokłada brakujące kilogramy i jednym dotknięciem drukuje etykietę.
 *
 * Cały słupek idzie na partię zaznaczoną na ekranie — przy 2-3 kg dokładki
 * rozbijanie tego na drugą partię kosztowałoby więcej dotknięć niż jest warte.
 * Waga na etykiecie to ZMIERZONE netto, nie cel: 100 kg jest podpowiedzią,
 * a wydruk ma mówić prawdę o tym, co stoi na wózku.
 *
 * Zwraca `null`, gdy nie ma czego zapisać — brak partii albo zerowa waga.
 */
export function quickPalletDraft(i: QuickPalletInput): PalletDraft | null {
  const kg = Math.round((i.netKg ?? 0) * 10) / 10
  const nr = (i.batchNo ?? '').trim()
  if (!nr || kg <= 0) return null
  return {
    targetKg: QUICK_TARGET_KG,
    stackKg: QUICK_TARGET_KG,
    kgNet: kg,
    containers: Math.max(0, Math.round(i.containers ?? 0)),
    carrierLabel: i.carrierLabel ?? '',
    carrierKg: i.carrierKg ?? 0,
    operator: i.operator ?? '',
    productionDate: i.productionDate,
    expiryDate: i.expiryDate ?? '',
    lots: [{ lotNo: nr, kg }],
  }
}
