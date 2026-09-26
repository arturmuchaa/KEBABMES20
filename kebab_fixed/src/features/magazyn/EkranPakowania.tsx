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
 *
 * PEŁNY KARTON NIE ZNIKA (właściciel 25.09.2026): robi się zielony
 * z poleceniem „zeskanuj kartkę i wjedź do mroźni". Skan kartki pełnej palety
 * albo kartonu magazynowego od razu wstawia go do mroźni — to ten sam ruch,
 * który i tak trzeba zrobić. Po wjeździe karton ZNIKA z pakowania i jest
 * widoczny już tylko na kaflu MROŹNIA — nie zaśmieca widoku magazynierom.
 */
import { useEffect, useRef, useState } from 'react'
import { isOfflineError, magazynApi, palletScanApi, palletsApi, type OtwartyKarton } from '@/lib/api'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { czyKompletnyKodPalety, idKartonu } from '@/features/scan/skanKodu'
import { usePakowanie } from './usePakowanie'
import { werdyktPakowania, type Uwaga } from './pakowanieWerdykt'
import { grajBlad, grajInny } from './dzwiek'
import { brakuje, dokadKarton, skladKartonu, opisPozycji } from './opisKartonu'
import { kgTxt } from './pula'
import { Karta, Znacznik } from './components/Karta'
import { PasSkanowania } from './components/PasSkanowania'
import { StanPolaczenia } from './components/StanPolaczenia'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import type { PokazAlarm } from './magazynTypes'

interface Wpis { ts: number; opis: string; gdzie: string; ton: 'cisza' | 'inny' | 'blad'; kod?: string; containerId?: string }

export function EkranPakowania({ aktywnyId, onAktywny, onAlarm, pierwszySkan, onPierwszySkan }: {
  aktywnyId: string | null
  onAktywny: (id: string | null) => void
  onAlarm: PokazAlarm
  /** Sztuka zeskanowana jeszcze na menu — przyjmujemy ją od razu po wejściu. */
  pierwszySkan?: string | null
  onPierwszySkan?: () => void
}) {
  const { kontenery, spakowane, odswiez, blad, aktualizacja, ladowanie } = usePakowanie()
  const [korekta, setKorekta] = useState<Wpis | null>(null)
  const [cofa, setCofa] = useState(false)
  const [skanuje, setSkanuje] = useState(false)
  const [uwaga, setUwaga] = useState<Uwaga | null>(null)
  const [wMrozni, setWMrozni] = useState<string | null>(null)
  const [dziennik, setDziennik] = useState<Wpis[]>([])
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

  function ustawAktywny(k: OtwartyKarton) {
    onAktywny(k.id)
    setUwaga(null)
  }

  async function skanKartonu(id: string, kod: string) {
    const k = kontenery.find(x => x.id === id)
    if (k) { setWMrozni(null); return ustawAktywny(k) }
    const p = spakowane.find(x => x.id === id)
    if (p) {
      // Kartka pełnego kartonu = „wjeżdżam do mroźni". Ta sama akcja co na
      // kaflu MROŹNIA, więc ta sama ścieżka backendu i te same kody wyniku.
      if (p.kind === 'order') {
        const w = await palletScanApi.scan(kod, 'cold_storage')
        if (w.result !== 'SUCCESS') {
          const m = komunikatSkanu(w.result, { palletNo: w.palletNo })
          return alarm(m.naglowek, m.szczegol)
        }
      } else {
        const w = await magazynApi.mrozniaKarton(kod)
        if (w.result !== 'SUCCESS' && w.result !== 'ALREADY_SCANNED') {
          return alarm('KARTON NIE WSZEDŁ DO MROŹNI', 'Zeskanuj kartę kartonu jeszcze raz albo zawołaj biuro.')
        }
      }
      onAktywny(null)
      setUwaga(null)
      setWMrozni(`Karton ${p.cartonNo} · ${p.clientName}`)
      zapisz({ ts: Date.now(), opis: `Karton ${p.cartonNo} · ${p.clientName}`, gdzie: 'mroźnia', ton: 'cisza' })
      return void odswiez()
    }
    await odswiez()
    alarm('TEN KARTON NIE JEST OTWARTY', 'Karton jest już w mroźni albo zamknięty. Weź kartę innego kartonu.')
  }

  async function skanuj(kod: string) {
    try {
      const karton = idKartonu(kod)
      if (karton) return await skanKartonu(karton, kod)
      if (czyKompletnyKodPalety(kod)) {
        const p = await palletsApi.lookup(kod)
        return await skanKartonu(String(p?.id ?? ''), kod)
      }

      setWMrozni(null)
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

  const zuzyty = useRef(false)
  useEffect(() => {
    if (!pierwszySkan || zuzyty.current) return
    zuzyty.current = true
    onPierwszySkan?.()
    void skanuj(pierwszySkan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pierwszySkan])

  async function cofnij() {
    if (!korekta?.kod || !korekta.containerId || cofa) return
    setCofa(true)
    try {
      await magazynApi.cofnij(korekta.kod, korekta.containerId)
      setDziennik(d => d.map(w => w.kod === korekta.kod ? { ...w, kod: undefined, gdzie: 'wyjęta z kartonu' } : w))
      onAktywny(korekta.containerId)
      setUwaga(null)
      setKorekta(null)
      await odswiez()
    } catch (e) {
      alarm('NIE COFNIĘTO PAKOWANIA', e instanceof Error ? e.message : 'Odśwież stan i spróbuj ponownie.')
    } finally { setCofa(false) }
  }

  const b = aktywny ? brakuje(aktywny) : 0
  // Pozycje: niedokończone na górze, dalej jak na kartce — receptura, waga.
  const pozycje = aktywny
    ? [...aktywny.lines].sort((x, y) =>
        // Najpierw to, co jeszcze trzeba spakować; komplety schodzą na dół.
        Number(x.packedQty >= x.targetQty) - Number(y.packedQty >= y.targetQty)
        || x.recipeName.localeCompare(y.recipeName, 'pl') || x.kgPerUnit - y.kgPerUnit)
    : []
  const kgSpak = aktywny ? aktywny.lines.reduce((s, l) => s + l.packedQty * l.kgPerUnit, 0) : 0
  const kgCel = aktywny ? aktywny.lines.reduce((s, l) => s + l.targetQty * l.kgPerUnit, 0) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StanPolaczenia blad={blad} aktualizacja={aktualizacja} ladowanie={ladowanie} />
      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6"
        style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)' }}>

        {/* ── Aktywny karton — czytelny z wózka ─────────────────────── */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {aktywny ? (
            <section data-testid={pelny ? 'karton-pelny' : 'karton-aktywny'} className="flex shrink-0 flex-col gap-2 rounded-2xl p-4 lg:p-6"
              style={pelny
                ? { background: 'var(--successSoft)', border: '2px solid var(--success)' }
                : { background: 'var(--accentSoft)', border: '1.5px solid var(--accentLine)' }}>
              <div className="flex items-center gap-3">
                <span className="hmi-v10-mono text-[28px] font-bold" style={{ color: 'var(--accent)' }}>
                  KARTON {aktywny.cartonNo}
                </span>
                <Znacznik ton={aktywny.kind === 'order' ? 'akcja' : 'szary'}>{dokadKarton(aktywny)}</Znacznik>
              </div>
              <div className="font-extrabold leading-none" style={{ fontSize: 'clamp(30px, 3.4vw, 52px)' }}>
                {aktywny.clientName || 'na magazyn'}
              </div>

              {pelny ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className="font-extrabold leading-none" style={{ color: 'var(--success)', fontSize: 'clamp(40px, 4.6vw, 72px)' }}>
                    ✓ SPAKOWANY
                  </div>
                  <div className="hmi-v10-mono text-[22px] font-bold" style={{ color: '#166534' }}>
                    {pelny.packedQty} szt · {kgTxt(kgSpak)} kg
                  </div>
                  <div data-testid="polecenie-mroznia" className="rounded-xl px-5 py-4 font-extrabold leading-tight text-white"
                    style={{ background: 'var(--success)', fontSize: 'clamp(22px, 2.3vw, 34px)' }}>
                    ❄ Zeskanuj kartkę i wjedź do mroźni
                  </div>
                </div>
              ) : (
                <>
                  {/* NAJPIERW SZTUKI, POTEM KILOGRAMY (właściciel 25.09.2026).
                      Suma kartonu jednym wierszem — szczegół jest niżej, per pozycja. */}
                  <div className="mt-3 flex flex-wrap items-end gap-x-10 gap-y-3">
                    <div>
                      <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
                        Brakuje
                      </div>
                      <div data-testid="brakuje" className="hmi-v10-mono font-bold leading-none"
                        style={{ fontSize: 'clamp(56px, 6.6vw, 104px)', color: b ? 'var(--accent)' : 'var(--success)' }}>
                        {b}<span style={{ fontSize: '.36em', color: 'var(--mut)' }}> szt</span>
                      </div>
                    </div>
                    <div className="pb-2">
                      <div className="hmi-v10-mono text-[28px] font-bold leading-tight">
                        {aktywny.packedQty}<span style={{ color: '#9AA3B0' }}>/{aktywny.targetQty}</span>
                        <span className="ml-2 text-[15px] font-semibold" style={{ color: 'var(--mut)' }}>szt</span>
                      </div>
                      <div data-testid="kg-kartonu" className="hmi-v10-mono text-[22px] font-bold leading-tight"
                        style={{ color: 'var(--mut)' }}>
                        {kgTxt(kgSpak)}<span style={{ color: '#9AA3B0' }}>/{kgTxt(kgCel)}</span>
                        <span className="ml-2 text-[15px] font-semibold">kg</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full" style={{ background: '#fff' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${aktywny.targetQty ? Math.round(aktywny.packedQty / aktywny.targetQty * 100) : 0}%`,
                               background: 'var(--accent)' }} />
                  </div>

                </>
              )}

              {/* CO MA BYĆ W KARTONIE — każda pozycja osobno, jak na kartce:
                  „20 × 30 kg KIRMIZI". Dawniej karton mieszany pokazywał
                  „25 + 30 kg" i operator musiał zgadywać, czego ile. */}
              <div data-testid="sklad-kartonu" className="mt-3 overflow-hidden rounded-xl"
                style={{ background: 'var(--panel)', border: '1px solid var(--accentLine)' }}>
                {pozycje.map((p, i) => {
                  const zost = Math.max(0, p.targetQty - p.packedQty)
                  const gotowa = zost === 0
                  return (
                    <div key={i} data-testid="pozycja-kartonu" className="flex items-center gap-4 px-4 py-3"
                      style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined,
                               background: gotowa ? 'var(--successSoft)' : undefined }}>
                      <span className="hmi-v10-mono shrink-0 font-bold leading-none"
                        style={{ fontSize: 'clamp(24px, 2.4vw, 36px)', minWidth: '5.6em' }}>
                        {p.targetQty}<span style={{ color: 'var(--mut)' }}> × </span>{kgTxt(p.kgPerUnit)}
                        <span style={{ fontSize: '.55em', color: 'var(--mut)' }}> kg</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-extrabold uppercase leading-tight"
                          style={{ fontSize: 'clamp(20px, 2vw, 30px)' }}>{p.recipeName || '—'}</span>
                        <span className="block truncate text-[13.5px]" style={{ color: 'var(--mut)' }}>
                          {[p.productTypeName, p.packagingName].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="hmi-v10-mono block text-[22px] font-bold leading-none"
                          style={{ color: gotowa ? 'var(--success)' : 'var(--ink)' }}>
                          {gotowa ? '✓ ' : ''}{p.packedQty}/{p.targetQty}
                        </span>
                        <span className="mt-1 block text-[12.5px] font-bold"
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


          <Karta tytul="Ostatnie skany" className="min-h-[160px] shrink-0" tresc={false}
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
                {w.kod ? <button className="min-h-11 rounded-lg border px-3 text-sm font-bold"
                  disabled={skanuje || blad} onClick={() => setKorekta(w)}>Wyjmij</button> : null}
              </div>
            ))}
            {!dziennik.length ? (
              <div className="p-4 text-[13.5px]" style={{ color: 'var(--mut)' }}>Jeszcze nic nie zeskanowano.</div>
            ) : null}
          </Karta>
        </div>

        {/* ── Werdykt ostatniego skanu + pozostałe kartony ───────────── */}
        <div className="flex min-h-0 flex-col gap-3">
          {blad || ladowanie ? null : wMrozni ? (
            <div role="status" data-testid="w-mrozni" className="flex items-center gap-3 rounded-xl px-5 py-4"
              style={{ background: 'var(--success)', color: '#fff' }}>
              <span className="text-[26px] leading-none">❄</span>
              <span>
                <span className="block text-[18px] font-extrabold leading-tight">WJECHAŁ DO MROŹNI</span>
                <span className="mt-0.5 block text-[14.5px]" style={{ opacity: .9 }}>{wMrozni}</span>
              </span>
            </div>
          ) : uwaga ? (
            <div role="status" className="flex items-start gap-3 rounded-xl px-5 py-4"
              style={{ background: 'var(--ambSoft)', border: '2px solid var(--ambLine)' }}>
              <span className="text-[26px] font-extrabold leading-none" style={{ color: 'var(--amb)' }}>!</span>
              <span>
                <span className="block text-[26px] font-extrabold leading-tight" style={{ color: 'var(--amb)' }}>
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
                <span className="hmi-v10-mono shrink-0 text-[20px] font-bold" style={{ color: 'var(--accent)' }}>
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
        disabled={!!korekta || cofa || ladowanie} onPendingChange={setSkanuje}
        podpis="Pasuje — cisza. Inny karton — krótki ton. Nie pasuje — alarm." />
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
