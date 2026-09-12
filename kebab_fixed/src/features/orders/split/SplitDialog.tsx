/**
 * SplitDialog — okno podziału wysyłki na fakturę i WZ (Task 8).
 *
 * Biuro wpisuje, ile kilogramów z zamówienia idzie na fakturę (wystawianą
 * w Subiekcie, POZA tym systemem) — reszta jedzie na WZ. Całą matematykę
 * (który wyrób, ile sztuk, żeby trafić jak najbliżej celu) liczy WYŁĄCZNIE
 * backend (`order_split_service.podziel_pozycje`) — to okno niczego nie
 * przelicza samo, tylko pyta API i pokazuje dokładnie to, co przyszło.
 * Ręczna korekta pojedynczej linii NIE woła podglądu na nowo (backend nie
 * ma takiej trasy) — czeka jako `per_line` na „Zapisz podział".
 *
 * `trafiono === false` (cel nie da się trafić całymi sztukami) to NIE jest
 * szczegół zaokrąglenia — biuro ma to widzieć wprost, tuż obok odchyłki,
 * bez szukania (decyzja właściciela, Task 8).
 *
 * Backend odmawia w DWIE STRONY, żeby dwa dokumenty jednej wysyłki nigdy
 * się nie rozjechały:
 *   - po wystawieniu kompletu dokumentów zapis/kasowanie podziału jest
 *     zablokowane („najpierw anuluj dokumenty podziału") — to okno NIE
 *     zostawia biura w ślepym zaułku: przy takiej odmowie od razu proponuje
 *     anulowanie kompletu, tu na miejscu, z jasno napisaną konsekwencją —
 *     a konsekwencją jest to, co `anuluj_dokumenty_podzialu` NAPRAWDĘ robi:
 *     anuluje rodzinę WZ (WM + WZ dla klienta) i oddaje towar na stan,
 *     natomiast HDI i CMR ZOSTAJĄ żywe, ze swoimi numerami;
 *   - gdy zamówienie dostało nową pozycję bez zapisanego podziału,
 *     wystawienie kompletu odmawia („najpierw zapisz podział") — wyjściem
 *     jest przycisk „Zapisz podział" stojący w TYM SAMYM oknie, więc nie
 *     trzeba niczego dodatkowo proponować, wystarczy pokazać komunikat.
 *
 * REGUŁA „Wystaw komplet dokumentów": wolno go kliknąć TYLKO wtedy, gdy to,
 * co widać na ekranie, jest tym, co jest ZAPISANE W BAZIE. Powód jest w
 * `orderSplitApi.documents`: ta trasa wysyła samo `{hdi_fv}` — ani celu, ani
 * `per_line` — więc komplet ZAWSZE powstaje z podziału leżącego w bazie,
 * niezależnie od tego, co pokazuje okno. Wpisanie nowej liczby w „Na fakturę
 * [kg]" robi NOWY, niezapisany podgląd bez dotykania `overrides`, więc ani
 * obecność podglądu, ani brak ręcznej korekty nie są dowodem zgodności:
 * „zapisz 8000 → wpisz 9000 → wystaw" dawało komplet na 8000 przy ekranie
 * pokazującym 9000, a numery dokumentów są wypalone w chwili wystawienia.
 * `savedSplit` trzyma cel i sztuki na fakturę z tego, co ZAPISANE:
 * wczytane z `orderSplitApi.saved` przy otwarciu okna albo zapamiętane po
 * udanym zapisie. `matchesSaved` porównuje to z bieżącym ekranem i blokuje
 * przycisk przy jakiejkolwiek rozbieżności.
 *
 * DLACZEGO okno wczytuje podział przy otwarciu, a nie zaczyna od pustego:
 * bez tego jedyną drogą do odblokowania „Wystaw komplet" na zamówieniu
 * podzielonym WCZORAJ był ponowny zapis — a `zapisz_podzial` nadpisuje
 * `qty_invoice` na KAŻDEJ pozycji propozycją algorytmu, więc wczorajsza
 * ręczna korekta znikała bez pytania i to z niej powstawały papiery. Stąd
 * też zasada zapisu: `handleSave` wysyła w `per_line` DOKŁADNIE to, co widać
 * w tabeli (razem z liczbami wczytanymi z bazy, których nikt nie ruszał) —
 * ekran jest tym, co się zapisuje, tak samo jak jest tym, co się wystawia.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn, fmtKgTrim } from '@/lib/utils'
import { errStatus, orderSplitApi, palletScanApi, type SplitPreview, type SplitSaved,
         type SplitDocuments } from '@/lib/api'

export interface SplitDialogProps {
  orderId: string
  onClose: () => void
  /** Suma zamówienia w kg — do przycisku „50/50" i podpowiedzi w nagłówku.
   *  Task 7 nie ma trasy „pobierz obecny podział", więc to jedyna liczba,
   *  jaką ekran zna, zanim biuro cokolwiek wpisze. */
  kgCalosc?: number
  orderNo?: string
  clientName?: string
}

/** Odmowa „najpierw anuluj dokumenty podziału" — WSPÓLNY tekst dla
 *  `zapisz_podzial`/`wyczysc_podzial` (patrz `wz_service.KOMUNIKAT_ANULUJ_PODZIAL`).
 *  Status HTTP (400) jest ten sam dla każdej odmowy tej trasy, więc jedyny
 *  sposób odróżnienia dwóch odmów jest po treści komunikatu. */
const WYMAGA_ANULOWANIA = /anuluj dokument(y|ów) podzia/i

function odchylkaTekst(odchylka: number | null | undefined): string {
  // Niepełny zapisany podział nie ma odchyłki — `kg_fv` nie opisuje jeszcze
  // całego zamówienia, więc porównanie z celem mówiłoby nieprawdę.
  if (odchylka == null) return '—'
  const znak = odchylka > 0 ? '+' : ''
  return `${znak}${fmtKgTrim(odchylka)} kg`
}

/** Ręczna korekta pola „na FV" w TRZECH stanach, bo trzecim jest realna droga
 *  do rozjazdu papieru z ekranem:
 *
 *  - `'brak'`  — operator nic tu nie wpisał; obowiązuje liczba z API.
 *  - liczba    — całkowite sztuki. Puste pole to jawne ZERO (biuro wykasowało
 *                liczbę, żeby zdjąć pozycję z faktury), nie „zostaw jak było".
 *  - `'blad'`  — cokolwiek, co nie jest całkowitą liczbą sztuk. Dawne
 *                `parseInt` OBCINAŁO tu „8,5" do 8: komórka pokazywała 8,5,
 *                bramka widziała 8 (tyle, co w bazie) i komplet powstawał z 8.
 *                `<input type="number" step="1">` waliduje krok, ale wartości
 *                nie obcina, więc pilnować musi to miejsce.
 */
type Korekta = number | 'brak' | 'blad'

function parseOverride(raw: string | undefined): Korekta {
  if (raw === undefined) return 'brak'
  if (raw.trim() === '') return 0
  const n = Number(raw)
  return Number.isInteger(n) ? n : 'blad'
}

/** Migawka „ile sztuk na fakturę per pozycja" — do porównania z tym, co
 *  faktycznie leży w bazie (`SavedSplit`). Brakujący klucz w którejkolwiek
 *  stronie liczy się jako 0, nie jako „pomiń" — inaczej nowa/usunięta
 *  pozycja przechodziłaby porównanie po cichu. */
function perLineEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  }
  return true
}

interface SavedSplit { celKg: number; perLine: Record<string, number> }

/** Sztuki na fakturę tak, jak je TERAZ widać w tabeli: ręczna korekta, a gdy
 *  jej nie ma — liczba z ostatniej odpowiedzi API. `null`, gdy którakolwiek
 *  pozycja nie ma jeszcze żadnej liczby (niepełny zapisany podział): takiego
 *  ekranu nie ma z czym porównywać i nie wolno z niego wystawiać. */
function naEkranie(p: SplitPreview, o: Record<string, string>): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const l of p.lines) {
    const k = parseOverride(o[l.id])
    if (k === 'blad') return null            // w polu jest coś, co nie jest sztukami
    const v = k === 'brak' ? l.qty_invoice : k
    if (v === null) return null              // pozycja bez zapisanego podziału
    out[l.id] = v
  }
  return out
}

/** Podział zapisany W BAZIE, przepisany na to, z czym porównuje się ekran.
 *  `null` = w bazie nie ma PEŁNEGO podziału, więc nie ma czego potwierdzać:
 *  komplet dokumentów i tak jest odmawiany przy choćby jednej pozycji bez
 *  sztuk (patrz `_sprawdz_gotowosc_do_kompletu` w `split_documents_service`). */
function savedZ(z: SplitSaved): SavedSplit | null {
  if (!z.istnieje || !z.kompletny || z.cel_kg == null) return null
  return {
    celKg: z.cel_kg,
    perLine: Object.fromEntries(z.lines.map(l => [l.id, l.qty_invoice ?? 0])),
  }
}

export function SplitDialog({ orderId, onClose, kgCalosc, orderNo, clientName }: SplitDialogProps) {
  const [celKgInput, setCelKgInput] = useState('')
  // Czy auto już wyjechało. Papiery wolno wystawić wcześniej — biuro czasem
  // MUSI je mieć przed kursem — ale wtedy opisują PLAN, nie zawartość auta,
  // a rozbieżność wyjdzie dopiero przy skanie (biuro, 12.09.2026). Lepiej
  // powiedzieć to przed wypaleniem numerów niż po.
  const [zaladowane, setZaladowane] = useState<{ loaded: number; total: number } | null>(null)
  // Liczby na ekranie RAZEM z ich pochodzeniem — `zrodlo` jest ich
  // właściwością, nie osobnym faktem, więc trzymane osobno mogłoby się z nimi
  // rozjechać. Rozróżnienie jest nośne dla tego, co okno pisze o odchyłce:
  // `'podglad'` to czysta propozycja algorytmu, `'zapisany'` to stan z bazy,
  // w którym odchyłka bierze się zwykle z RĘCZNEJ korekty, a nie z tego, że
  // algorytm nie umiał trafić.
  const [tabela, setTabela] = useState<{ dane: SplitPreview; zrodlo: 'podglad' | 'zapisany' } | null>(null)

  useEffect(() => {
    let anulowane = false
    palletScanApi.loadingStatus(orderId)
      .then(st => {
        if (anulowane) return
        setZaladowane({
          loaded: Number(st?.totals?.loadedPallets ?? 0),
          total: Number(st?.totals?.totalPallets ?? 0),
        })
      })
      .catch(() => { if (!anulowane) setZaladowane(null) })
    return () => { anulowane = true }
  }, [orderId])
  const preview = tabela?.dane ?? null
  const zZapisu = tabela?.zrodlo === 'zapisany'
  const [loadingPreview, setLoadingPreview] = useState(false)
  // Ręczne korekty biura per pozycja — surowy tekst z pola, dopóki nie
  // trafią do zapisu. Klucz = id pozycji, wartość = to, co operator wpisał.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [hdiFv, setHdiFv] = useState(false)
  const [err, setErr] = useState('')
  const [needsCancel, setNeedsCancel] = useState(false)
  const [info, setInfo] = useState('')
  const [documents, setDocuments] = useState<SplitDocuments | null>(null)
  // Odczyt zapisanego podziału się nie udał. NIE wolno tego przemilczeć:
  // puste okno wygląda identycznie jak zamówienie bez podziału, więc biuro
  // wpisuje kilogramy, zapisuje — i nadpisuje korektę, której nie zobaczyło.
  const [bladOdczytu, setBladOdczytu] = useState('')
  // Cel i sztuki na fakturę per pozycja z tego, co ZAPISANE: wczytane z bazy
  // przy otwarciu okna albo zapamiętane po udanym zapisie. `null` = okno nie
  // wie o żadnym PEŁNYM podziale w bazie (nie ma go, jest niepełny albo
  // odczyt się nie udał), więc nie ma czym potwierdzić zgodności ekranu.
  const [savedSplit, setSavedSplit] = useState<SavedSplit | null>(null)
  // Biuro ma ręczną korektę linii, której jeszcze nie zapisało — wiersze
  // pokazują nowe liczby, ale sumy w stopce są wciąż SPRZED tej korekty
  // (przeliczyć je umie tylko backend, przy zapisie). Steruje WYŁĄCZNIE tym
  // ostrzeżeniem; bramki „Wystaw komplet" pilnuje `matchesSaved`, bo ta sama
  // rozbieżność powstaje też bez żadnej ręcznej korekty — samą zmianą celu.
  const hasPendingOverrides = Object.keys(overrides).length > 0
  // Czy to, co TERAZ na ekranie, jest dokładnie tym, co zapisane w bazie:
  // cel z górnego pola plus sztuki na fakturę z każdego wiersza (łącznie z
  // niezapisanymi ręcznymi korektami). Jedna bramka zamiast kilku, bo to
  // jedno pytanie — i pokrywa wszystkie drogi do rozjazdu: brak podglądu
  // (nie ma czego porównywać), nieznany podział w bazie, zmieniony cel,
  // poprawiona linia, niepełny podział zapisany na zamówieniu.
  const celKgTeraz = parseFloat(celKgInput.replace(',', '.'))
  const ekran = preview === null ? null : naEkranie(preview, overrides)
  const matchesSaved =
    ekran !== null && savedSplit !== null && !Number.isNaN(celKgTeraz) &&
    celKgTeraz === savedSplit.celKg &&
    perLineEqual(ekran, savedSplit.perLine)
  // Zapisany podział nie obejmuje wszystkich pozycji (któraś doszła po
  // zapisie). Rozpoznajemy to po samej odpowiedzi, a nie po zapamiętanym
  // „skąd to przyszło" — podgląd i zapis nigdy nie mają pustych sztuk, więc
  // ta flaga nie ma jak się zestarzeć.
  const niepelnyZapis = preview !== null && preview.lines.some(l => l.qty_invoice === null)
  // Licznik żądań podglądu: „8000" wpisane znak po znaku to kilka POST-ów,
  // które mogą wrócić NIE PO KOLEI. Bez tego spóźniona odpowiedź na stary
  // cel potrafiłaby nadpisać tabelę już PO tym, jak backend odpowiedział na
  // aktualny — operator zatwierdzałby podział, którego nigdy nie widział.
  const previewSeq = useRef(0)
  // Okno zamknięte w trakcie odczytu — nie dotykamy już jego stanu.
  const zywe = useRef(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Wczytaj podział ZAPISANY w bazie — patrz docblock. Wołane przy otwarciu
  // okna i z przycisku „Spróbuj ponownie" po nieudanym odczycie.
  async function wczytajZapisany() {
    const seq = previewSeq.current
    setBladOdczytu('')
    try {
      const z = await orderSplitApi.saved(orderId)
      if (!zywe.current) return
      // `savedSplit` opisuje BAZĘ, nie ekran, więc NIE podlega licznikowi
      // podglądu: nawet gdy operator zdążył coś wpisać (i tabela słusznie
      // zostaje jego), okno ma wiedzieć, co w bazie leży. `prev ?? …` chroni
      // przed jedyną odpowiedzią, która bywa nieaktualna — starszą niż zapis,
      // który w tej sesji już się udał.
      setSavedSplit(prev => prev ?? savedZ(z))
      // Tabela i pole celu to JUŻ ekran: tu licznik obowiązuje, żeby spóźniona
      // odpowiedź nie podmieniła operatorowi liczb pod palcami.
      if (seq !== previewSeq.current || !z.istnieje) return
      if (z.cel_kg != null) setCelKgInput(String(z.cel_kg))
      setTabela({ dane: z, zrodlo: 'zapisany' })
    } catch (e: any) {
      if (!zywe.current) return
      // 404 to jedyna odmowa, która NIE jest awarią: zamówienie bez pozycji
      // (albo nieistniejące). Każdy inny błąd musi być widoczny — cicha
      // pustka jest nie do odróżnienia od „brak podziału" i kusi do zapisu,
      // który nadpisze to, czego biuro nie zobaczyło.
      if (errStatus(e) === 404) return
      setBladOdczytu(e?.message || 'błąd połączenia')
    }
  }

  useEffect(() => {
    zywe.current = true
    void wczytajZapisany()
    return () => { zywe.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function runPreview(celKg: number) {
    const seq = ++previewSeq.current
    setLoadingPreview(true)
    setDocuments(null); setInfo('')
    try {
      const r = await orderSplitApi.preview(orderId, celKg)
      if (seq !== previewSeq.current) return  // spóźniona odpowiedź na stary cel — pomiń
      setTabela({ dane: r, zrodlo: 'podglad' })
      setOverrides({})
    } catch (e: any) {
      if (seq !== previewSeq.current) return
      setErr(e?.message || 'Nie udało się policzyć podziału')
      setTabela(null)
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false)
    }
  }

  function onCelKgChange(raw: string) {
    setCelKgInput(raw)
    setErr(''); setNeedsCancel(false)
    const n = parseFloat(raw.replace(',', '.'))
    if (raw.trim() === '' || Number.isNaN(n) || n < 0) {
      // Unieważnij żądanie w locie: bez podbicia licznika jego spóźniona
      // odpowiedź przechodzi kontrolę `seq === previewSeq.current` i wskrzesza
      // tabelę dla celu, którego w polu już nie ma. Po podbiciu nikt już nie
      // zgasi „Liczę…" (stary `finally` też odpada na tej kontroli), więc
      // gasimy je tutaj — inaczej zamiast podpowiedzi zostaje wieczny spinner.
      previewSeq.current++
      setTabela(null)
      setLoadingPreview(false)
      return
    }
    void runPreview(n)
  }

  function on5050() {
    if (kgCalosc == null) return
    // Właściciel zaakceptował, że nieparzystej całości nie da się rozłożyć
    // idealnie po połowie całymi sztukami — cel idzie NIEZAOKRĄGLONY,
    // a to, jak backend go rozłoży, pokazuje podgląd (Task 8, decyzja 3).
    const polowa = kgCalosc / 2
    setCelKgInput(String(polowa))
    setErr(''); setNeedsCancel(false)
    void runPreview(polowa)
  }

  async function handleSave() {
    // Nie nadpisujemy podziału, którego okno NIE ZDOŁAŁO ZOBACZYĆ. Przy
    // nieudanym odczycie `per_line` poszłoby ze świeżej propozycji algorytmu
    // i skasowało ręczną korektę z poprzedniej sesji — ten sam skutek co
    // cichy fallback do pustki, tylko z ostrzeżeniem obok. Wyjściem jest
    // „Spróbuj ponownie" w banerze błędu, nie zapis w ciemno.
    if (!preview || bladOdczytu) return
    const celKg = parseFloat(celKgInput.replace(',', '.'))
    if (Number.isNaN(celKg)) return
    // W `per_line` idzie DOKŁADNIE to, co widać w tabeli — także liczby
    // wczytane z bazy, których operator nie ruszał. Bez tego `zapisz_podzial`
    // przeliczyłby te pozycje algorytmem i ręczna korekta z poprzedniej sesji
    // zniknęłaby przy zapisie, którego biuro dokonało w zupełnie innym celu
    // (np. żeby uzupełnić nowo dodaną pozycję).
    const perLine: Record<string, number> = {}
    for (const line of preview.lines) {
      const k = parseOverride(overrides[line.id])
      if (k === 'blad') {
        setErr(`Pozycja ${line.recipe_name}: sztuki na fakturę muszą być liczbą całkowitą.`)
        return
      }
      const n = k === 'brak' ? line.qty_invoice : k
      if (n !== null) perLine[line.id] = n
    }
    setSaving(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      const r = await orderSplitApi.save(orderId, celKg, Object.keys(perLine).length ? perLine : undefined)
      // Odpowiedź zapisu OPISUJE BAZĘ, więc tabela pochodzi teraz z zapisu, a
      // nie z propozycji algorytmu — to samo rozróżnienie, co przy wczytaniu.
      setTabela({ dane: r, zrodlo: 'zapisany' })
      setOverrides({})
      // To, co ZAPISANE — czytane z odpowiedzi zapisu (czyli z tego, co
      // backend faktycznie zapisał), nie z lokalnego stanu, który właśnie
      // zresetowaliśmy. Cel też stamtąd; `celKg` zostaje jako zapasowy, gdyby
      // starsza wersja backendu nie odesłała `cel_kg`.
      setSavedSplit({
        celKg: r.cel_kg ?? celKg,
        perLine: Object.fromEntries(r.lines.map(l => [l.id, l.qty_invoice ?? 0])),
      })
      setInfo('Podział zapisany.')
    } catch (e: any) {
      const msg = e?.message || 'Nie udało się zapisać podziału'
      setErr(msg)
      setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally {
      setSaving(false)
    }
  }

  async function handleIssue() {
    // Ten przycisk ZDEJMUJE STAN MAGAZYNU i wypala numery dokumentów, a
    // powstają one z podziału ZAPISANEGO W BAZIE — nie z tego, co na ekranie.
    // Wolno go więc ruszyć tylko wtedy, gdy jedno jest drugim (`matchesSaved`).
    // Bramka siedzi też tutaj, nie tylko w atrybucie `disabled`, żeby żadna
    // inna droga do handlera jej nie ominęła.
    const zapisane = savedSplit
    if (issuing || !matchesSaved || zapisane === null) return
    const listaDokumentow = hdiFv
      ? 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR, HDI na całość i HDI do faktury'
      : 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR i HDI na całość'
    const przedZaladunkiem = !!zaladowane && zaladowane.loaded === 0
    const ok = window.confirm(
      `Wystawić komplet dokumentów?\n\nPowstaną: ${listaDokumentow}.\n\n` +
      (przedZaladunkiem
        ? 'UWAGA: auto nie jest jeszcze załadowane. Papiery opiszą PLAN, nie zawartość '
          + 'auta — jeśli czegoś zabraknie, skan pokaże rozjazd i dokumenty trzeba '
          + 'będzie poprawić.\n\n'
        : '') +
      'WZ wewnętrzny ZDEJMIE towar ze stanu magazynu wyrobów gotowych — cofniesz to ' +
      'TYLKO anulując cały komplet.')
    if (!ok) return
    setIssuing(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      // Ostatnie spojrzenie do bazy PRZED wypaleniem numerów. `matchesSaved`
      // pilnuje zgodności ekranu z tym, co okno WCZYTAŁO — a druga osoba
      // mogła w międzyczasie zapisać inny podział i to z NIEGO powstałby
      // komplet. Jedno żądanie, bez zmiany kontraktu zapisu.
      let wBazie: SplitSaved
      try {
        wBazie = await orderSplitApi.saved(orderId)
      } catch {
        setErr('Nie udało się potwierdzić, że podział w bazie nadal zgadza się z ekranem — ' +
               'dokumentów NIE wystawiono. Spróbuj jeszcze raz.')
        return
      }
      const teraz = savedZ(wBazie)
      if (teraz === null || teraz.celKg !== zapisane.celKg ||
          !perLineEqual(teraz.perLine, zapisane.perLine)) {
        // Pokazujemy od razu to, co NAPRAWDĘ leży w bazie — odmowa bez
        // pokazania nowego stanu zostawiałaby biuro przy tabeli, o której
        // właśnie powiedzieliśmy, że jest nieaktualna.
        setOverrides({})
        setSavedSplit(teraz)
        setCelKgInput(wBazie.cel_kg != null ? String(wBazie.cel_kg) : '')
        setTabela(wBazie.istnieje ? { dane: wBazie, zrodlo: 'zapisany' } : null)
        setErr('Ktoś zmienił podział tego zamówienia, odkąd otworzyłeś to okno. Na ekranie ' +
               'jest teraz to, co naprawdę leży w bazie — sprawdź go i wystaw jeszcze raz.')
        return
      }
      const r = await orderSplitApi.documents(orderId, hdiFv)
      setDocuments(r)
    } catch (e: any) {
      const msg = e?.message || 'Nie udało się wystawić dokumentów'
      setErr(msg)
      setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally {
      setIssuing(false)
    }
  }

  async function handleCancelDocuments() {
    // Treść MUSI opisywać to, co robi `anuluj_dokumenty_podzialu`: anuluje
    // WYŁĄCZNIE rodzinę WZ (po `split_scope`), bo tylko o tych liniach wie,
    // jak wyglądają i jak zwrócić z nich towar. Oba CMR-y i oba HDI zostają
    // żywe, z numerami — obietnica „numery WM / WZ / HDI / CMR przepadną"
    // była nieprawdą o dokumentach handlowych, a to w tym systemie osobna
    // klasa błędu: ekran mówi jedno, baza robi drugie
    // (review końcowy, I4, 2026-09-11).
    const ok = window.confirm(
      'Anulować dokumenty podziału?\n\n' +
      'Anulowane zostaną WZ wewnętrzny (WM) i WZ dla klienta — towar wróci na stan ' +
      'wyrobów gotowych.\n' +
      'HDI i CMR zostają: te same numery, treść odświeży się przy ponownym wystawieniu ' +
      'kompletu.')
    if (!ok) return
    setCancelling(true)
    try {
      const r = await orderSplitApi.cancelDocuments(orderId)
      setNeedsCancel(false); setErr(''); setDocuments(null)
      const zwrocono = r?.returned_qty ?? 0
      setInfo(`Dokumenty podziału anulowane, towar wrócił na stan (${zwrocono} szt). ` +
              'Popraw podział i zapisz ponownie.')
    } catch (e: any) {
      setErr(e?.message || 'Nie udało się anulować dokumentów')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-surface-4 bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-surface-3 px-5 py-3">
          <div>
            <h2 className="text-[15px] font-bold text-ink">Podział wysyłki — faktura i WZ</h2>
            <p className="text-[11.5px] text-ink-4">
              {orderNo ? `Zamówienie ${orderNo}` : `Zamówienie ${orderId}`}
              {clientName ? ` · ${clientName}` : ''}
              {kgCalosc != null ? ` · razem ${fmtKgTrim(kgCalosc)} kg` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-ink-4 hover:text-ink" aria-label="Zamknij">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Na fakturę [kg]
              </span>
              <input
                type="number" min="0" step="0.5" inputMode="decimal"
                value={celKgInput}
                onChange={e => onCelKgChange(e.target.value)}
                className="h-9 w-40 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums"
              />
            </label>
            <button type="button" onClick={on5050} disabled={kgCalosc == null}
              title={kgCalosc == null ? 'Nieznana suma zamówienia' : 'Połowa całości na fakturę'}
              className="h-9 rounded border border-surface-4 px-3 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-40">
              50/50
            </button>
            {loadingPreview && <span className="text-[11.5px] text-ink-4">Liczę…</span>}
          </div>

          {bladOdczytu && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              <div>Nie udało się sprawdzić, czy to zamówienie ma już zapisany podział ({bladOdczytu}).</div>
              <div className="text-[11.5px] text-red-700/80">
                Puste okno wygląda teraz tak samo jak zamówienie bez podziału, ale nim NIE JEST.
                Jeśli zapiszesz podział na ślepo, nadpiszesz to, czego nie widać — łącznie
                z ręczną korektą pozycji z poprzedniej sesji.
              </div>
              <button type="button" onClick={() => void wczytajZapisany()}
                className="rounded bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700">
                Spróbuj ponownie
              </button>
            </div>
          )}

          {preview && (
            <>
              {niepelnyZapis && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  Zapisany podział nie obejmuje wszystkich pozycji zamówienia — któraś
                  doszła już po jego zapisaniu. Uzupełnij ją i zapisz podział; sumy poniżej
                  liczą na razie tylko pozycje z zapisanym podziałem.
                </div>
              )}

              {preview.trafiono === false && (zZapisu ? (
                // Liczby z BAZY: odchyłka bierze się wtedy zwykle z ręcznej
                // korekty, a nie z tego, że algorytm nie umiał trafić w cel —
                // pisanie tu „nie da się trafić całymi sztukami" byłoby
                // nieprawdą o przyczynie, choć sama odchyłka jest prawdziwa.
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  Zapisany podział jest o {odchylkaTekst(preview.odchylka)} od celu — na fakturę
                  idzie <b>{fmtKgTrim(preview.kg_fv)}</b> kg. Zwykle znaczy to, że pozycja
                  została poprawiona ręcznie.
                </div>
              ) : (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  Nie da się trafić dokładnie w podany cel całymi sztukami — najbliższy możliwy
                  podział to <b>{fmtKgTrim(preview.kg_fv)}</b> kg na fakturę
                  (odchyłka <b>{odchylkaTekst(preview.odchylka)}</b>).
                </div>
              ))}

              <div className="overflow-x-auto rounded border border-surface-4">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wider text-ink-4">
                    <tr>
                      <th className="px-3 py-2 text-left">Receptura</th>
                      <th className="px-3 py-2 text-right">kg/szt</th>
                      <th className="px-3 py-2 text-right">Zamówiono</th>
                      <th className="px-3 py-2 text-right">Na FV</th>
                      <th className="px-3 py-2 text-right">Na WZ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-3">
                    {preview.lines.map(line => {
                      const raw = overrides[line.id]
                      const k = parseOverride(raw)
                      // „Na WZ" bez liczby, gdy w polu jest coś, co nie jest
                      // całymi sztukami — nie zgadujemy, co operator miał na myśli.
                      const naWz = k === 'blad' ? null
                        : k === 'brak' ? line.qty_wz
                        : line.qty - k
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink">{line.recipe_name}</div>
                            {line.product_type_name && (
                              <div className="text-[11px] text-ink-4">{line.product_type_name}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtKgTrim(line.kg_per_unit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number" min="0" max={line.qty} step="1"
                              value={raw ?? (line.qty_invoice == null ? '' : String(line.qty_invoice))}
                              onChange={e => setOverrides(o => ({ ...o, [line.id]: e.target.value }))}
                              aria-label={`na FV — ${line.recipe_name}`}
                              className="h-8 w-20 rounded border border-surface-4 bg-surface px-2 text-right tabular-nums"
                            />
                          </td>
                          <td className={cn('px-3 py-2 text-right tabular-nums',
                            naWz != null && naWz < 0 && 'font-semibold text-red-600')}>
                            {naWz ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-1 rounded border px-3 py-2 text-[12.5px]',
                hasPendingOverrides ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-surface-4 bg-surface-2 text-ink-3')}>
                {hasPendingOverrides && (
                  // Wiersze pokazują NOWE liczby (po ręcznej korekcie), ale te
                  // sumy wciąż liczone są z poprzedniej odpowiedzi API — nie
                  // wolno dać biuru odczytać ich jako aktualnych (przeliczenie
                  // sum to „split", a tego ekran sam nie robi — patrz „Zapisz").
                  <div className="basis-full text-[11.5px] font-semibold text-amber-800">
                    Sumy poniżej są sprzed tej korekty — zapisz podział, żeby je przeliczyć.
                  </div>
                )}
                <div>Razem <b className="text-ink">{fmtKgTrim(preview.kg_calosc)}</b> kg</div>
                <div>Na fakturę <b className="text-ink">{fmtKgTrim(preview.kg_fv)}</b> kg</div>
                <div>Na WZ <b className="text-ink">{fmtKgTrim(preview.kg_wz)}</b> kg</div>
                <div className={cn(preview.trafiono === false && 'font-semibold text-amber-700')}>
                  Odchyłka <b>{odchylkaTekst(preview.odchylka)}</b>
                </div>
              </div>
            </>
          )}

          {!preview && !loadingPreview && !bladOdczytu && (
            // Przy nieudanym odczycie tej podpowiedzi NIE ma: mówiłaby „wpisz
            // kilogramy" obok banera, który mówi „nie wpisuj niczego na ślepo".
            <div className="rounded border border-dashed border-surface-4 px-3 py-6 text-center text-[12.5px] text-ink-4">
              Wpisz kilogramy na fakturę (albo kliknij „50/50"), żeby zobaczyć podział pozycji.
            </div>
          )}

          {err && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              <div>{err}</div>
              {needsCancel && (
                <>
                  <div className="text-[11.5px] text-red-700/80">
                    Wyjście jest jedno: anulować dokumenty podziału. Anulowane zostaną WZ
                    wewnętrzny (WM) i WZ dla klienta, a towar wróci na stan. HDI i CMR zostają
                    — te same numery, treść odświeży się przy ponownym wystawieniu kompletu.
                  </div>
                  <button type="button" onClick={handleCancelDocuments} disabled={cancelling}
                    className="rounded bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {cancelling ? 'Anuluję…' : 'Anuluj dokumenty podziału'}
                  </button>
                </>
              )}
            </div>
          )}

          {info && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
              {info}
            </div>
          )}

          {documents && (
            <div className="space-y-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-emerald-800">Komplet dokumentów wystawiony</div>
                {/* Tu WIADOMO na pewno, że dokumenty istnieją — akcja wycofania
                    stoi obok nich ZAWSZE, nie tylko po odmowie (`needsCancel`),
                    bo bez tego jedyna droga do niej bywała nieosiągalna
                    (review, runda 3, Important 2). */}
                <button type="button" onClick={handleCancelDocuments} disabled={cancelling}
                  className="shrink-0 rounded border border-red-300 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {cancelling ? 'Anuluję…' : 'Anuluj dokumenty podziału'}
                </button>
              </div>
              {documents.pokrycie && !documents.pokrycie.pelne && (
                // Papier opisuje WIĘCEJ, niż wyjechało: WM powstaje
                // z faktycznego pokrycia w magazynie, a WZ dla klienta i CMR
                // do faktury liczą się z ZAMÓWIENIA. To ostatnia chwila, gdy
                // ktokolwiek może to zobaczyć przed odjazdem auta — dalej
                // zostaje już tylko korekta faktury (review końcowy, I3).
                // Ostrzeżenie, nie blokada: zakład wysyła to, co wyprodukował.
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  <div className="font-semibold">
                    Papiery opisują o {fmtKgTrim(documents.pokrycie.kg_braku)} kg więcej,
                    niż wyjechało.
                  </div>
                  <div className="mt-1 text-[11.5px]">
                    WZ wewnętrzny (WM) obejmuje <b>{fmtKgTrim(documents.pokrycie.kg_wydane)}</b> kg
                    — tyle znalazło pokrycie w magazynie. WZ dla klienta i CMR do faktury liczą
                    się z zamówienia (<b>{fmtKgTrim(documents.pokrycie.kg_zamowienia)}</b> kg),
                    więc opisują też towar, który nie wyjechał. Sprawdź dostawę, zanim faktura
                    pójdzie do Subiekta.
                  </div>
                </div>
              )}
              <DocRow label="WZ wewnętrzny (WM)" doc={documents.wm} typ="wz" />
              <DocRow label="WZ dla klienta" doc={documents.wz} typ="wz" />
              {(documents.cmr ?? []).map((c, i) => (
                <DocRow key={c?.id ?? i} label={i === 0 ? 'CMR — całość' : 'CMR — do faktury'} doc={c} typ="cmr" />
              ))}
              <DocRow label="HDI — całość" doc={documents.hdi_calosc} typ="hdi" />
              {documents.hdi_fv && <DocRow label="HDI — do faktury" doc={documents.hdi_fv} typ="hdi" />}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-3 px-5 py-3">
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={hdiFv} onChange={e => setHdiFv(e.target.checked)} />
            także HDI do faktury
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
              Zamknij
            </button>
            <button type="button" onClick={handleSave} disabled={!preview || saving || !!bladOdczytu}
              className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
              {saving ? 'Zapisywanie…' : 'Zapisz podział'}
            </button>
            {/* Papiery wolno wystawić przed kursem — biuro czasem MUSI je mieć
                wcześniej — ale wtedy opisują PLAN, a nie zawartość auta. */}
            {zaladowane && zaladowane.loaded === 0 && (
              <div data-testid="ostrzezenie-przed-zaladunkiem"
                className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                <b>Auto nie jest jeszcze załadowane.</b> Dokumenty opiszą plan, nie zawartość
                auta. Jeśli czegoś zabraknie, skan magazyniera pokaże <b>rozjazd</b> i papiery
                trzeba będzie poprawić.
              </div>
            )}
            {/* ZDEJMUJE STAN: aktywny tylko, gdy ekran = baza (`matchesSaved`). */}
            <button type="button" onClick={handleIssue}
              disabled={issuing || !matchesSaved}
              className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
              {issuing ? 'Wystawiam…' : 'Wystaw komplet dokumentów'}
            </button>
          </div>
          {!issuing && !matchesSaved && (
            // Widoczny powód blokady zamiast wyszarzonego przycisku bez
            // wyjaśnienia — biuro ma wiedzieć, co zrobić, nie zgadywać.
            // Wyjście jest w TYM oknie: „Spróbuj ponownie" w banerze błędu
            // albo przycisk „Zapisz podział" obok.
            <div className="basis-full text-right text-[11px] text-ink-4">
              {bladOdczytu
                ? 'Najpierw odczytaj podział z bazy („Spróbuj ponownie" wyżej) — dopóki nie wiadomo, co w niej leży, nie wolno ani zapisać, ani wystawić.'
                : !preview
                ? 'Wpisz kilogramy na fakturę (albo kliknij „50/50"), żeby zobaczyć podział przed wystawieniem.'
                : 'Zapisz podział, żeby wystawić komplet dokumentów — powstają one z tego, co zapisane w bazie, nie z tego, co widać na ekranie.'}
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

function DocRow({ label, doc, typ }: {
  label: string; doc?: { id: string; number: string } | null; typ: 'wz' | 'hdi' | 'cmr'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}: <b className="font-mono">{doc?.number ?? '—'}</b></span>
      {doc?.id && (
        <a href={`/office/${typ}/${doc.id}/druk`} target="_blank" rel="noreferrer"
          className="text-[11.5px] font-medium text-primary hover:underline">
          Drukuj
        </a>
      )}
    </div>
  )
}
