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
 */
import { useCallback, useEffect, useState } from 'react'
import { errCode, isOfflineError, palletScanApi, type ColdStoragePallet, type ScanResultCode } from '@/lib/api'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from './components/PasSkanowania'
import { Karta } from './components/Karta'
import { grajBlad } from './dzwiek'
import type { PokazAlarm } from './magazynTypes'

export function EkranMrozni({ onAlarm }: { onAlarm: PokazAlarm }) {
  const [lista, setLista] = useState<ColdStoragePallet[]>([])
  const [ostatnia, setOstatnia] = useState<string>('')

  const wczytaj = useCallback(async () => {
    try { setLista(await palletScanApi.inColdStorage()) }
    catch { /* lista jest podglądem — brak sieci nie blokuje skanowania */ }
  }, [])

  useEffect(() => {
    void wczytaj()
    const t = setInterval(() => { void wczytaj() }, 10000)
    return () => clearInterval(t)
  }, [wczytaj])

  async function skanuj(kod: string) {
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

  const kg = lista.reduce((s, p) => s + Number(p.totalKg || 0), 0)
  const posortowane = [...lista].sort((a, b) =>
    String(a.deliveryDate ?? '9999').localeCompare(String(b.deliveryDate ?? '9999')))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
        <div className="flex flex-col gap-3">
          <section className="rounded-2xl p-6" style={{ background: 'var(--accentSoft)', border: '1.5px solid var(--accentLine)' }}>
            <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>W mroźni</div>
            <div className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 88, color: 'var(--accent)' }}>{lista.length}</div>
            <div className="mt-1 text-[15px]" style={{ color: 'var(--mut)' }}>
              palet · {Math.round(kg).toLocaleString('pl-PL')} kg
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
            pełnej palety, gdy wjeżdża do mroźni. Wyjazd zalicza skan na aucie.
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
                  {p.orderNo} · P{p.palletNo}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="hmi-v10-mono block text-[15px] font-bold">{Math.round(p.totalKg)} kg</span>
                <span className="block text-[11.5px]" style={{ color: 'var(--mut)' }}>
                  {p.deliveryDate ? `wydanie ${String(p.deliveryDate).slice(8, 10)}.${String(p.deliveryDate).slice(5, 7)}` : 'bez terminu'}
                </span>
              </span>
            </div>
          ))}
          {!lista.length ? (
            <div className="p-6 text-center text-[14px]" style={{ color: 'var(--mut)' }}>Mroźnia pusta.</div>
          ) : null}
        </Karta>
      </div>

      <PasSkanowania placeholder="Skanuj kartkę palety…" onSkan={skanuj}
        podpis="Skan wstawia paletę do mroźni." />
    </div>
  )
}
