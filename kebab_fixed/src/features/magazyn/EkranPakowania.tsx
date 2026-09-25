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
 * z wózka. Skan ETYKIETY kartonu (SCARTON|… albo kod palety zamówienia)
 * przełącza aktywny karton — bez dotykania ekranu.
 */
import { useState } from 'react'
import { isOfflineError, magazynApi, palletsApi, type OtwartyKarton } from '@/lib/api'
import { czyKompletnyKodPalety } from '@/features/scan/skanKodu'
import { usePakowanie } from './usePakowanie'
import { werdyktPakowania, type Uwaga } from './pakowanieWerdykt'
import { grajBlad, grajInny } from './dzwiek'
import { brakuje, dokadKarton, skladKartonu, opisPozycji } from './opisKartonu'
import { Karta, Znacznik } from './components/Karta'
import { PasSkanowania } from './components/PasSkanowania'
import type { PokazAlarm } from './magazynTypes'

interface Wpis { ts: number; opis: string; gdzie: string; ton: 'cisza' | 'inny' | 'blad' }

export function EkranPakowania({ aktywnyId, onAktywny, onAlarm }: {
  aktywnyId: string | null
  onAktywny: (id: string | null) => void
  onAlarm: PokazAlarm
}) {
  const { kontenery, odswiez } = usePakowanie()
  const [uwaga, setUwaga] = useState<Uwaga | null>(null)
  const [dziennik, setDziennik] = useState<Wpis[]>([])
  const aktywny = kontenery.find(k => k.id === aktywnyId) ?? null
  const pozostale = kontenery.filter(k => k.id !== aktywnyId)

  function zapisz(w: Wpis) { setDziennik(d => [w, ...d].slice(0, 12)) }

  function alarm(naglowek: string, szczegol: string, gdzie?: string) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek, szczegol, ...(gdzie ? { gdzie } : {}) })
  }

  function ustawAktywny(k: OtwartyKarton) {
    onAktywny(k.id)
    setUwaga(null)
  }

  async function skanKartonu(id: string) {
    const k = kontenery.find(x => x.id === id)
    if (k) return ustawAktywny(k)
    await odswiez()
    alarm('TEN KARTON NIE JEST OTWARTY', 'Karton jest już pełny albo zamknięty. Weź kartę innego kartonu.')
  }

  async function skanuj(kod: string) {
    try {
      const karton = /^SCARTON\|(.+)$/i.exec(kod)
      if (karton) return await skanKartonu(karton[1].trim())
      if (czyKompletnyKodPalety(kod)) {
        const p = await palletsApi.lookup(kod)
        return await skanKartonu(String(p?.id ?? ''))
      }

      const w = await magazynApi.skan(kod, aktywnyId)
      const v = werdyktPakowania(w, aktywnyId)
      if (v.aktywny !== aktywnyId) onAktywny(v.aktywny)
      if (v.dzwiek === 'inny') grajInny('L')
      if (v.alarm) { grajBlad('L'); onAlarm(v.alarm) }
      // Cisza zeruje bursztyn — ostatnia sztuka poszła tam, gdzie trzeba.
      setUwaga(v.uwaga)
      zapisz({
        ts: Date.now(),
        opis: w.unit || kod,
        gdzie: w.container ? `karton ${w.container.cartonNo}` : (v.alarm?.naglowek ?? ''),
        ton: v.dzwiek,
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

  const b = aktywny ? brakuje(aktywny) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6"
        style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>

        {/* ── Aktywny karton — czytelny z wózka ─────────────────────── */}
        <div className="flex min-h-0 flex-col gap-3">
          {aktywny ? (
            <section className="flex flex-col gap-2 rounded-2xl p-6"
              style={{ background: 'var(--accentSoft)', border: '1.5px solid var(--accentLine)' }}>
              <div className="flex items-center gap-3">
                <span className="hmi-v10-mono text-[14px] font-bold tracking-[0.06em]" style={{ color: 'var(--mut)' }}>
                  KARTON {aktywny.cartonNo}
                </span>
                <Znacznik ton={aktywny.kind === 'order' ? 'akcja' : 'szary'}>{dokadKarton(aktywny)}</Znacznik>
              </div>
              <div className="font-extrabold leading-none" style={{ fontSize: 'clamp(30px, 3.4vw, 52px)' }}>
                {aktywny.clientName || 'na magazyn'}
              </div>
              <div className="text-[15px]" style={{ color: 'var(--mut)' }}>{skladKartonu(aktywny)}</div>

              <div className="mt-4 flex items-end gap-8">
                <div>
                  <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
                    Brakuje
                  </div>
                  <div className="hmi-v10-mono font-bold leading-none"
                    style={{ fontSize: 'clamp(64px, 8vw, 128px)', color: b ? 'var(--accent)' : 'var(--success)' }}>
                    {b}
                  </div>
                </div>
                <div className="pb-3">
                  <div className="hmi-v10-mono text-[28px] font-bold leading-none">
                    {aktywny.packedQty}<span style={{ color: '#9AA3B0' }}>/{aktywny.targetQty}</span>
                  </div>
                  <div className="mt-1 text-[13px]" style={{ color: 'var(--mut)' }}>sztuk w kartonie</div>
                </div>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full" style={{ background: '#fff' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${aktywny.targetQty ? Math.round(aktywny.packedQty / aktywny.targetQty * 100) : 0}%`,
                           background: 'var(--accent)' }} />
              </div>
            </section>
          ) : (
            <section className="flex flex-col items-start gap-2 rounded-2xl p-6"
              style={{ background: 'var(--panel)', border: '1.5px dashed var(--accentLine)' }}>
              <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--accent)' }}>
                Brak aktywnego kartonu
              </div>
              <div className="text-[30px] font-extrabold leading-tight">Zeskanuj kartę kartonu albo pierwszą sztukę</div>
              <div className="text-[15px]" style={{ color: 'var(--mut)' }}>
                System sam wie, gdzie sztuka należy — aktywny karton służy tylko temu, żeby panel mógł milczeć.
              </div>
            </section>
          )}

          {aktywny && aktywny.lines.length > 1 ? (
            <Karta tytul="Skład kartonu" tresc={false}>
              {aktywny.lines.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined,
                           background: p.packedQty >= p.targetQty ? 'var(--successSoft)' : undefined }}>
                  <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{opisPozycji(p)}</span>
                  <span className="hmi-v10-mono text-[15px] font-bold">{p.packedQty}/{p.targetQty}</span>
                </div>
              ))}
            </Karta>
          ) : null}

          <Karta tytul="Ostatnie skany" className="flex-1" tresc={false}
            prawo={<span>w tej sesji · {dziennik.length}</span>}>
            {dziennik.map((w, i) => (
              <div key={`${w.ts}-${i}`} className="flex items-center gap-3 px-4 py-2"
                style={{ borderTop: '1px solid var(--lineSoft)' }}>
                <span className="hmi-v10-mono shrink-0 text-[12px]" style={{ color: 'var(--mut)' }}>
                  {new Date(w.ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{w.opis}</span>
                <span className="shrink-0 text-[12.5px] font-bold"
                  style={{ color: w.ton === 'blad' ? 'var(--red)' : w.ton === 'inny' ? 'var(--amb)' : 'var(--success)' }}>
                  {w.gdzie}
                </span>
              </div>
            ))}
            {!dziennik.length ? (
              <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Jeszcze nic nie zeskanowano.</div>
            ) : null}
          </Karta>
        </div>

        {/* ── Werdykt ostatniego skanu + pozostałe kartony ───────────── */}
        <div className="flex min-h-0 flex-col gap-3">
          {uwaga ? (
            <div role="status" className="flex items-start gap-3 rounded-xl px-5 py-4"
              style={{ background: 'var(--ambSoft)', border: '2px solid var(--ambLine)' }}>
              <span className="text-[26px] font-extrabold leading-none" style={{ color: 'var(--amb)' }}>!</span>
              <span>
                <span className="block text-[18px] font-extrabold leading-tight" style={{ color: 'var(--amb)' }}>
                  {uwaga.naglowek}
                </span>
                <span className="mt-1 block text-[14.5px]" style={{ color: '#92400E' }}>{uwaga.szczegol}</span>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl px-5 py-4 text-[14.5px] font-bold"
              style={{ background: 'var(--successSoft)', border: '1px dashed var(--successLine)', color: '#166534' }}>
              ✓ Cisza — sztuki idą tam, gdzie trzeba
            </div>
          )}

          <Karta tytul="Pozostałe otwarte kartony" tresc={false} className="flex-1"
            prawo={<span>dotknij, żeby przełączyć</span>}>
            {pozostale.map(k => (
              <button key={k.id} type="button" onClick={() => ustawAktywny(k)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--accentSoft)]"
                style={{ borderTop: '1px solid var(--lineSoft)', color: 'var(--ink)' }}>
                <span className="hmi-v10-mono shrink-0 text-[12.5px] font-bold" style={{ color: 'var(--mut)', width: 58 }}>
                  {k.cartonNo}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold">{k.clientName || 'na magazyn'}</span>
                  <span className="block truncate text-[12px]" style={{ color: 'var(--mut)' }}>{skladKartonu(k)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="hmi-v10-mono block text-[16px] font-bold">{k.packedQty}/{k.targetQty}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--mut)' }}>brakuje {brakuje(k)}</span>
                </span>
              </button>
            ))}
            {!pozostale.length ? (
              <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Brak innych otwartych kartonów.</div>
            ) : null}
          </Karta>

          <div className="shrink-0 rounded-xl px-4 py-3 text-[12.5px] leading-relaxed"
            style={{ background: 'var(--panel)', border: '1px dashed var(--line)', color: 'var(--mut)' }}>
            Sztuka z <b style={{ color: 'var(--ink)' }}>innego</b> otwartego kartonu nie jest odrzucana —
            system zapisuje ją tam, gdzie należy, i mówi gdzie. Nikt nigdzie nie wraca skanem.
          </div>
        </div>
      </div>

      <PasSkanowania placeholder="Skanuj sztukę albo kartę kartonu…" onSkan={skanuj}
        podpis="Pasuje — cisza. Inny karton — krótki ton. Nie pasuje — alarm." />
    </div>
  )
}
