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
import { errCode, isOfflineError, magazynApi, palletScanApi, type ColdStoragePallet, type KartonDoWazenia, type PaletaMrozni, type ScanResultCode, type WazenieMrozni } from '@/lib/api'
import { idKartonu } from '@/features/scan/skanKodu'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from './components/PasSkanowania'
import { StanPolaczenia } from './components/StanPolaczenia'
import { Karta } from './components/Karta'
import { grajBlad } from './dzwiek'
import { WazenieKartonu } from './WazenieKartonu'
import { drukujEtykieteWagi } from './drukEtykietyWagi'
import { kgPl, roznicaPl } from './wazenieMrozni'
import type { PokazAlarm } from './magazynTypes'

export function EkranMrozni({ onAlarm, onOtworzKarton }: {
  onAlarm: PokazAlarm
  /** Kartka kartonu w trakcie pakowania → pakowanie TEGO kartonu (29.09.2026). */
  onOtworzKarton?: (id: string) => void
}) {
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
      const [p, k] = await Promise.all([palletScanApi.inColdStorage(), magazynApi.mrozniaKartony()])
      setLista(p); setKartony(Array.isArray(k) ? k : [])
      setBlad(false); setAktualizacja(new Date())
    } catch { setBlad(true) }
  }, [])

  useEffect(() => {
    void wczytaj()
    const t = setInterval(() => { void wczytaj() }, 10000)
    return () => clearInterval(t)
  }, [wczytaj])

  async function skanuj(kod: string) {
    const karton = idKartonu(kod)
    try {
      if (await otworzWazenie(karton ? `SCARTON|${karton}` : kod)) return
    } catch (e) {
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'SKAN NIE ZAPISANY',
        szczegol: isOfflineError(e) ? 'Brak połączenia — spróbuj za chwilę.' : e instanceof Error ? e.message : 'Spróbuj ponownie.' })
      return
    }
    if (karton) {
      try {
        // Postać kanoniczna — kartka zeskanowana z CapsLockiem też wjeżdża.
        const w = await magazynApi.mrozniaKarton(`SCARTON|${karton}`)
        if (w.result === 'SUCCESS' || w.result === 'ALREADY_SCANNED') {
          setOstatnia(`Karton ${w.cartonNo ?? ''} · ${w.clientName ?? ''}`)
        } else {
          grajBlad('L')
          onAlarm({ skaner: 'L', ton: 'blad',
            naglowek: w.result === 'NOT_FULL' ? 'KARTON NIE JEST PEŁNY' : 'NIEZNANY KARTON',
            szczegol: w.result === 'NOT_FULL'
              ? 'Do mroźni wjeżdża karton spakowany do końca. Dopakuj go na kaflu KARTONY.'
              : 'Zeskanuj kartę kartonu jeszcze raz.' })
        }
      } catch (e) {
        grajBlad('L')
        onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'SKAN NIE ZAPISANY',
          szczegol: isOfflineError(e) ? 'Brak połączenia — spróbuj za chwilę.' : e instanceof Error ? e.message : 'Sprawdź stan kartonu.' })
      }
      return void wczytaj()
    }
    try {
      const w = await palletScanApi.scan(kod, 'cold_storage')
      if (w.result !== 'SUCCESS') {
        const k = komunikatSkanu(w.result, { palletNo: w.palletNo })
        grajBlad('L')
        onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
      } else {
        setOstatnia(`${w.order.clientName} · P${w.palletNo} · ${Math.round(w.totalKg)} kg`)
      }
    } catch (e) {
      const kod2 = (isOfflineError(e) ? 'OFFLINE' : (errCode(e) || 'ERROR')) as ScanResultCode | 'OFFLINE'
      const k = komunikatSkanu(kod2, { wiadomosc: e instanceof Error ? e.message : undefined })
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
    }
    await wczytaj()
  }

  const kg = lista.reduce((s, p) => s + Number(p.totalKg || 0), 0) + kartony.reduce((s, k) => s + k.kg, 0)
  const posortowane = [...lista].sort((a, b) =>
    String(a.deliveryDate ?? '9999').localeCompare(String(b.deliveryDate ?? '9999')))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StanPolaczenia blad={blad} aktualizacja={aktualizacja} ladowanie={!aktualizacja && !blad} />
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
        <div className="flex flex-col gap-3">
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
              ✓ Wstawiona: {ostatnia}
            </div>
          ) : null}
          <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: 'var(--panel)', border: '1px dashed var(--line)', color: 'var(--mut)' }}>
            <b style={{ color: 'var(--ink)' }}>Mroźnia łączy pakowanie z załadunkiem.</b> Zeskanuj kartkę
            pełnej palety albo kartę pełnego kartonu, gdy wjeżdża do mroźni. Wyjazd zalicza skan na aucie.
          </div>
        </div>

        <Karta tytul="Stoi w mroźni" tresc={false} prawo={<span>najbliższy termin wydania u góry</span>}>
          {posortowane.map(p => (
            <div key={p.palletId} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--lineSoft)' }}>
              <span className="grid shrink-0 place-items-center rounded-full text-[14px]"
                style={{ width: 34, height: 34, background: '#fff', border: '2px solid var(--accentLine)', color: 'var(--accent)' }}>❄</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-extrabold">{p.clientName}</span>
                <span className="hmi-v10-mono block truncate text-[12px]" style={{ color: 'var(--mut)' }}>
                  {p.orderNo} · {p.cartonNo ? `Karton ${p.cartonNo}` : `P${p.palletNo}`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="hmi-v10-mono block text-[15px] font-bold">{Math.round(p.totalKg)} kg</span>
                <span className="block text-[11.5px]" style={{ color: 'var(--mut)' }}>
                  {p.deliveryDate ? `wydanie ${String(p.deliveryDate).slice(8, 10)}.${String(p.deliveryDate).slice(5, 7)}` : 'bez terminu'}
                </span>
              </span>
              <PrzyciskiWagi onDodruk={() => void dodruk(p.palletId)}
                onZwaz={() => void zwazPonownie(`PAL|${p.orderId}|${p.palletNo}`)} />
            </div>
          ))}
          {kartony.map(k => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--lineSoft)' }}>
              <span className="grid shrink-0 place-items-center rounded-full text-[14px]"
                style={{ width: 34, height: 34, background: '#fff', border: '2px solid var(--accentLine)', color: 'var(--accent)' }}>❄</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-extrabold">{k.clientName || 'na magazyn'}</span>
                <span className="hmi-v10-mono block truncate text-[12px]" style={{ color: 'var(--mut)' }}>
                  karton {k.cartonNo} · magazyn · {k.packedQty} szt
                </span>
              </span>
              <span className="hmi-v10-mono shrink-0 text-[15px] font-bold">{Math.round(k.kg)} kg</span>
              <PrzyciskiWagi onDodruk={() => void dodruk(k.id)} onZwaz={() => void zwazPonownie(`SCARTON|${k.id}`)} />
            </div>
          ))}
          {!blad && aktualizacja && !lista.length && !kartony.length ? (
            <div className="p-6 text-center text-[14px]" style={{ color: 'var(--mut)' }}>Mroźnia pusta.</div>
          ) : null}
        </Karta>
      </div>

      <PasSkanowania placeholder="Skanuj kartkę palety…" onSkan={skanuj} disabled={!!doWazenia}
        podpis="Pełny karton: skan → paleta → waga → etykieta → mroźnia." />

      {doWazenia ? (
        <WazenieKartonu karton={doWazenia} palety={palety} onGotowe={poWazeniu}
          onAnuluj={() => setDoWazenia(null)} />
      ) : null}
    </div>
  )
}

function PrzyciskiWagi({ onDodruk, onZwaz }: { onDodruk: () => void; onZwaz: () => void }) {
  const styl = { border: '1px solid var(--line)', color: 'var(--ink)' }
  return (
    <span className="flex shrink-0 gap-1.5">
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold" style={styl} onClick={onZwaz}>Zważ</button>
      <button type="button" className="rounded-lg px-2.5 py-1.5 text-[12px] font-bold" style={styl} onClick={onDodruk}>Etykieta</button>
    </span>
  )
}
