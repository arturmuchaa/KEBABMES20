/**
 * Kiosk stanowiska magazynowego — menu czynności i nawigacja.
 *
 * Cztery czynności, trzy poziomy: czynność → którą konkretnie → robota.
 * Warstwy środkowej brakowało w pierwszym projekcie i to była główna uwaga
 * właściciela: panel wchodził od razu w jedną dostawę / karton / auto wbite
 * na sztywno.
 *
 * KARTONY i WYDANIE stoją w górnym rzędzie, bo to dwie roboty dnia (decyzja
 * 25.09.2026: najpierw pakowanie i wydanie na samochód). PRZYJĘCIE jest
 * widoczne, ale wyłączone — kafel prowadzący donikąd jest gorszy niż kafel,
 * który uczciwie mówi „jeszcze nie".
 *
 * CZEGO TU NIE MA: wołania „auto stoi na rampie". Nikt tej informacji nie
 * wprowadza. Kafel WYDANIE liczy z terminów dostawy zamówień — dane, które
 * już są.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { HMI_FONT, HMI_VARS } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { useAuth } from '@/features/auth/AuthContext'
import { useServiceHold, ServiceMenuModal, serviceSections } from '@/features/deboning/ServiceMenu'
import { isOfflineError, magazynApi, palletsApi, type KartonDoWazenia, type PodsumowanieMagazynu } from '@/lib/api'
import { kodKartki } from '@/features/scan/skanKodu'
import { useSkanGlobalny } from '@/features/magazyn/useSkanGlobalny'
import { grajBlad, grajInny } from '@/features/magazyn/dzwiek'
import { Kafel } from '@/features/magazyn/components/Kafel'
import { Alarm } from '@/features/magazyn/components/Alarm'
import { EkranKartonow } from '@/features/magazyn/EkranKartonow'
import { EkranPakowania } from '@/features/magazyn/EkranPakowania'
import { EkranWyboruAuta } from '@/features/magazyn/EkranWyboruAuta'
import { EkranZaladunku } from '@/features/magazyn/EkranZaladunku'
import { EkranMrozni } from '@/features/magazyn/EkranMrozni'
import { KartaKartonu } from '@/features/magazyn/KartaKartonu'
import { drukujEtykieteWagi } from '@/features/magazyn/drukEtykietyWagi'
import type { EkranMagazynu, OstatniaKartka, SkanOczekujacy, StanAlarmu } from '@/features/magazyn/magazynTypes'

declare const __MAGAZYN_VERSION__: string

/** Wersja widoczna na KAŻDYM ekranie i w menu serwisowym — ta sama, co
 *  wstrzyknął build z `tauri.magazyn.conf.json`. Po cichej aktualizacji
 *  widać na oko, czy stanowisko ją dostało (wzorzec z rozbioru v10). */
export const WERSJA_HMI = `HMI Magazyn · ${__MAGAZYN_VERSION__}`

/** Ekrany bez pola skanu, na których kartka kartonu otwiera jego pakowanie. */
const EKRANY_SKANU_KARTKI: EkranMagazynu[] = ['kafle', 'kartony', 'wydanie-auta']

const TYTULY: Record<EkranMagazynu, { t: string; p: string; back: EkranMagazynu | null }> = {
  'kafle':         { t: 'Magazyn',  p: 'Stanowisko magazynowe',        back: null },
  'kartony':       { t: 'Kartony',  p: 'Co i czym pakować',            back: 'kafle' },
  'kartony-praca': { t: 'Kartony',  p: 'Pakowanie',                    back: 'kartony' },
  'wydanie-auta':  { t: 'Wydanie',  p: 'Które auto',                   back: 'kafle' },
  'wydanie-praca': { t: 'Wydanie',  p: 'Załadunek palet',              back: 'wydanie-auta' },
  'mroznia':       { t: 'Mroźnia',  p: 'Wstawianie palet',             back: 'kafle' },
}

/** Jak długo alarm zasłania ekran. Znika sam — magazynier wraca do roboty,
 *  a nie do zamykania okienek. */
const ALARM_MS = 3400

/** 1 karton, 2–4 kartony, 5+ kartonów (12–14 też „kartonów"). */
export function kartonow(n: number): string {
  if (n === 1) return 'karton'
  const r10 = n % 10, r100 = n % 100
  return r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14) ? 'kartony' : 'kartonów'
}

function hhmm(d: Date) {
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex shrink-0 flex-col justify-center pl-5" style={{ borderLeft: '1px solid var(--lineSoft)' }}>
      <span className="mb-1.5 text-[9px] font-bold uppercase leading-none tracking-[0.14em]"
        style={{ color: 'var(--mut)' }}>{label}</span>
      <b className="hmi-v10-mono text-sm font-bold leading-tight"
        style={accent ? { color: 'var(--accent)' } : undefined}>{value}</b>
    </div>
  )
}

export function MagazynHmiPage() {
  const { user, logout } = useAuth()
  const [ekran, setEkranStan] = useState<EkranMagazynu>('kafle')
  const [pojazdId, setPojazdId] = useState('')
  const [aktywnyKarton, setAktywnyKarton] = useState<string | null>(null)
  // Skany złapane na menu / w przejściu — pakowanie przyjmuje je swoją kolejką.
  const [oczekujace, setOczekujaceStan] = useState<SkanOczekujacy[]>([])
  const [ostatniaKartka, setOstatniaKartka] = useState<OstatniaKartka | null>(null)
  const [szukam, setSzukam] = useState(false)
  const [alarm, setAlarm] = useState<StanAlarmu | null>(null)
  const [ostatniBlad, setOstatniBlad] = useState<StanAlarmu | null>(null)
  const [stan, setStan] = useState<PodsumowanieMagazynu | null>(null)
  const [stanBlad, setStanBlad] = useState(false)
  const [teraz, setTeraz] = useState(() => new Date())
  const [menuSerwisowe, setMenuSerwisowe] = useState(false)
  // Karta kartonu — skan gotowego kartonu (np. w mroźni) pokazuje, co w nim jest.
  const [karta, setKarta] = useState<KartonDoWazenia | null>(null)

  const pokazAlarm = useCallback((a: Omit<StanAlarmu, 'ts'>) => {
    const pelny: StanAlarmu = { ...a, ts: Date.now() }
    setAlarm(pelny)
    if (a.ton === 'blad') setOstatniBlad(pelny)
    setTimeout(() => setAlarm(x => (x && x.ts === pelny.ts ? null : x)), ALARM_MS)
  }, [])

  // Ekran w refie: skan w kolejce sprawdza, gdzie JESTEŚMY, a nie gdzie
  // byliśmy, kiedy przyszedł.
  const ekranRef = useRef(ekran)
  const setEkran = useCallback((e: EkranMagazynu) => { ekranRef.current = e; setEkranStan(e) }, [])
  const oczekujaceRef = useRef<SkanOczekujacy[]>([])
  const setOczekujace = useCallback((q: SkanOczekujacy[]) => { oczekujaceRef.current = q; setOczekujaceStan(q) }, [])
  // Każde RĘCZNE przejście (Wstecz, kafel, wybór z listy) podbija pokolenie.
  // Wynik skanu z poprzedniego pokolenia nie może już nikogo przenieść.
  const pokolenie = useRef(0)
  const kolejka = useRef(Promise.resolve())
  const nrSkanu = useRef(0)

  const przerwany = useCallback(() => {
    grajInny('L')
    pokazAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'SKAN PRZERWANY',
      szczegol: 'Ekran zmienił się, zanim skan się skończył. Nic nie zapisano — zeskanuj jeszcze raz.' })
  }, [pokazAlarm])

  // Numer odczytu, który trzyma spinner „Szukam kartonu…" — stary odczyt,
  // kończący się po unieważnieniu, nie gasi spinnera nowego.
  const szukamNr = useRef(0)

  /** Ręczne przejście, menu serwisowe, wylogowanie: skan w trakcie odczytu
   *  i skany czekające na pakowanie przepadają (z komunikatem). Nowe skany
   *  nie czekają za odczytem, który już nic nie zmieni. */
  const uniewaznij = useCallback(() => {
    pokolenie.current++
    kolejka.current = Promise.resolve()
    szukamNr.current++
    setSzukam(false)
    if (oczekujaceRef.current.length) { setOczekujace([]); przerwany() }
  }, [setOczekujace, przerwany])

  const przejdz = useCallback((e: EkranMagazynu) => {
    uniewaznij()
    setEkran(e)
  }, [setEkran, uniewaznij])

  /** Właściciel 29.09.2026: skan gotowego kartonu (w mroźni, na aucie) to nie
   *  błąd — system wchodzi w karton i pokazuje status, skład i partie. */
  const pokazKarte = useCallback(async (kod: string) => {
    try {
      const k = await magazynApi.mrozniaSprawdz(kod)
      if (k.result === 'INVALID') {
        grajBlad('L')
        pokazAlarm({ skaner: 'L', ton: 'blad', naglowek: 'NIEZNANA KARTKA',
          szczegol: 'Tej kartki nie ma w systemie. Weź kartkę z kartonu albo zawołaj biuro.' })
        return
      }
      setKarta(k)
    } catch (err) {
      grajBlad('L')
      pokazAlarm({ skaner: 'L', ton: 'blad', naglowek: 'BRAK POŁĄCZENIA',
        szczegol: isOfflineError(err) ? 'Nie udało się odczytać kartonu — spróbuj za chwilę.' : 'Zeskanuj kartkę jeszcze raz.' })
    }
  }, [pokazAlarm])

  async function wyjazdZKarty(k: KartonDoWazenia) {
    if (!k.code) return
    try {
      const w = await magazynApi.mrozniaWyjazd(k.code)
      if (w.result === 'SUCCESS') {
        grajInny('L')
        pokazAlarm({ skaner: 'L', ton: 'uwaga', naglowek: `KARTON ${w.cartonNo ?? ''} WYJECHAŁ Z MROŹNI`,
          szczegol: 'Popraw karton na kaflu KARTONY. Do mroźni wraca przez kafel MROŹNIA → Wjedź (z ważeniem).' })
        setKarta(await magazynApi.mrozniaSprawdz(k.code))
      } else {
        grajBlad('L')
        pokazAlarm({ skaner: 'L', ton: 'blad', naglowek: w.result === 'GONE' ? 'KARTON JEST NA AUCIE' : 'KARTONU NIE MA W MROŹNI',
          szczegol: w.result === 'GONE' ? 'Zdejmij go z auta na ekranie załadunku.' : 'Nic nie zmieniono.' })
      }
    } catch (err) {
      grajBlad('L')
      pokazAlarm({ skaner: 'L', ton: 'blad', naglowek: 'WYJAZD NIE ZAPISANY',
        szczegol: isOfflineError(err) ? 'Brak połączenia — spróbuj za chwilę.' : err instanceof Error ? err.message : '' })
    }
  }

  const { holdProps } = useServiceHold(() => { uniewaznij(); setMenuSerwisowe(true) })

  // Odmontowanie (wylogowanie, zamknięcie kiosku) — spóźniony odczyt
  // niczego już nie przełącza ani nie ogłasza.
  const zywy = useRef(true)
  useEffect(() => {
    zywy.current = true
    return () => { zywy.current = false; pokolenie.current++ }
  }, [])

  const doPakowania = useCallback((kod: string, ts: number) => {
    setOczekujace([...oczekujaceRef.current, { nr: ++nrSkanu.current, kod, ts }])
    setEkran('kartony-praca')
  }, [setEkran, setOczekujace])

  /** Skan złapany poza polem skanu (menu, lista kartonów, wybór auta,
   *  przejście ekranu). Właściciel 25.09.2026: kartka kartonu ma od razu
   *  otwierać pakowanie TEGO kartonu — bez szukania go na liście.
   *  Skany idą PO KOLEI: sztuka zeskanowana zaraz po kartce czeka, aż kartka
   *  wybierze karton, i idzie już do niego. */
  const obsluzSkan = useCallback(async (kod: string, ts: number, pok: number) => {
    const blad = (naglowek: string, szczegol: string) => {
      grajBlad('L')
      pokazAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol })
    }
    // Po unieważnieniu (serwis, wyjście) — ogłaszamy, o ile strona żyje.
    const nieaktualny = () => { if (zywy.current) przerwany() }
    if (pok !== pokolenie.current) return nieaktualny()
    const e = ekranRef.current
    if (e === 'kartony-praca') return doPakowania(kod, ts)
    if (!EKRANY_SKANU_KARTKI.includes(e)) return przerwany()
    const kartka = kodKartki(kod)
    // Wszystko inne traktujemy jak sztukę: o tym, czy kod jest znany,
    // rozstrzyga serwer (i zapisuje w logu surowy kod, gdy nie jest).
    if (!kartka) return doPakowania(kod, ts)

    const nr = ++szukamNr.current
    setSzukam(true)
    try {
      let id = kartka.rodzaj === 'stock' ? kartka.id : ''
      if (kartka.rodzaj === 'order') {
        try {
          id = String((await palletsApi.lookup(kartka.kod))?.id ?? '')
        } catch (err) {
          if (isOfflineError(err)) throw err
          id = ''
        }
        if (pok !== pokolenie.current) return nieaktualny()
      }
      const s = id ? await magazynApi.pakowanie() : null
      if (pok !== pokolenie.current) return nieaktualny()
      if (!s) return blad('NIEZNANA KARTKA', 'Tej kartki nie ma w systemie. Weź kartkę z kartonu albo zawołaj biuro.')
      // Otwarty — pakujemy; pełny — ten sam ekran pokaże go na zielono
      // z poleceniem mroźni. Do mroźni wjedzie dopiero NASTĘPNY skan kartki.
      if ((s.kontenery ?? []).some(k => k.id === id) || (s.spakowane ?? []).some(k => k.id === id)) {
        setAktywnyKarton(id)
        setOstatniaKartka({ id, kod: kartka.kod, ts })
        setEkran('kartony-praca')
        return
      }
      // Karton gotowy (w mroźni, na aucie) — karta kartonu zamiast błędu.
      await pokazKarte(kartka.kod)
    } catch (err) {
      if (pok !== pokolenie.current) return nieaktualny()
      blad(isOfflineError(err) ? 'BRAK POŁĄCZENIA' : 'NIE ROZPOZNANO KODU',
        isOfflineError(err) ? 'Skan nie doszedł do serwera. Nic nie otwarto — spróbuj za chwilę.' : 'Zeskanuj kartkę kartonu jeszcze raz.')
    } finally {
      if (nr === szukamNr.current && zywy.current) setSzukam(false)
    }
  }, [pokazAlarm, przerwany, doPakowania, setEkran, pokazKarte])

  const naSkanGlobalny = useCallback((kod: string) => {
    const ts = Date.now()
    const pok = pokolenie.current
    kolejka.current = kolejka.current.then(() => obsluzSkan(kod, ts, pok)).catch(() => {})
  }, [obsluzSkan])

  // Na pakowaniu słuchamy też: skan, który trafi obok pola (przejście
  // ekranu, otwarty dialog), idzie do kolejki pakowania, a ta — jeśli nie
  // może go przyjąć — mówi, że trzeba powtórzyć. W polu tekstowym hook milczy.
  useSkanGlobalny(!menuSerwisowe && !karta && (EKRANY_SKANU_KARTKI.includes(ekran) || ekran === 'kartony-praca'), naSkanGlobalny)

  useEffect(() => {
    const t = setInterval(() => setTeraz(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  // Żywy stan pod kaflami — tylko gdy kafle są na ekranie.
  useEffect(() => {
    if (ekran !== 'kafle') return
    let zywy = true
    const wczytaj = () => magazynApi.podsumowanie()
      .then(s => { if (zywy) { setStan(s); setStanBlad(false) } })
      .catch(() => { if (zywy) setStanBlad(true) })
    void wczytaj()
    const t = setInterval(wczytaj, 10000)
    return () => { zywy = false; clearInterval(t) }
  }, [ekran])

  const meta = TYTULY[ekran]
  const k = stan?.kartony
  const w = stan?.wydanie
  const dzien = teraz.toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: '2-digit' })

  return (
    <div data-testid="magazyn-hmi" className="relative flex h-full w-full flex-col overflow-hidden"
      style={{ ...HMI_VARS, fontFamily: HMI_FONT, background: 'var(--bg)', color: 'var(--ink)' }}>

      <header className="flex h-[76px] shrink-0 items-center gap-5 px-6"
        style={{ background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
        {karta || meta.back ? (
          <button type="button" onClick={() => (karta ? setKarta(null) : przejdz(meta.back!))}
            className="h-11 shrink-0 rounded-lg px-4 text-[14px] font-bold"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
            ← Wstecz
          </button>
        ) : null}
        <div {...holdProps} style={{ touchAction: 'manipulation' }}>
          <div className="text-xl font-extrabold uppercase leading-none tracking-tight">{meta.t}</div>
          {/* Jak w rozbiorze: pod tytułem „opis · wersja" drobnym drukiem. */}
          <div className="hmi-v10-mono mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: 'var(--mut)' }}>
            <span>{karta ? 'Karta kartonu' : meta.p}</span> · <span data-testid="wersja-hmi">{WERSJA_HMI}</span>
          </div>
        </div>
        <Chip label="Operator" value={(user?.name ?? '—').split(' ')[0]} accent />
        <div className="hidden xl:flex"><Chip label="Dzień" value={dzien} /></div>
        <div className="flex-1" />
        <div className="hmi-v10-mono shrink-0 text-[26px] font-bold tracking-tight">{hhmm(teraz)}</div>
        <button type="button" onClick={() => { uniewaznij(); logout() }}
          className="h-9 shrink-0 rounded-lg px-4 text-[13px] font-bold"
          style={{ border: '1px solid var(--line)', color: 'var(--mut)', background: 'var(--panel)' }}>
          Wyloguj
        </button>
      </header>
      {ekran === 'kafle' && stanBlad ? <div role="status" className="shrink-0 px-6 py-2 font-bold"
        style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>Brak aktualnych danych — liczby na kaflach mogą być nieaktualne.</div> : null}

      {ostatniBlad && !alarm ? <div className="flex shrink-0 items-center gap-4 px-6 py-2"
        style={{ background: 'var(--redSoft)', color: 'var(--red)' }} role="status">
        <div className="min-w-0 flex-1"><b>Ostatni błąd: {ostatniBlad.naglowek}</b>
          <div className="text-sm">{ostatniBlad.szczegol} {ostatniBlad.gdzie}</div></div>
        <button className="min-h-11 rounded-lg border px-4 font-bold" onClick={() => setOstatniBlad(null)}>Przeczytane</button>
      </div> : null}

      {/* Właściciel 30.09.2026: stała instrukcja „zeskanuj kartkę — otworzę
          pakowanie" niepotrzebna. Pasek zostaje tylko na czas szukania
          kartonu po skanie, żeby było widać, że skan dotarł. */}
      {szukam && EKRANY_SKANU_KARTKI.includes(ekran) ? (
        <div data-testid="instrukcja-kartki" role="status" className="flex shrink-0 items-center gap-3 px-6 py-2.5"
          style={{ background: 'var(--accentSoft)', borderBottom: '1px solid var(--accentLine)' }}>
          <span className="text-[18px] font-extrabold" style={{ color: 'var(--accent)' }}>Szukam kartonu z tej kartki…</span>
        </div>
      ) : null}

      {ekran === 'kafle' ? (
        <main className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-5 px-6" style={{ gridAutoRows: '1fr' }}>
          {/* Właściciel 25.09.2026: kafel liczy KARTONY z biura — nietknięte
              „do spakowania" i zaczęte „do dokończenia", np. 14 · 2. */}
          <Kafel nazwa="Kartony" czynnosc="Spakuj sztuki do kartonu" glif="▣"
            licznik={k ? String(k.doSpakowania ?? k.otwarte) : '—'}
            jednostka={k ? `${kartonow(k.doSpakowania ?? k.otwarte)} do spakowania` : ''}
            stan={k
              ? [
                  `do dokończenia: ${k.doDokonczenia ?? 0}`,
                  k.zalegle ? `${k.zalegle} szt zaległych z poprzednich dni` : `${k.sztukDoSpakowania} szt z produkcji czeka`,
                ].join(' · ')
              : 'wczytuję stan…'}
            podglad={(k?.zaczete ?? []).map(z => ({
              lewo: `${z.cartonNo} · ${z.klient || 'na magazyn'}`,
              prawo: `${z.packedQty}/${z.targetQty} szt`, wyrozniony: true }))}
            wariant={k?.zalegle ? 'pilne' : k && k.otwarte === 0 ? 'gotowe' : 'zwykly'}
            onClick={() => przejdz('kartony')} />
          <Kafel nazwa="Wydanie" czynnosc="Załaduj auto" glif="⇥"
            licznik={w ? String(w.zamowien) : '—'} jednostka={w?.zamowien === 1 ? 'zamówienie na dziś' : 'zamówień na dziś'}
            stan={w ? (w.zamowien ? `${Math.round(w.kg).toLocaleString('pl-PL')} kg do wydania dziś` : 'na dziś nic nie czeka')
                    : 'wczytuję stan…'}
            podglad={(w?.lista ?? []).map(z => ({
              lewo: z.klient, prawo: `${Math.round(z.kg).toLocaleString('pl-PL')} kg` }))}
            onClick={() => przejdz('wydanie-auta')} />
          <Kafel nazwa="Mroźnia" czynnosc="Wjazd z ważeniem · wyjazd" glif="❄"
            licznik={stan ? String(stan.mroznia.palet) : '—'} jednostka={`${kartonow(stan?.mroznia.palet ?? 0)} w mroźni`}
            stan="czeka na załadunek"
            podglad={(stan?.mroznia.lista ?? []).map(m => ({
              lewo: m.klient, prawo: `${m.palet} pal.` }))}
            onClick={() => przejdz('mroznia')} />
          <Kafel nazwa="Przyjęcie" czynnosc="Przyjmij dostawę z rampy" glif="⤓"
            licznik="—" stan="w kolejnym wydaniu panelu" disabled onClick={() => {}} />
        </main>
      ) : null}

      {ekran === 'kartony' ? (
        <EkranKartonow onWybor={id => { setAktywnyKarton(id); przejdz('kartony-praca') }} />
      ) : null}

      {ekran === 'kartony-praca' ? (
        <EkranPakowania aktywnyId={aktywnyKarton} onAktywny={setAktywnyKarton} onAlarm={pokazAlarm}
          oczekujace={oczekujace} ostatniaKartka={ostatniaKartka} zablokowany={menuSerwisowe || !!karta}
          onKartaKartonu={pokazKarte}
          onPrzejeto={nr => setOczekujace(oczekujaceRef.current.filter(s => s.nr !== nr))} />
      ) : null}

      {ekran === 'wydanie-auta' ? (
        <EkranWyboruAuta onWybor={id => { setPojazdId(id); przejdz('wydanie-praca') }} />
      ) : null}

      {ekran === 'wydanie-praca' ? (
        <EkranZaladunku vehicleId={pojazdId} onAlarm={pokazAlarm} onKoniec={() => przejdz('kafle')} />
      ) : null}

      {ekran === 'mroznia' ? <EkranMrozni onAlarm={pokazAlarm} zablokowany={!!karta}
        onKartaKartonu={pokazKarte}
        onOtworzKarton={id => { setAktywnyKarton(id); przejdz('kartony-praca') }} /> : null}

      {karta ? (
        <KartaKartonu karton={karta} onZamknij={() => setKarta(null)}
          onWyjazd={karta.status === 'cold_storage' ? () => void wyjazdZKarty(karta) : undefined}
          onDodruk={karta.lastWeighing ? () => {
            void drukujEtykieteWagi(karta.lastWeighing!).then(b => {
              if (b) pokazAlarm({ skaner: 'L', ton: 'blad', naglowek: 'ETYKIETA NIE WYDRUKOWANA', szczegol: b })
            })
          } : undefined}
          onPakuj={(karta.status === 'packing' || karta.status === 'full') && karta.id ? () => {
            setAktywnyKarton(karta.id!); setKarta(null); przejdz('kartony-praca')
          } : undefined} />
      ) : null}

      <Alarm alarm={alarm} />

      <ServiceMenuModal open={menuSerwisowe} onClose={() => setMenuSerwisowe(false)}
        channel="magazyn" version={__MAGAZYN_VERSION__}
        buildLabel={WERSJA_HMI}
        sections={serviceSections('magazyn')} />
    </div>
  )
}
