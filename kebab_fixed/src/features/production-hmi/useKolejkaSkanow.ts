/**
 * Kolejka skanów sztuk z GŁÓWNEGO ekranu HMI produkcji (03.10.2026).
 *
 * Kierownik skanuje różne produkty na przemian, a następny kod wpada, zanim
 * wróci odpowiedź na poprzedni. Dlatego:
 *   - FIFO wspólna dla pola skanu i nasłuchu na dokumencie; w locie
 *     najwyżej JEDEN POST (kolejność na serwerze = kolejność skanów),
 *   - każdy rekord ma ZAMROŻONY plan z chwili odczytu — zmiana planu na
 *     ekranie nie przekierowuje kodów już przyjętych; serwer odrzuca sztukę
 *     spoza tego planu,
 *   - przyjęcie do kolejki NIE jest sukcesem: „Zapisane" rośnie i krótki
 *     dźwięk gra dopiero po odpowiedzi serwera,
 *   - błąd jednej sztuki nie zatrzymuje następnych; każdy trafia na trwałą
 *     listę z kodem i powodem; nic nie jest ponawiane automatycznie, a brak
 *     odpowiedzi to wynik NIEPEWNY (nie „nie zapisano"),
 *   - odmontowanie: żaden NOWY POST nie wychodzi; odpowiedź na żądanie
 *     w locie nie zmienia już stanu. Flaga `zywy` ustawiana w setupie efektu
 *     — StrictMode (setup → cleanup → setup) jej nie gubi.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { beepErr, beepOk } from '@/features/pwa/beep'
import type { ScanProducedResult } from '@/lib/api'
import { opiszBladSkanu } from './skanWynik'

export interface RekordSkanu {
  nr: number
  kod: string
  /** Plan widoczny w chwili odczytu — idzie na serwer jako `expected_plan_id`. */
  planId: string
}

export interface BladSkanu {
  nr: number
  kod: string
  tytul: string
  tekst: string
  /** Brak odpowiedzi / 5xx — nie wiadomo, czy sztuka weszła. */
  niepewny: boolean
}

export interface OstatniSkan {
  ok: boolean
  kod: string
  tytul: string
  tekst: string
  wynik?: ScanProducedResult
}

export interface StanKolejki {
  oczekujace: number
  zapisane: number
  bledy: BladSkanu[]
  ostatni: OstatniSkan | null
  /** Rozpoznany produkt z ostatniego UDANEGO skanu (dane z serwera). */
  ostatniProdukt: ScanProducedResult | null
  /** Kiedy kolejka ostatnio ruszyła do przodu (przyjęcie do pustej / wynik). */
  postepAt: number
}

export function useKolejkaSkanow(opcje: {
  wyslij: (r: RekordSkanu) => Promise<ScanProducedResult>
  onSukces?: (r: RekordSkanu, wynik: ScanProducedResult) => void
  zegar?: () => number
}) {
  const wyslijRef = useRef(opcje.wyslij)
  wyslijRef.current = opcje.wyslij
  const onSukcesRef = useRef(opcje.onSukces)
  onSukcesRef.current = opcje.onSukces
  const zegar = opcje.zegar ?? Date.now

  const zywy = useRef(false)
  const kolejka = useRef<RekordSkanu[]>([])
  const wTrakcie = useRef(false)
  const nr = useRef(0)
  const [stan, setStan] = useState<StanKolejki>(() => ({
    oczekujace: 0, zapisane: 0, bledy: [], ostatni: null, ostatniProdukt: null, postepAt: zegar(),
  }))

  useEffect(() => {
    zywy.current = true
    return () => { zywy.current = false }
  }, [])

  const dodajBlad = useCallback((kod: string, tytul: string, tekst: string, niepewny: boolean) => {
    const b: BladSkanu = { nr: ++nr.current, kod, tytul, tekst, niepewny }
    setStan(s => ({ ...s, bledy: [b, ...s.bledy], ostatni: { ok: false, kod, tytul, tekst } }))
  }, [])

  const przetworz = useCallback(async () => {
    if (wTrakcie.current) return
    wTrakcie.current = true
    try {
      while (kolejka.current.length && zywy.current) {
        const r = kolejka.current[0]
        try {
          const wynik = await wyslijRef.current(r)
          if (!zywy.current) return
          onSukcesRef.current?.(r, wynik)
          const tekst = [wynik.clientName, wynik.batchNo].filter(Boolean).join(' · ')
          setStan(s => ({
            ...s, zapisane: s.zapisane + 1, ostatniProdukt: wynik,
            ostatni: { ok: true, kod: r.kod, tytul: wynik.onStock === false ? 'Zeskanowano' : 'Na magazynie', tekst, wynik },
          }))
          beepOk()
        } catch (e: any) {
          if (!zywy.current) return
          const o = opiszBladSkanu(e)
          dodajBlad(r.kod, o.tytul, o.tekst, o.niepewny)
          beepErr()
        } finally {
          kolejka.current.shift()
          if (zywy.current) {
            const t = zegar()
            setStan(s => ({ ...s, oczekujace: kolejka.current.length, postepAt: t }))
          }
        }
      }
    } finally {
      wTrakcie.current = false
    }
  }, [dodajBlad]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Kod gotowy z bufora → kolejka. Nie czeka na API. */
  const przyjmij = useCallback((kod: string, planId: string) => {
    if (!zywy.current) return
    const k = kod.trim()
    if (!k) return
    const pusta = kolejka.current.length === 0
    kolejka.current.push({ nr: ++nr.current, kod: k, planId })
    const t = zegar()
    setStan(s => ({ ...s, oczekujace: kolejka.current.length, postepAt: pusta ? t : s.postepAt }))
    void przetworz()
  }, [przetworz]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Skan, który NIE poszedł na serwer (nieczytelny, skaner wstrzymany). */
  const odrzuc = useCallback((kod: string, tytul: string, tekst: string) => {
    if (!zywy.current) return
    dodajBlad(kod, tytul, tekst, false)
    beepErr()
  }, [dodajBlad])

  const wyczyscBledy = useCallback(() => {
    setStan(s => ({ ...s, bledy: [] }))
  }, [])

  /** Synchronicznie: czy są kody nierozliczone (w kolejce albo w locie). */
  const czekaja = useCallback(() => kolejka.current.length > 0 || wTrakcie.current, [])

  return { stan, przyjmij, odrzuc, wyczyscBledy, czekaja }
}
