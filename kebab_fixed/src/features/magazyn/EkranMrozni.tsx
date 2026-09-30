/**
 * MROŹNIA — przegub procesu magazynowego (spec §6).
 *
 * Karton pełny → skan → wjazd do mroźni → czeka (dniami) → skan → wyjazd na
 * auto. Dlatego kartony pod załadunek są dawno przygotowane, a pakowacz robi
 * INNE zamówienia niż te, które właśnie jadą.
 *
 * Tu wstawia się paletę do mroźni jednym skanem kartki. Wyjęcie dzieje się
 * przy załadunku — skan na aucie zabiera paletę z mroźni, a pomyłkę cofa
 * przycisk „Cofnij" na ekranie załadunku. Udany skan = cisza.
 *
 * WAŻENIE (29.09.2026): PEŁNY karton (sztuki zeskanowane do końca) przed
 * wjazdem idzie na wagę — skan otwiera `WazenieKartonu`, a wjazd zapisuje
 * dopiero zatwierdzenie ważenia (z etykietą). Niepełny i rozpisana paleta
 * bez sztuk idą starą ścieżką — nie ma z czym porównać wagi.
 */
import { useCallback, useEffect, useState } from 'react'
import { isOfflineError, magazynApi, palletScanApi, type ColdStoragePallet, type KartonDoWazenia, type PaletaMrozni, type WazenieMrozni, type WazenieWMrozni } from '@/lib/api'
import { idKartonu } from '@/features/scan/skanKodu'
import { PasSkanowania } from './components/PasSkanowania'
import { StanPolaczenia } from './components/StanPolaczenia'
import { Karta } from './components/Karta'
import { grajBlad } from './dzwiek'
import { WazenieKartonu } from './WazenieKartonu'
import { drukujEtykieteWagi } from './drukEtykietyWagi'
import { dataGodzina } from './etykietaWagiZpl'
import { kgPl, roznicaPl } from './wazenieMrozni'
import type { PokazAlarm } from './magazynTypes'

/** Co robi skan na tym ekranie. Właściciel 29.09.2026: operator WYBIERA —
 *  wjazd (z ważeniem) albo wyjazd (karton wraca do pakowania na poprawki). */
export type TrybMrozni = 'wjazd' | 'wyjazd'

export function EkranMrozni({ onAlarm, onOtworzKarton, onKartaKartonu, zablokowany = false }: {
  onAlarm: PokazAlarm
  /** Kartka kartonu w trakcie pakowania → pakowanie TEGO kartonu (29.09.2026). */
  onOtworzKarton?: (id: string) => void
  /** Karton gotowy (w mroźni, na aucie) → karta kartonu zamiast błędu. */
  onKartaKartonu?: (kod: string) => void
  /** Nad ekranem otwarta karta kartonu — skaner tu nic nie robi. */
  zablokowany?: boolean
}) {
  const [tryb, setTryb] = useState<TrybMrozni | null>(null)
  const [wazenia, setWazenia] = useState<Awaited<ReturnType<typeof magazynApi.mrozniaWazenia>>>({})
  const [lista, setLista] = useState<ColdStoragePallet[]>([])
  // Kartony magazynowe (bez zamówienia) — w mroźni od 25.09.2026.
  const [kartony, setKartony] = useState<Awaited<ReturnType<typeof magazynApi.mrozniaKartony>>>([])
  const [ostatnia, setOstatnia] = useState<string>('')
  const [blad, setBlad] = useState(false)
  const [aktualizacja, setAktualizacja] = useState<Date | null>(null)
  const [palety, setPalety] = useState<PaletaMrozni[]>([])
  const [doWazenia, setDoWazenia] = useState<KartonDoWazenia | null>(null)

  useEffect(() => {
    magazynApi.paletyMrozni().then(p => setPalety(Array.isArray(p) ? p : [])).catch(() => { /* ponowi przy ważeniu */ })
  }, [])

  /** Pełny karton → nakładka ważenia. Zwraca true, gdy ważenie przejęło skan. */
  async function otworzWazenie(kod: string, wymus = false): Promise<boolean> {
    const k = await magazynApi.mrozniaSprawdz(kod)
    // Właściciel 29.09.2026: kartka kartonu otwiera karton z KAŻDEGO ekranu.
    // Niedopakowany nie ma czego szukać w mroźni — idzie do pakowania.
    if (!wymus && k.result === 'OK' && k.open && k.id && onOtworzKarton) {
      onOtworzKarton(k.id)
      return true
    }
    if (k.result !== 'OK' || !k.full || (k.inColdStorage && !wymus)) return false
    let lista = palety
    if (!lista.length) {
      lista = await magazynApi.paletyMrozni().catch(() => [])
      setPalety(lista)
    }
    if (!lista.length) {
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'BRAK LISTY PALET',
        szczegol: 'Nie udało się pobrać tar palet — sprawdź połączenie i zeskanuj ponownie.' })
      return true
    }
    setDoWazenia(k)
    return true
  }

  function poWazeniu(w: WazenieMrozni, bladDruku: string | null) {
    setDoWazenia(null)
    setOstatnia(`Karton ${w.cartonNo} · ${w.clientName || 'magazyn'} · ${kgPl(w.grossKg)} kg brutto · ${w.ok ? 'ZGODNA' : 'NIEZGODNA'}`)
    if (bladDruku) {
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'ETYKIETA NIE WYDRUKOWANA',
        szczegol: `Ważenie zapisane, karton w mroźni. ${bladDruku} Dodrukuj z listy „Stoi w mroźni”.` })
    } else if (!w.ok) {
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: `WAGA NIEZGODNA ${roznicaPl(w.diffKg)}`,
        szczegol: `Karton ${w.cartonNo} wjechał do mroźni z etykietą NIEZGODNA. Sprawdź zawartość.` })
    }
    void wczytaj()
  }

  async function dodruk(containerId: string) {
    try {
      const w = await magazynApi.mrozniaOstatnieWazenie(containerId)
      const b = await drukujEtykieteWagi(w)
      if (b) onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'ETYKIETA NIE WYDRUKOWANA', szczegol: b })
    } catch {
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'KARTON NIE BYŁ WAŻONY',
        szczegol: 'Użyj „Zważ”, żeby zważyć go teraz i wydrukować etykietę.' })
    }
  }

  async function zwazPonownie(kod: string) {
    try {
      if (!(await otworzWazenie(kod, true))) {
        onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'TEGO KARTONU NIE ZWAŻYSZ',
          szczegol: 'Sztuki nie były skanowane do kartonu — nie ma z czym porównać wagi.' })
      }
    } catch (e) {
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'BRAK POŁĄCZENIA',
        szczegol: isOfflineError(e) ? 'Spróbuj za chwilę.' : e instanceof Error ? e.message : '' })
    }
  }

  const wczytaj = useCallback(async () => {
    try {
      const [p, k, w] = await Promise.all([palletScanApi.inColdStorage(), magazynApi.mrozniaKartony(),
        magazynApi.mrozniaWazenia().catch(() => ({}))])
      setLista(p); setKartony(Array.isArray(k) ? k : []); setWazenia(w && typeof w === 'object' ? (w as typeof wazenia) : {})
      setBlad(false); setAktualizacja(new Date())
    } catch { setBlad(true) }
  }, [])

  useEffect(() => {
    void wczytaj()
    const t = setInterval(() => { void wczytaj() }, 10000)
    return () => clearInterval(t)
  }, [wczytaj])

  function alarmBlad(naglowek: string, szczegol: string) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol })
  }

  function alarmSieci(e: unknown) {
    alarmBlad('SKAN NIE ZAPISANY',
      isOfflineError(e) ? 'Brak połączenia — spróbuj za chwilę.' : e instanceof Error ? e.message : 'Spróbuj ponownie.')
  }

  /** Wjazd BEZ ważenia: „Zważ później" albo rozpisana paleta bez sztuk. */
  async function wstawBezWazenia(k: KartonDoWazenia): Promise<boolean> {
    if (!k.code) return false
    try {
      if (k.kind === 'stock') {
        const w = await magazynApi.mrozniaKarton(k.code)
        if (w.result !== 'SUCCESS' && w.result !== 'ALREADY_SCANNED') {
          alarmBlad(w.result === 'NOT_FULL' ? 'KARTON NIE JEST PEŁNY' : 'KARTON NIE WJECHAŁ',
            w.result === 'NOT_FULL' ? 'Do mroźni wjeżdża karton spakowany do końca. Dopakuj go na kaflu KARTONY.'
              : 'Zeskanuj kartkę kartonu jeszcze raz.')
          return false
        }
      } else {
        const w = await palletScanApi.scan(k.code, 'cold_storage')
        if (w.result !== 'SUCCESS' && w.result !== 'ALREADY_SCANNED') {
          alarmBlad('KARTON NIE WJECHAŁ', 'Zeskanuj kartkę jeszcze raz albo zawołaj biuro.')
          return false
        }
      }
      return true
    } catch (e) {
      alarmSieci(e)
      return false
    } finally {
      void wczytaj()
    }
  }

  async function wyjedz(k: KartonDoWazenia) {
    try {
      const w = await magazynApi.mrozniaWyjazd(k.code ?? '')
      if (w.result === 'SUCCESS') {
        setOstatnia(`Wyjechał: karton ${w.cartonNo ?? ''} · ${w.clientName || 'magazyn'} — do poprawek`)
      } else {
        alarmBlad(w.result === 'GONE' ? 'KARTON JEST NA AUCIE' : 'KARTONU NIE MA W MROŹNI',
          w.result === 'GONE' ? 'Zdejmij go z auta na ekranie załadunku.' : 'Nic nie zmieniono.')
      }
    } catch (e) { alarmSieci(e) }
    void wczytaj()
  }

  async function skanuj(kod: string) {
    if (!tryb) {
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'WYBIERZ: WJAZD CZY WYJAZD',
        szczegol: 'Dotknij „Wjedź do mroźni" albo „Wyjedź z mroźni" i zeskanuj kartkę jeszcze raz.' })
      return
    }
    const karton = idKartonu(kod)
    const kanon = karton ? `SCARTON|${karton}` : kod
    let k: KartonDoWazenia
    try {
      k = await magazynApi.mrozniaSprawdz(kanon)
    } catch (e) { return alarmSieci(e) }
    if (k.result === 'INVALID') {
      return alarmBlad('NIEZNANA KARTKA', 'Tej kartki nie ma w systemie. Weź kartkę z kartonu albo zawołaj biuro.')
    }

    if (tryb === 'wyjazd') {
      if (k.status === 'cold_storage') return void wyjedz(k)
      // Nie stoi w mroźni — pokazujemy, gdzie jest, zamiast błędu.
      if (onKartaKartonu) return onKartaKartonu(kanon)
      return alarmBlad('KARTONU NIE MA W MROŹNI', 'Nic nie zmieniono.')
    }

    // WJAZD
    switch (k.status) {
      case 'full':
        return void otworzWazenie(kanon)
      case 'packing':
        if (onOtworzKarton && k.id) return onOtworzKarton(k.id)
        return alarmBlad('KARTON NIE JEST PEŁNY', 'Do mroźni wjeżdża karton spakowany do końca. Dopakuj go na kaflu KARTONY.')
      case 'planned':
        // Rozpisana paleta bez skanu sztuk — nie ma czego ważyć (decyzja 09.09).
        if (await wstawBezWazenia(k)) setOstatnia(`${k.clientName} · karton ${k.cartonNo} (bez skanu sztuk)`)
        return
      default:
        // W mroźni / na aucie / wydany — karta kartonu, nie czerwony ekran.
        if (onKartaKartonu) return onKartaKartonu(kanon)
        return alarmBlad(k.status === 'cold_storage' ? 'KARTON JUŻ JEST W MROŹNI' : 'KARTON JEST NA AUCIE', 'Nic nie zmieniono.')
    }
  }

  async function zwazPozniej(k: KartonDoWazenia) {
    setDoWazenia(null)
    if (await wstawBezWazenia(k)) {
      setOstatnia(`Karton ${k.cartonNo} · ${k.clientName || 'magazyn'} — DO ZWAŻENIA`)
    }
  }

  const kg = lista.reduce((s, p) => s + Number(p.totalKg || 0), 0) + kartony.reduce((s, k) => s + k.kg, 0)
  const posortowane = [...lista].sort((a, b) =>
    String(a.deliveryDate ?? '9999').localeCompare(String(b.deliveryDate ?? '9999')))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StanPolaczenia blad={blad} aktualizacja={aktualizacja} ladowanie={!aktualizacja && !blad} />
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {([['wjazd', '❄ Wjedź do mroźni'], ['wyjazd', '↩ Wyjedź z mroźni']] as const).map(([t, napis]) => (
              <button key={t} type="button" aria-pressed={tryb === t} onClick={() => setTryb(t)}
                className="rounded-2xl px-3 py-5 text-[17px] font-extrabold leading-tight"
                style={{
                  background: tryb === t ? 'var(--accent)' : 'var(--panel)',
                  color: tryb === t ? '#fff' : 'var(--ink)',
                  border: `2px solid ${tryb === t ? 'var(--accent)' : 'var(--line)'}`,
                }}>{napis}</button>
            ))}
          </div>
          <section className="rounded-2xl p-6" style={{ background: 'var(--accentSoft)', border: '1.5px solid var(--accentLine)' }}>
            <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>W mroźni</div>
            <div className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 88, color: 'var(--accent)' }}>{lista.length + kartony.length}</div>
            <div className="mt-1 text-[15px]" style={{ color: 'var(--mut)' }}>
              palet i kartonów · {Math.round(kg).toLocaleString('pl-PL')} kg
            </div>
          </section>
          {ostatnia ? (
            <div className="rounded-xl px-4 py-3 text-[14px] font-bold"
              style={{ background: 'var(--successSoft)', border: '1px dashed var(--successLine)', color: '#166534' }}>
              {ostatnia}
            </div>
          ) : null}
          <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: 'var(--panel)', border: '1px dashed var(--line)', color: 'var(--mut)' }}>
            <b style={{ color: 'var(--ink)' }}>{tryb === 'wyjazd' ? 'Wyjazd na poprawki.' : tryb === 'wjazd' ? 'Wjazd z ważeniem.' : 'Wybierz, co robisz.'}</b>{' '}
            {tryb === 'wyjazd'
              ? 'Zeskanuj kartkę kartonu — wróci do pakowania. Do mroźni wjedzie znowu z ważeniem.'
              : tryb === 'wjazd'
                ? 'Zeskanuj kartkę pełnego kartonu i wjedź nim na wagę. Karton na aucie wyjeżdża skanem załadunku.'
                : 'Wjazd — pełny karton na wagę i do mroźni. Wyjazd — karton wraca do pakowania.'}
          </div>
        </div>

        <Karta tytul="Stoi w mroźni" tresc={false} prawo={<span>najbliższy termin wydania u góry</span>}>
          {posortowane.map(p => (
            <WierszMrozni key={p.palletId}
              klient={p.clientName}
              opis={`${p.orderNo} · ${p.cartonNo ? `karton ${p.cartonNo}` : `P${p.palletNo}`}`}
              kg={p.totalKg}
              termin={p.deliveryDate ? `wydanie ${String(p.deliveryDate).slice(8, 10)}.${String(p.deliveryDate).slice(5, 7)}` : 'bez terminu'}
              pelnosc={pelnoscPalety(p.scannedQty, p.totalQty)}
              w={wazenia[p.palletId]}
              onDodruk={() => void dodruk(p.palletId)}
              onZwaz={() => void zwazPonownie(`PAL|${p.orderId}|${p.palletNo}`)}
              onWyjazd={() => void wyjedz({ result: 'OK', code: `PAL|${p.orderId}|${p.palletNo}` })} />
          ))}
          {kartony.map(k => (
            <WierszMrozni key={k.id}
              klient={k.clientName || 'na magazyn'}
              opis={`karton ${k.cartonNo} · magazyn`}
              kg={k.kg}
              termin="na magazyn"
              pelnosc={k.full === false || (k.targetQty && k.packedQty < k.targetQty)
                ? { pelny: false, t: `NIEPEŁNY ${k.packedQty}/${k.targetQty || '?'} szt` }
                : { pelny: true, t: `PEŁNY ${k.packedQty}${k.targetQty ? `/${k.targetQty}` : ''} szt` }}
              w={wazenia[k.id]}
              onDodruk={() => void dodruk(k.id)}
              onZwaz={() => void zwazPonownie(`SCARTON|${k.id}`)}
              onWyjazd={() => void wyjedz({ result: 'OK', code: `SCARTON|${k.id}` })} />
          ))}
          {!blad && aktualizacja && !lista.length && !kartony.length ? (
            <div className="p-6 text-center text-[14px]" style={{ color: 'var(--mut)' }}>Mroźnia pusta.</div>
          ) : null}
        </Karta>
      </div>

      <PasSkanowania placeholder="Skanuj kartkę palety…" onSkan={skanuj} disabled={!!doWazenia || zablokowany}
        podpis={tryb === 'wyjazd' ? 'Skan kartki: karton WYJEŻDŻA z mroźni do pakowania.'
          : tryb === 'wjazd' ? 'Skan kartki: pełny karton → waga → etykieta → mroźnia.'
            : 'Najpierw wybierz: wjazd albo wyjazd.'} />

      {doWazenia ? (
        <WazenieKartonu karton={doWazenia} palety={palety} onGotowe={poWazeniu}
          onAnuluj={() => setDoWazenia(null)}
          onPozniej={doWazenia.inColdStorage ? undefined : () => void zwazPozniej(doWazenia)} />
      ) : null}
    </div>
  )
}

/** Pełność palety zamówienia: zeskanowane sztuki wobec rozpisu. Rozpisana
 *  bez skanu sztuk (decyzja 09.09) nie jest „pełna" — nikt jej nie liczył. */
export function pelnoscPalety(zeskanowane: number, rozpis: number): { pelny: boolean; t: string } {
  if (!zeskanowane) return { pelny: false, t: `BEZ SKANU SZTUK · ${rozpis} szt rozpis` }
  if (rozpis && zeskanowane < rozpis) return { pelny: false, t: `NIEPEŁNY ${zeskanowane}/${rozpis} szt` }
  return { pelny: true, t: `PEŁNY ${zeskanowane}${rozpis ? `/${rozpis}` : ''} szt` }
}

/** Wiersz listy „Stoi w mroźni" (właściciel 30.09.2026): pełny karton na
 *  zielono, niepełny na szaro, a przy każdym wprost — zważony czy nie,
 *  kiedy i kto. */
function WierszMrozni({ klient, opis, kg, termin, pelnosc, w, onDodruk, onZwaz, onWyjazd }: {
  klient: string
  opis: string
  kg: number
  termin: string
  pelnosc: { pelny: boolean; t: string }
  w?: WazenieWMrozni
  onDodruk: () => void
  onZwaz: () => void
  onWyjazd: () => void
}) {
  const { pelny } = pelnosc
  return (
    <div data-testid="wiersz-mrozni" data-pelny={pelny ? '1' : '0'} className="flex items-center gap-3 px-4 py-3"
      style={{
        borderTop: '1px solid var(--lineSoft)',
        borderLeft: `6px solid ${pelny ? 'var(--success)' : 'var(--line)'}`,
        background: pelny ? 'var(--successSoft)' : 'var(--bg)',
      }}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-extrabold" style={{ color: pelny ? 'var(--ink)' : 'var(--mut)' }}>{klient}</span>
        <span className="hmi-v10-mono block truncate text-[12px]" style={{ color: 'var(--mut)' }}>{opis}</span>
        <span className="mt-1 inline-block rounded-md px-2 py-0.5 text-[11.5px] font-extrabold uppercase"
          style={pelny
            ? { background: 'var(--panel)', color: '#166534', border: '1px solid var(--successLine)' }
            : { background: 'var(--panel)', color: 'var(--mut)', border: '1px solid var(--line)' }}>
          {pelny ? '✓ ' : ''}{pelnosc.t}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="hmi-v10-mono block text-[15px] font-bold">{Math.round(kg)} kg</span>
        <span className="block text-[11.5px]" style={{ color: 'var(--mut)' }}>{termin}</span>
      </span>
      <ZnacznikWagi w={w} />
      <PrzyciskiWagi onDodruk={onDodruk} onZwaz={onZwaz} onWyjazd={onWyjazd} />
    </div>
  )
}

/** Czy karton w mroźni był ważony — „nie zważony" po „Zważ później". */
function ZnacznikWagi({ w }: { w?: WazenieWMrozni }) {
  const [t, kolor, tlo] = !w ? ['NIE ZWAŻONY', '#92400e', 'var(--ambSoft)']
    : w.ok ? ['✓ ZWAŻONY', '#166534', 'var(--panel)'] : ['WAGA NIEZGODNA', '#991b1b', 'var(--redSoft)']
  const kiedy = w?.weighedAt ? dataGodzina(w.weighedAt).slice(0, 5) + ' ' + dataGodzina(w.weighedAt).slice(-5) : ''
  return (
    <span className="w-[150px] shrink-0 rounded-lg px-2.5 py-1.5 text-center"
      style={{ color: kolor, border: `1.5px solid ${kolor}`, background: tlo }}>
      <span className="block text-[12px] font-extrabold uppercase leading-tight">{t}</span>
      {w ? (
        <span className="hmi-v10-mono block truncate text-[11px] font-bold leading-tight" style={{ color: 'var(--mut)' }}>
          {[kiedy, w.operator].filter(Boolean).join(' · ') || `${kgPl(w.grossKg)} kg`}
        </span>
      ) : null}
    </span>
  )
}

function PrzyciskiWagi({ onDodruk, onZwaz, onWyjazd }: { onDodruk: () => void; onZwaz: () => void; onWyjazd: () => void }) {
  const styl = { border: '1px solid var(--line)', color: 'var(--ink)' }
  return (
    <span className="flex shrink-0 gap-1.5">
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold" style={styl} onClick={onWyjazd}>Wyjedź</button>
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold" style={styl} onClick={onZwaz}>Zważ</button>
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold" style={styl} onClick={onDodruk}>Etykieta</button>
    </span>
  )
}
