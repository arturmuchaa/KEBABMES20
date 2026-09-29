/**
 * KARTONY, poziom 3 — pakowanie sztuk.
 *
 * Magazynier stoi 2–3 kroki od ekranu, przy wózku i kartonie. Ekran NIE jest
 * kanałem potwierdzania każdej sztuki (spec §2, §5.4):
 *   - pasuje do aktywnego kartonu → CISZA, licznik „brakuje" maleje,
 *   - należy do innego otwartego → zapis TAM, krótki ton, bursztyn w pasku,
 *   - nie pasuje nigdzie → ostry dźwięk i czerwony alarm na cały ekran.
 *
 * „Brakuje" jest największą liczbą na ekranie, bo tylko ją da się przeczytać
 * z wózka. Aktywny karton zajmuje ~2/3 szerokości; pozostałe kartony i
 * historia to wąski panel boczny. Skan KARTKI kartonu (SCARTON|… albo kod
 * palety zamówienia) przełącza aktywny karton — bez dotykania ekranu.
 *
 * PEŁNY KARTON NIE ZNIKA (właściciel 25.09.2026): robi się zielony
 * z poleceniem „zeskanuj kartkę i wjedź do mroźni". Skan kartki AKTYWNEGO
 * pełnego kartonu wstawia go do mroźni. Kartka INNEGO pełnego kartonu
 * najpierw go tylko wybiera (tak samo jak z menu: „otwórz karton") — wjazd
 * do mroźni to osobny, następny skan. Po wjeździe karton ZNIKA z pakowania.
 *
 * AKTUALNY KARTON W REFIE: skany idą kolejką, a kolejny skan startuje, zanim
 * React przerysuje ekran. Gdyby sztuka brała id kartonu z propsów, szybkie
 * „kartka → sztuka" poszłoby jeszcze do POPRZEDNIEGO kartonu.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isOfflineError, magazynApi, palletScanApi, palletsApi } from '@/lib/api'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { kodKartki, type KodKartki } from '@/features/scan/skanKodu'
import { usePakowanie } from './usePakowanie'
import { werdyktPakowania, type Uwaga } from './pakowanieWerdykt'
import { grajBlad, grajInny } from './dzwiek'
import { brakuje, dokadKarton, skladKartonu } from './opisKartonu'
import { kgTxt } from './pula'
import { Karta, Znacznik } from './components/Karta'
import { PasSkanowania, type PasSkanowaniaUchwyt, type SkanMeta } from './components/PasSkanowania'
import { StanPolaczenia } from './components/StanPolaczenia'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import type { OstatniaKartka, PokazAlarm, SkanOczekujacy } from './magazynTypes'

interface Wpis { ts: number; opis: string; gdzie: string; ton: 'cisza' | 'inny' | 'blad'; kod?: string; containerId?: string }

/** Ta sama kartka w tym oknie to podwójny odczyt, nie decyzja „do mroźni".
 *  Tyle samo co blokada powtórki w polu skanu (`utworzStraznikaWysylki`). */
export const POWTORKA_KARTKI_MS = 2000

export function EkranPakowania({ aktywnyId, onAktywny, onAlarm, oczekujace, onPrzejeto, ostatniaKartka, zablokowany = false }: {
  aktywnyId: string | null
  onAktywny: (id: string | null) => void
  onAlarm: PokazAlarm
  /** Skany złapane jeszcze na menu / w przejściu — idą przez kolejkę pola. */
  oczekujace?: SkanOczekujacy[]
  onPrzejeto?: (nr: number) => void
  /** Kartka, którą karton wybrano na menu — ochrona przed podwójnym odczytem. */
  ostatniaKartka?: OstatniaKartka | null
  /** Menu serwisowe otwarte — skaner w tle nic nie zapisuje. */
  zablokowany?: boolean
}) {
  const { kontenery, spakowane, odswiez, blad, aktualizacja, ladowanie } = usePakowanie()
  const [korekta, setKorekta] = useState<Wpis | null>(null)
  const [cofa, setCofa] = useState(false)
  const [skanuje, setSkanuje] = useState(false)
  const [uwaga, setUwaga] = useState<Uwaga | null>(null)
  const [wMrozni, setWMrozni] = useState<string | null>(null)
  const [dziennik, setDziennik] = useState<Wpis[]>([])
  const [zakladka, setZakladka] = useState<'skany' | 'kartony'>('skany')
  const pas = useRef<PasSkanowaniaUchwyt>(null)

  // Aktualny karton — ref nadąża za propsem, ale wybór w tym ekranie
  // zmienia go OD RAZU, bez czekania na render.
  const aktywnyRef = useRef(aktywnyId)
  const propAktywny = useRef(aktywnyId)
  if (propAktywny.current !== aktywnyId) { propAktywny.current = aktywnyId; aktywnyRef.current = aktywnyId }
  const kartkaRef = useRef<OstatniaKartka | null>(ostatniaKartka ?? null)
  const propKartka = useRef(ostatniaKartka)
  if (propKartka.current !== ostatniaKartka) { propKartka.current = ostatniaKartka; kartkaRef.current = ostatniaKartka ?? null }
  const dane = useRef({ kontenery, spakowane })
  dane.current = { kontenery, spakowane }

  // STRAŻNIK KONTEKSTU. Wyjście z ekranu, dialog (korekta, menu serwisowe)
  // i ręczny wybór kartonu z listy podbijają pokolenie. Skan, który czekał
  // na odczyt z serwera (lookup kartki, świeży stan), po powrocie sprawdza,
  // czy jest wciąż w tym samym kontekście — jeśli nie, NIE wysyła nowego
  // zapisu i nie zmienia kartonu. Unieważnienie jest trwałe: zamknięcie
  // dialogu nie wskrzesza skanu, który zaczął się przed nim.
  const pokolenie = useRef(0)
  const zywy = useRef(true)
  const blokada = useRef(false)
  useEffect(() => {
    zywy.current = true
    return () => { zywy.current = false; pokolenie.current++ }
  }, [])
  const aktualny = (pok: number) => zywy.current && !blokada.current && pok === pokolenie.current

  const otwarty = kontenery.find(k => k.id === aktywnyId) ?? null
  // Pełny karton zostaje na ekranie — zielony, z poleceniem mroźni.
  const pelny = otwarty ? null : (spakowane.find(k => k.id === aktywnyId) ?? null)
  const aktywny = otwarty ?? pelny
  const pozostale = kontenery.filter(k => k.id !== aktywnyId)

  function zapisz(w: Wpis) { setDziennik(d => [w, ...d].slice(0, 12)) }

  function alarm(naglowek: string, szczegol: string, gdzie?: string) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol, ...(gdzie ? { gdzie } : {}) })
  }

  function wybierz(id: string | null) {
    aktywnyRef.current = id
    onAktywny(id)
    setUwaga(null)
  }

  /** Dotknięcie kartonu na liście — wybór operatora wygrywa z kartką,
   *  która jeszcze czeka na odpowiedź serwera. */
  function wybierzRecznie(id: string) {
    pokolenie.current++
    wybierz(id)
  }

  /** Kartka czekała na serwer, a w tym czasie ekran się zmienił. Nic nie
   *  wysłano — ta ścieżka przerywa się PRZED jakimkolwiek zapisem. */
  function przerwany() {
    grajInny('L')
    onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'SKAN PRZERWANY',
      szczegol: 'Ekran zmienił się, zanim kartka została sprawdzona. Nic nie zapisano — zeskanuj kartkę jeszcze raz.' })
  }

  /** Skan, który czekał w kolejce, gdy ekran zniknął albo był zablokowany. */
  function pominiety() {
    grajInny('L')
    onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'SKAN NIE ZAPISANY',
      szczegol: 'Skan oczekiwał na wysłanie, gdy ekran został zablokowany/zmieniony. Zeskanuj ponownie.' })
  }

  function powtorkaKartki() {
    const pelnyWybrany = dane.current.spakowane.some(x => x.id === aktywnyRef.current)
    setUwaga({ naglowek: 'KARTON JEST WYBRANY',
      szczegol: `Ta sama kartka przyszła dwa razy — nic nie zapisano.${pelnyWybrany ? ' Do mroźni: zeskanuj ją jeszcze raz.' : ''}` })
  }

  /** `teraz` — chwila ODCZYTU kartki (nie koniec lookupu), `pok` — pokolenie
   *  z chwili, gdy skan wszedł do obsługi. */
  async function skanKartonu(kartka: KodKartki, id: string, teraz: number, pok: number) {
    const poprzednia = kartkaRef.current
    const powtorka = !!poprzednia && (poprzednia.id === id || poprzednia.kod === kartka.kod)
      && teraz - poprzednia.ts < POWTORKA_KARTKI_MS
    let { kontenery: otw, spakowane: pel } = dane.current
    if (!otw.some(x => x.id === id) && !pel.some(x => x.id === id)) {
      // Biuro mogło otworzyć karton przed chwilą — sprawdź świeży stan.
      const s = await odswiez()
      if (!aktualny(pok)) return przerwany()
      // Bez odczytu nie wiemy, czy karton jest otwarty — nie zgadujemy.
      if (!s) return alarm('BRAK AKTUALNYCH DANYCH',
        'Nie udało się sprawdzić kartonu — brak połączenia z serwerem. Nic nie zapisano, zeskanuj kartkę jeszcze raz za chwilę.')
      otw = s.kontenery ?? []; pel = s.spakowane ?? []
    }
    if (otw.some(x => x.id === id)) {
      kartkaRef.current = { id, kod: kartka.kod, ts: teraz }
      setWMrozni(null)
      return wybierz(id)
    }
    const p = pel.find(x => x.id === id)
    if (!p) {
      return alarm('TEN KARTON NIE JEST OTWARTY', 'Karton jest już w mroźni albo zamknięty. Weź kartkę innego kartonu.')
    }
    if (aktywnyRef.current !== id) {
      // INNY pełny karton — tylko go pokazujemy. Mroźnia to osobny skan.
      kartkaRef.current = { id, kod: kartka.kod, ts: teraz }
      setWMrozni(null)
      return wybierz(id)
    }
    if (powtorka) return powtorkaKartki()
    // Ostatnia bramka przed zapisem: nowy POST tylko w tym samym kontekście.
    if (!aktualny(pok)) return przerwany()
    // Kartka aktywnego pełnego kartonu = „wjeżdżam do mroźni". Ta sama akcja
    // co na kaflu MROŹNIA, więc ta sama ścieżka backendu i te same kody wyniku.
    if (p.kind === 'order') {
      const w = await palletScanApi.scan(kartka.kod, 'cold_storage')
      if (w.result !== 'SUCCESS') {
        const m = komunikatSkanu(w.result, { palletNo: w.palletNo })
        return alarm(m.naglowek, m.szczegol)
      }
    } else {
      const w = await magazynApi.mrozniaKarton(kartka.kod)
      if (w.result !== 'SUCCESS' && w.result !== 'ALREADY_SCANNED') {
        return alarm('KARTON NIE WSZEDŁ DO MROŹNI', 'Zeskanuj kartkę kartonu jeszcze raz albo zawołaj biuro.')
      }
    }
    kartkaRef.current = null
    // Zapis już się stał i o nim mówimy; ale ekran, który w tym czasie
    // zniknął albo dostał ręczny wybór, nie zmienia już aktywnego kartonu.
    if (aktualny(pok)) wybierz(null)
    setWMrozni(`Karton ${p.cartonNo} · ${p.clientName || 'na magazyn'}`)
    zapisz({ ts: Date.now(), opis: `Karton ${p.cartonNo} · ${p.clientName || 'na magazyn'}`, gdzie: 'mroźnia', ton: 'cisza' })
    void odswiez()
  }

  async function skanuj(kod: string, meta?: SkanMeta) {
    const pok = pokolenie.current
    const odczyt = meta?.ts ?? Date.now()
    try {
      const kartka = kodKartki(kod)
      if (kartka) {
        let id = kartka.rodzaj === 'stock' ? kartka.id : ''
        if (kartka.rodzaj === 'order') {
          try {
            id = String((await palletsApi.lookup(kartka.kod))?.id ?? '')
          } catch (e) {
            if (isOfflineError(e)) throw e
            id = ''
          }
        }
        if (!aktualny(pok)) return przerwany()
        if (!id) return alarm('NIEZNANA KARTKA', 'Tej kartki nie ma w systemie. Weź kartkę z kartonu albo zawołaj biuro.')
        return await skanKartonu(kartka, id, odczyt, pok)
      }

      setWMrozni(null)
      const akt = aktywnyRef.current
      const w = await magazynApi.skan(kod, akt)
      const v = werdyktPakowania(w, akt, kod)
      // Serwer wskazał inny aktywny (pierwsza sztuka, zamknięty karton) —
      // chyba że operator w międzyczasie sam wybrał karton albo wyszedł
      // z ekranu: wtedy stara odpowiedź nie zmienia aktywnego u rodzica.
      if (v.aktywny !== akt && aktywnyRef.current === akt && aktualny(pok)) wybierz(v.aktywny)
      if (v.dzwiek === 'inny') grajInny('L')
      if (v.alarm) { grajBlad('L'); onAlarm(v.alarm) }
      // Cisza zeruje bursztyn — ostatnia sztuka poszła tam, gdzie trzeba.
      setUwaga(v.uwaga)
      zapisz({
        ts: Date.now(),
        opis: w.unit || kod,
        gdzie: w.container ? `karton ${w.container.cartonNo}` : (v.alarm?.naglowek ?? ''),
        ton: v.dzwiek,
        ...((w.result === 'ACTIVE' || w.result === 'OTHER') && w.container
          ? { kod, containerId: w.container.id } : {}),
      })
      await odswiez()
    } catch (e) {
      if (isOfflineError(e)) {
        alarm('SKAN NIE ZAPISANY', 'Brak połączenia z serwerem. Odłóż sztukę na bok i zeskanuj ją ponownie za chwilę.')
      } else {
        alarm('SKAN NIE PRZESZEDŁ', e instanceof Error && e.message.length < 160 ? e.message : 'Spróbuj ponownie albo zawołaj biuro.')
      }
    }
  }

  const pasZablokowany = !!korekta || cofa || zablokowany
  blokada.current = pasZablokowany
  // Dialog / menu serwisowe trwale unieważnia skany zaczęte przed nim.
  useLayoutEffect(() => { if (pasZablokowany) pokolenie.current++ }, [pasZablokowany])

  // Skany z menu / z przejścia ekranu wchodzą do TEJ SAMEJ kolejki co pole —
  // po kolei, po pierwszym odczycie stanu. Przy otwartym dialogu nie
  // wysyłamy ich, tylko mówimy, że trzeba powtórzyć.
  const przejete = useRef(new Set<number>())
  useEffect(() => {
    if (!oczekujace?.length || ladowanie) return
    for (const s of oczekujace) {
      if (przejete.current.has(s.nr)) continue
      przejete.current.add(s.nr)
      onPrzejeto?.(s.nr)
      // Kartka, którą karton wybrano na menu, odczytana drugi raz tuż po
      // niej — to podwójny odczyt, nie decyzja „do mroźni". Liczy się
      // chwila ODCZYTU, nie to, ile trwało wczytanie ekranu.
      const k = kodKartki(s.kod)
      const pop = kartkaRef.current
      if (k && pop && k.kod === pop.kod && s.ts - pop.ts < POWTORKA_KARTKI_MS) powtorkaKartki()
      else if (pasZablokowany) pominiety()
      else pas.current?.dodaj(s.kod, s.ts)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oczekujace, ladowanie, pasZablokowany])

  async function cofnij() {
    if (!korekta?.kod || !korekta.containerId || cofa) return
    setCofa(true)
    try {
      await magazynApi.cofnij(korekta.kod, korekta.containerId)
      setDziennik(d => d.map(w => w.kod === korekta.kod ? { ...w, kod: undefined, gdzie: 'wyjęta z kartonu' } : w))
      wybierz(korekta.containerId)
      setKorekta(null)
      await odswiez()
    } catch (e) {
      alarm('NIE COFNIĘTO PAKOWANIA', e instanceof Error ? e.message : 'Odśwież stan i spróbuj ponownie.')
    } finally { setCofa(false) }
  }

  const b = aktywny ? brakuje(aktywny) : 0
  const komplet = !!aktywny && aktywny.targetQty > 0 && b === 0
  const procent = aktywny?.targetQty ? Math.min(100, Math.round(aktywny.packedQty / aktywny.targetQty * 100)) : 0
  // Pozycje: niedokończone na górze, dalej jak na kartce — receptura, waga.
  const pozycje = aktywny
    ? [...aktywny.lines].sort((x, y) =>
        // Najpierw to, co jeszcze trzeba spakować; komplety schodzą na dół.
        Number(x.packedQty >= x.targetQty) - Number(y.packedQty >= y.targetQty)
        || x.recipeName.localeCompare(y.recipeName, 'pl') || x.kgPerUnit - y.kgPerUnit)
    : []
  const kgSpak = aktywny ? aktywny.lines.reduce((s, l) => s + l.packedQty * l.kgPerUnit, 0) : 0
  const kgCel = aktywny ? aktywny.lines.reduce((s, l) => s + l.targetQty * l.kgPerUnit, 0) : 0
  const zielony = !!pelny || komplet

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StanPolaczenia blad={blad} aktualizacja={aktualizacja} ladowanie={ladowanie} />
      <div className="grid min-h-0 flex-1 gap-3 p-3 px-4 lg:gap-4 lg:px-5"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>

        {/* ── Aktywny karton — czytelny z wózka ─────────────────────── */}
        <div data-testid="pakowanie-glowny" className="flex min-h-0 flex-col overflow-y-auto rounded-2xl">
          {aktywny ? (
            <section data-testid={pelny ? 'karton-pelny' : 'karton-aktywny'}
              className="flex flex-col gap-3 rounded-2xl p-4 lg:p-5"
              style={zielony
                ? { background: 'var(--successSoft)', border: '2px solid var(--success)' }
                : { background: 'var(--panel)', border: '2px solid var(--accentLine)', boxShadow: '0 1px 3px rgba(15,23,42,.06)' }}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
                  Pakujesz karton
                </span>
                <Znacznik ton={aktywny.kind === 'order' ? 'akcja' : 'szary'}>{dokadKarton(aktywny)}</Znacznik>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span data-testid="numer-kartonu" className="hmi-v10-mono font-bold leading-none"
                  style={{ color: zielony ? 'var(--success)' : 'var(--accent)', fontSize: 'clamp(36px, 4.4vw, 60px)' }}>
                  {aktywny.cartonNo || '—'}
                </span>
                <span className="min-w-0 break-words font-extrabold leading-tight"
                  style={{ fontSize: 'clamp(28px, 3.2vw, 48px)' }}>
                  {aktywny.clientName || 'na magazyn'}
                </span>
              </div>

              {pelny ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <span className="font-extrabold leading-none" style={{ color: 'var(--success)', fontSize: 'clamp(36px, 4.2vw, 64px)' }}>
                      ✓ SPAKOWANY
                    </span>
                    <span className="hmi-v10-mono text-[22px] font-bold" style={{ color: '#166534' }}>
                      {pelny.packedQty} szt · {kgTxt(kgSpak)} kg
                    </span>
                  </div>
                  <div data-testid="polecenie-mroznia" className="rounded-xl px-5 py-4 text-white"
                    style={{ background: 'var(--success)' }}>
                    <span className="block font-extrabold leading-tight" style={{ fontSize: 'clamp(22px, 2.3vw, 34px)' }}>
                      ❄ Zeskanuj kartkę i wjedź do mroźni
                    </span>
                    <span className="mt-1 block text-[15px] font-semibold" style={{ opacity: .92 }}>
                      Karton jest wybrany. Następny skan TEJ kartki zapisze wjazd do mroźni.
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {/* NAJPIERW SZTUKI, POTEM KILOGRAMY (właściciel 25.09.2026). */}
                  <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
                    <div>
                      <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
                        Brakuje
                      </div>
                      <div data-testid="brakuje" className="hmi-v10-mono font-bold leading-none"
                        style={{ fontSize: 'clamp(60px, 7vw, 110px)', color: b ? 'var(--accent)' : 'var(--success)' }}>
                        {b}<span style={{ fontSize: '.36em', color: 'var(--mut)' }}> szt</span>
                      </div>
                    </div>
                    <div className="pb-2">
                      <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
                        Spakowano
                      </div>
                      <div className="hmi-v10-mono text-[28px] font-bold leading-tight">
                        {aktywny.packedQty}<span style={{ color: '#6B7280' }}>/{aktywny.targetQty}</span>
                        <span className="ml-2 text-[15px] font-semibold" style={{ color: 'var(--mut)' }}>szt</span>
                      </div>
                      <div data-testid="kg-kartonu" className="hmi-v10-mono text-[20px] font-bold leading-tight"
                        style={{ color: 'var(--mut)' }}>
                        {kgTxt(kgSpak)}<span>/{kgTxt(kgCel)}</span>
                        <span className="ml-2 text-[15px] font-semibold">kg</span>
                      </div>
                    </div>
                    {komplet ? (
                      <div data-testid="komplet" className="pb-3 text-[24px] font-extrabold" style={{ color: 'var(--success)' }}>
                        ✓ KOMPLET — wszystkie sztuki są w kartonie
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3.5 flex-1 overflow-hidden rounded-full" role="progressbar"
                      aria-valuenow={procent} aria-valuemin={0} aria-valuemax={100} aria-label="Postęp pakowania"
                      style={{ background: 'var(--lineSoft)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${procent}%`, background: komplet ? 'var(--success)' : 'var(--accent)' }} />
                    </div>
                    <span className="hmi-v10-mono shrink-0 text-[15px] font-bold" style={{ color: 'var(--mut)' }}>{procent}%</span>
                  </div>
                </>
              )}

              {/* CO MA BYĆ W KARTONIE — każda pozycja osobno, jak na kartce:
                  „20 × 30 kg KIRMIZI". Nazwy się ZAWIJAJĄ, nie ucinają. */}
              <div data-testid="sklad-kartonu" className="overflow-hidden rounded-xl"
                style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                {pozycje.map((p, i) => {
                  const zost = Math.max(0, p.targetQty - p.packedQty)
                  const gotowa = zost === 0
                  return (
                    <div key={i} data-testid="pozycja-kartonu" className="flex items-center gap-4 px-4 py-3"
                      style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined,
                               background: gotowa ? 'var(--successSoft)' : undefined }}>
                      <span className="hmi-v10-mono shrink-0 font-bold leading-none"
                        style={{ fontSize: 'clamp(22px, 2.3vw, 34px)', minWidth: '5.4em' }}>
                        {p.targetQty}<span style={{ color: 'var(--mut)' }}> × </span>{kgTxt(p.kgPerUnit)}
                        <span style={{ fontSize: '.55em', color: 'var(--mut)' }}> kg</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-extrabold uppercase leading-tight"
                          style={{ fontSize: 'clamp(19px, 1.9vw, 28px)' }}>{p.recipeName || '—'}</span>
                        <span className="block break-words text-[14px]" style={{ color: 'var(--mut)' }}>
                          {[p.productTypeName, p.packagingName].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="hmi-v10-mono block text-[22px] font-bold leading-none"
                          style={{ color: gotowa ? 'var(--success)' : 'var(--ink)' }}>
                          {gotowa ? '✓ ' : ''}{p.packedQty}/{p.targetQty}
                        </span>
                        <span className="mt-1 block text-[13px] font-bold"
                          style={{ color: gotowa ? 'var(--success)' : 'var(--accent)' }}>
                          {gotowa ? 'komplet' : `brakuje ${zost}`}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : (
            <section data-testid="brak-kartonu" className="flex flex-col items-start gap-3 rounded-2xl p-6"
              style={{ background: 'var(--panel)', border: '2px dashed var(--accentLine)' }}>
              <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
                Nie wybrano kartonu
              </div>
              <div className="text-[30px] font-extrabold leading-tight">
                Zeskanuj QR z kartki kartonu — otworzę jego pakowanie
              </div>
              <div className="text-[16px] leading-snug" style={{ color: 'var(--mut)' }}>
                Możesz też od razu skanować <b style={{ color: 'var(--ink)' }}>etykiety sztuk</b>:
                każda trafi do kartonu, do którego należy, a ekran pokaże który.
              </div>
            </section>
          )}
        </div>

        {/* ── Boczny panel: werdykt ostatniego skanu, inne kartony, historia ── */}
        <div className="flex min-h-0 flex-col gap-3">
          {blad || ladowanie ? null : wMrozni ? (
            <div role="status" data-testid="w-mrozni" className="flex shrink-0 items-center gap-3 rounded-xl px-4 py-3"
              style={{ background: 'var(--success)', color: '#fff' }}>
              <span className="text-[26px] leading-none">❄</span>
              <span className="min-w-0">
                <span className="block text-[18px] font-extrabold leading-tight">WJECHAŁ DO MROŹNI</span>
                <span className="mt-0.5 block break-words text-[14.5px]" style={{ opacity: .9 }}>{wMrozni}</span>
              </span>
            </div>
          ) : uwaga ? (
            <div role="status" data-testid="uwaga-pakowania" className="flex shrink-0 items-start gap-3 rounded-xl px-4 py-3"
              style={{ background: 'var(--ambSoft)', border: '3px solid var(--amb)' }}>
              <span className="text-[30px] font-extrabold leading-none" style={{ color: 'var(--amb)' }}>!</span>
              <span className="min-w-0">
                <span className="block break-words font-extrabold leading-tight"
                  style={{ color: 'var(--amb)', fontSize: 'clamp(22px, 2.3vw, 30px)' }}>
                  {uwaga.naglowek}
                </span>
                <span className="mt-1 block break-words text-[14.5px]" style={{ color: '#92400E' }}>{uwaga.szczegol}</span>
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-[14.5px] font-bold"
              style={{ background: 'var(--successSoft)', border: '1px dashed var(--successLine)', color: '#166534' }}>
              ✓ Cisza — sztuki trafiają do swoich kartonów
            </div>
          )}

          <div className="flex shrink-0 gap-2" role="tablist">
            {([['skany', `Ostatnie skany · ${dziennik.length}`], ['kartony', `Inne kartony · ${pozostale.length}`]] as const).map(([z, t]) => (
              <button key={z} type="button" role="tab" aria-selected={zakladka === z} onClick={() => setZakladka(z)}
                className="min-h-11 flex-1 rounded-lg px-3 text-[13.5px] font-extrabold"
                style={zakladka === z
                  ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
                  : { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
                {t}
              </button>
            ))}
          </div>

          {zakladka === 'skany' ? (
            <Karta tytul="Ostatnie skany" className="flex-1" tresc={false} prawo={<span>w tej sesji</span>}>
              {dziennik.map((w, i) => (
                <div key={`${w.ts}-${i}`} className="flex items-center gap-2 px-3 py-2"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{w.opis}</span>
                    <span className="block text-[12.5px] font-bold"
                      style={{ color: w.ton === 'blad' ? 'var(--red)' : w.ton === 'inny' ? 'var(--amb)' : 'var(--success)' }}>
                      <span className="hmi-v10-mono mr-2 font-normal" style={{ color: 'var(--mut)' }}>
                        {new Date(w.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {w.gdzie}
                    </span>
                  </span>
                  {w.kod ? <button type="button" className="min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold"
                    style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
                    disabled={skanuje || blad} onClick={() => setKorekta(w)}>Wyjmij</button> : null}
                </div>
              ))}
              {!dziennik.length ? (
                <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Jeszcze nic nie zeskanowano.</div>
              ) : null}
            </Karta>
          ) : (
            <Karta tytul="Inne otwarte kartony" tresc={false} className="flex-1"
              prawo={<span>dotknij, żeby wybrać</span>}>
              {pozostale.map((k, i) => (
                <button key={k.id} type="button" onClick={() => wybierzRecznie(k.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--accentSoft)]"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined, color: 'var(--ink)' }}>
                  <span className="hmi-v10-mono shrink-0 text-[18px] font-bold" style={{ color: 'var(--accent)' }}>
                    {k.cartonNo}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold">{k.clientName || 'na magazyn'}</span>
                    <span className="block truncate text-[12px]" style={{ color: 'var(--mut)' }}>{skladKartonu(k)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="hmi-v10-mono block text-[15px] font-bold">{k.packedQty}/{k.targetQty}</span>
                    <span className="block text-[11px]" style={{ color: 'var(--mut)' }}>brakuje {brakuje(k)}</span>
                  </span>
                </button>
              ))}
              {!pozostale.length ? (
                <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Brak innych otwartych kartonów.</div>
              ) : null}
            </Karta>
          )}
        </div>
      </div>

      <PasSkanowania ref={pas} placeholder="Skanuj etykietę sztuki albo kartkę kartonu…" onSkan={skanuj}
        disabled={pasZablokowany || ladowanie} onPendingChange={setSkanuje} onPominiety={pominiety}
        podpis="Pasuje — cisza. Inny karton — krótki ton i numer. Nie pasuje — alarm." />
      <Dialog open={!!korekta} onOpenChange={open => { if (!open && !cofa) setKorekta(null) }}>
        <DialogContent style={HMI_VARS} onInteractOutside={e => e.preventDefault()}>
          <DialogTitle>Wyjąć sztukę z kartonu?</DialogTitle>
          <DialogDescription>{korekta?.opis} · {korekta?.gdzie}. Wyjmij fizycznie tę sztukę. Korekta zapisze operatora.</DialogDescription>
          <div className="flex gap-3">
            <button className="min-h-12 flex-1 rounded-xl border p-3 font-bold" disabled={cofa} onClick={() => setKorekta(null)}>Wróć</button>
            <button className="min-h-12 flex-1 rounded-xl bg-red-700 p-3 font-bold text-white" disabled={cofa} onClick={cofnij}>
              {cofa ? 'Zapisuję…' : 'Wyjmij sztukę'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
