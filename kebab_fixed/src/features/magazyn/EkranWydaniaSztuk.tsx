/**
 * WYDANIE → POJEDYNCZE SZTUKI (właściciel 30.09.2026).
 *
 * „Klient odbiera sam albo nasze auto zabiera tylko 3 × 50 kg — chcę to wydać,
 * żeby zeszło z mroźni po skanie, a MES dał biuru WZ, HDI i ewentualnie CMR."
 *
 * Trzy kroki: KLIENT (kafle + szukaj, jak jedzie) → SKAN sztuk (każda od razu
 * wychodzi ze swojego kartonu — także z palety innego zamówienia; karton robi
 * się niepełny i „do zważenia") → PRZEKAŻ DO BIURA. Kiosk niczego nie drukuje:
 * WZ, HDI i CMR wystawia biuro, fakturę Subiekt.
 */
import { useEffect, useMemo, useState } from 'react'
import { magazynApi, vehiclesApi, isOfflineError,
         type KlientWydania, type Vehicle, type WydanieSztuk } from '@/lib/api'
import { PasSkanowania } from './components/PasSkanowania'
import { Karta } from './components/Karta'
import { grajBlad, grajInny } from './dzwiek'
import { kgPl } from './wazenieMrozni'
import type { PokazAlarm } from './magazynTypes'

type Odbior = 'klient' | 'nasze'

const ODMOWY: Record<string, [string, string]> = {
  OTHER_DISPATCH: ['SZTUKA NA INNYM WYDANIU', 'Ta sztuka jest już na innym wydaniu sztuk.'],
  SHIPPED: ['SZTUKA JUŻ WYDANA', 'Ta sztuka wyjechała do klienta.'],
  NOT_PRODUCED: ['SZTUKA NIE Z PRODUKCJI', 'Sztuka nie została potwierdzona na produkcji.'],
  INVALID: ['TO NIE JEST SZTUKA', 'Zeskanuj etykietę sztuki kebaba (nie kartkę kartonu).'],
}

export function EkranWydaniaSztuk({ onAlarm, onKoniec }: { onAlarm: PokazAlarm; onKoniec: () => void }) {
  const [wydanie, setWydanie] = useState<WydanieSztuk | null>(null)
  const [otwarte, setOtwarte] = useState<WydanieSztuk[]>([])
  const [przekazane, setPrzekazane] = useState<WydanieSztuk | null>(null)
  const [ostatni, setOstatni] = useState('')
  const [praca, setPraca] = useState(false)
  // Skany odebrane, a jeszcze nierozliczone. Szybka seria czeka w kolejce
  // pola — przekazanie / porzucenie / cofnięcie w tym czasie zamknęłoby
  // wydanie, zanim wszystkie sztuki na nie weszły.
  const [skanuje, setSkanuje] = useState(false)

  useEffect(() => {
    magazynApi.wydanieSztukOtwarte().then(r => setOtwarte(Array.isArray(r) ? r : [])).catch(() => {})
  }, [])

  function alarmSieci(e: unknown) {
    grajBlad('L')
    onAlarm({ skaner: 'L', ton: 'blad', naglowek: isOfflineError(e) ? 'BRAK SIECI' : 'NIE ZAPISANO',
      szczegol: e instanceof Error ? e.message : 'Spróbuj jeszcze raz.' })
  }

  async function skanuj(kod: string) {
    if (!wydanie) {
      // Wydanie zamknięte, zanim kolejka doszła do tego skanu — nie znika po cichu.
      grajBlad('L')
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: 'SKAN NIE ZAPISANY',
        szczegol: 'Wydanie było już zamknięte. Wybierz wydanie i zeskanuj sztukę ponownie.' })
      return
    }
    try {
      const r = await magazynApi.skanWydaniaSztuk(wydanie.id, kod)
      if (r.result === 'OK') {
        setWydanie(r)
        const f = r.from
        setOstatni(f.kind === 'loose' ? 'Sztuka luzem — na wydanie'
          : `Zdjęta z kartonu ${f.cartonNo || '—'}${f.clientName ? ` (${f.clientName})` : ''}`)
      } else if (r.result === 'ALREADY') {
        setWydanie(r)
        grajInny('L')
        onAlarm({ skaner: 'L', ton: 'uwaga', naglowek: 'JUŻ NA TYM WYDANIU', szczegol: 'Tej sztuki nie liczę drugi raz.' })
      } else {
        const [n, sz] = ODMOWY[r.result] ?? ['NIE PRZYJĘTO', 'Spróbuj jeszcze raz.']
        grajBlad('L')
        onAlarm({ skaner: 'L', ton: 'blad', naglowek: n, szczegol: sz })
      }
    } catch (e) { alarmSieci(e) }
  }

  async function cofnij(unitId: string) {
    if (!wydanie || skanuje) return
    try {
      const r = await magazynApi.cofnijZWydaniaSztuk(wydanie.id, unitId)
      setWydanie(r)
      setOstatni(r.backToCarton ? `Wróciła do kartonu ${r.cartonNo}` : 'Cofnięta — leży luzem do spakowania')
    } catch (e) { alarmSieci(e) }
  }

  async function przekaz() {
    if (!wydanie || !wydanie.qty || skanuje) return
    setPraca(true)
    try {
      const r = await magazynApi.przekazWydanieSztuk(wydanie.id)
      setPrzekazane(r); setWydanie(null)
    } catch (e) { alarmSieci(e) } finally { setPraca(false) }
  }

  async function porzuc() {
    if (!wydanie || skanuje) return
    try { await magazynApi.porzucWydanieSztuk(wydanie.id); setWydanie(null); onKoniec() } catch (e) { alarmSieci(e) }
  }

  if (przekazane) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="grid place-items-center rounded-full text-[44px] font-extrabold"
          style={{ width: 96, height: 96, background: 'var(--successSoft)', color: 'var(--success)', border: '3px solid var(--success)' }}>✓</div>
        <div className="text-[34px] font-extrabold leading-tight">Przekazane do biura</div>
        <div className="text-[20px]" style={{ color: 'var(--mut)' }}>
          <b style={{ color: 'var(--ink)' }}>{przekazane.clientName}</b> · {przekazane.qty} szt · {kgPl(przekazane.kg)} kg
          <br />Biuro wystawi WZ i HDI{przekazane.pickup === 'nasze' ? ' (i CMR, jeśli trzeba)' : ''}.
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => setPrzekazane(null)} className="rounded-xl px-7 py-4 text-[18px] font-extrabold text-white"
            style={{ background: 'var(--accent)' }}>Nowe wydanie sztuk</button>
          <button type="button" onClick={onKoniec} className="rounded-xl px-7 py-4 text-[18px] font-bold"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Wróć do wydania</button>
        </div>
      </div>
    )
  }

  if (!wydanie) {
    return <WyborKlienta otwarte={otwarte} onWznow={setWydanie} onAlarm={alarmSieci}
      onZalozono={w => { setWydanie(w); setOstatni('') }} />
  }

  // Skład wydania: te same sztuki (kg + receptura) razem, ze źródłem.
  const grupy = grupuj(wydanie)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-5 px-6 py-3"
        style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>Wydanie dla</div>
          <div className="break-words text-[28px] font-extrabold leading-tight">{wydanie.clientName}</div>
          <div className="text-[14px]" style={{ color: 'var(--mut)' }}>{wydanie.notes || (wydanie.pickup === 'nasze' ? 'nasze auto' : 'odbiór przez klienta')}</div>
        </div>
        <div className="text-right">
          <div className="hmi-v10-mono text-[44px] font-bold leading-none" style={{ color: 'var(--accent)' }}>{wydanie.qty}</div>
          <div className="text-[14px] font-bold" style={{ color: 'var(--mut)' }}>szt · {kgPl(wydanie.kg)} kg</div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 p-4 px-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) 300px' }}>
        <Karta tytul="Sztuki na wydaniu" tresc={false}
          prawo={<span>każda schodzi ze swojego kartonu</span>}>
          <div data-testid="sztuki-wydania">
            {grupy.length ? grupy.map(g => (
              <div key={g.klucz} className="px-4 py-3" style={{ borderTop: '1px solid var(--lineSoft)' }}>
                <div className="flex items-baseline gap-3">
                  <span className="hmi-v10-mono text-[26px] font-bold leading-none">
                    {g.sztuki.length}<span style={{ color: 'var(--mut)' }}> × </span>{kgPl(g.kg, 3)}
                    <span style={{ fontSize: '.55em', color: 'var(--mut)' }}> kg</span>
                  </span>
                  <span className="min-w-0 flex-1 break-words text-[20px] font-extrabold uppercase">{g.receptura || '—'}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.sztuki.map(s => (
                    <span key={s.id} className="inline-flex items-center gap-2 rounded-lg py-1 pl-3 pr-1 text-[13px]"
                      style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
                      <span style={{ color: 'var(--mut)' }}>
                        {s.fromCartonNo ? `z kartonu ${s.fromCartonNo}${s.fromClient ? ` · ${s.fromClient}` : ''}` : 'luzem'}
                        {s.batchNo ? ` · partia ${s.batchNo}` : ''}
                      </span>
                      <button type="button" onClick={() => void cofnij(s.id)} disabled={skanuje}
                        className="rounded-md px-2.5 py-1 text-[12px] font-bold disabled:opacity-40"
                        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Cofnij</button>
                    </span>
                  ))}
                </div>
              </div>
            )) : (
              <div className="p-8 text-center text-[18px]" style={{ color: 'var(--mut)' }}>
                Zeskanuj etykiety sztuk, które wydajesz.<br />Sztuka od razu schodzi ze swojego kartonu.
              </div>
            )}
          </div>
        </Karta>

        <div className="flex flex-col gap-3">
          {ostatni ? (
            <div role="status" className="rounded-xl px-4 py-3 text-[15px] font-bold"
              style={{ background: 'var(--successSoft)', border: '1px dashed var(--successLine)', color: '#166534' }}>{ostatni}</div>
          ) : null}
          <div className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: 'var(--panel)', border: '1px dashed var(--line)', color: 'var(--mut)' }}>
            Karton, z którego wyjmujesz, robi się <b style={{ color: 'var(--ink)' }}>niepełny</b> i
            <b style={{ color: 'var(--ink)' }}> do zważenia</b>. Dokumenty (WZ, HDI, CMR) wystawia biuro.
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <button type="button" onClick={() => void przekaz()} disabled={!wydanie.qty || praca || skanuje}
              className="rounded-2xl px-5 py-5 text-[20px] font-extrabold text-white disabled:opacity-40"
              style={{ background: 'var(--success)' }}>{skanuje ? 'Czekaj — zapisuję skany' : 'Przekaż do biura'}</button>
            {!wydanie.qty ? (
              <button type="button" onClick={() => void porzuc()} disabled={skanuje}
                className="rounded-2xl px-5 py-3.5 text-[16px] font-bold disabled:opacity-40"
                style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Porzuć puste wydanie</button>
            ) : null}
          </div>
        </div>
      </div>

      <PasSkanowania placeholder="Skanuj etykietę sztuki…" onSkan={skanuj} disabled={praca}
        onPendingChange={setSkanuje}
        podpis="Skan etykiety: sztuka schodzi z kartonu na to wydanie." />
    </div>
  )
}

function grupuj(w: WydanieSztuk) {
  const m = new Map<string, { klucz: string; kg: number; receptura: string; sztuki: WydanieSztuk['units'] }>()
  for (const s of w.units) {
    const klucz = `${s.kg}|${s.recipeName}`
    const g = m.get(klucz) ?? { klucz, kg: s.kg, receptura: s.recipeName, sztuki: [] }
    g.sztuki.push(s); m.set(klucz, g)
  }
  return [...m.values()]
}

/** Krok 1: klient i jak jedzie. Kafle klientów duże, do palca; wyszukiwarka
 *  zawęża listę po kilku literach. */
function WyborKlienta({ otwarte, onWznow, onZalozono, onAlarm }: {
  otwarte: WydanieSztuk[]
  onWznow: (w: WydanieSztuk) => void
  onZalozono: (w: WydanieSztuk) => void
  onAlarm: (e: unknown) => void
}) {
  const [klienci, setKlienci] = useState<KlientWydania[]>([])
  const [auta, setAuta] = useState<Vehicle[]>([])
  const [szukaj, setSzukaj] = useState('')
  const [klient, setKlient] = useState<KlientWydania | null>(null)
  const [odbior, setOdbior] = useState<Odbior | null>(null)
  const [auto, setAuto] = useState<string>('')
  const [praca, setPraca] = useState(false)

  useEffect(() => {
    magazynApi.wydanieSztukKlienci().then(r => setKlienci(Array.isArray(r) ? r : [])).catch(onAlarm)
    vehiclesApi.list().then(r => setAuta(r.filter(v => v.active && v.kind === 'own'))).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    return q ? klienci.filter(k => `${k.displayName} ${k.name}`.toLowerCase().includes(q)) : klienci
  }, [klienci, szukaj])

  async function zacznij() {
    if (!klient || !odbior) return
    setPraca(true)
    try {
      onZalozono(await magazynApi.zalozWydanieSztuk({ client_id: klient.id, pickup: odbior, vehicle_id: auto || null }))
    } catch (e) { onAlarm(e) } finally { setPraca(false) }
  }

  const przyciskOdbioru = (o: Odbior, napis: string) => (
    <button type="button" aria-pressed={odbior === o} onClick={() => setOdbior(o)}
      className="flex-1 rounded-2xl px-4 py-5 text-[19px] font-extrabold"
      style={{ background: odbior === o ? 'var(--accent)' : 'var(--panel)', color: odbior === o ? '#fff' : 'var(--ink)',
               border: `2px solid ${odbior === o ? 'var(--accent)' : 'var(--line)'}` }}>{napis}</button>
  )

  return (
    <div className="grid min-h-0 flex-1 gap-3 p-4 px-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
      <Karta tytul="1. Dla kogo" tresc={false}
        prawo={<input value={szukaj} onChange={e => setSzukaj(e.target.value)} placeholder="Szukaj klienta…"
          aria-label="Szukaj klienta"
          className="h-8 w-56 rounded-lg px-3 text-[14px]" style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)' }} />}>
        {otwarte.length ? (
          <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ background: 'var(--ambSoft)', borderBottom: '1px solid var(--ambLine)' }}>
            <span className="text-[13px] font-bold" style={{ color: 'var(--amb)' }}>Niedokończone:</span>
            {otwarte.map(w => (
              <button key={w.id} type="button" onClick={() => onWznow(w)} className="rounded-lg px-3 py-2 text-[14px] font-bold"
                style={{ background: 'var(--panel)', border: '1px solid var(--ambLine)' }}>
                {w.clientName} · {w.qty} szt — dokończ
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {lista.map(k => (
            <button key={k.id} type="button" onClick={() => setKlient(k)} aria-pressed={klient?.id === k.id}
              className="min-h-[64px] rounded-xl px-3 py-2 text-left"
              style={{ background: klient?.id === k.id ? 'var(--accentSoft)' : 'var(--panel)',
                       border: `2px solid ${klient?.id === k.id ? 'var(--accent)' : 'var(--line)'}` }}>
              <span className="block break-words text-[17px] font-extrabold leading-tight">{k.displayName}</span>
              {k.name && k.name !== k.displayName ? (
                <span className="block truncate text-[12px]" style={{ color: 'var(--mut)' }}>{k.name}</span>
              ) : null}
            </button>
          ))}
          {!lista.length ? <div className="col-span-3 p-6 text-center" style={{ color: 'var(--mut)' }}>Brak klienta o tej nazwie.</div> : null}
        </div>
      </Karta>

      <div className="flex flex-col gap-3">
        <Karta tytul="2. Jak jedzie">
          <div className="flex gap-2">
            {przyciskOdbioru('klient', 'Odbiór przez klienta')}
            {przyciskOdbioru('nasze', 'Nasze auto')}
          </div>
          {odbior === 'nasze' && auta.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {auta.map(v => (
                <button key={v.id} type="button" onClick={() => setAuto(auto === v.id ? '' : v.id)}
                  className="rounded-lg px-3 py-2 text-[14px] font-bold"
                  style={{ background: auto === v.id ? 'var(--accentSoft)' : 'var(--panel)',
                           border: `1.5px solid ${auto === v.id ? 'var(--accent)' : 'var(--line)'}` }}>
                  {v.plate || v.name}
                </button>
              ))}
            </div>
          ) : null}
        </Karta>
        <div className="rounded-xl px-4 py-3 text-[15px]" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>Wybrano</div>
          <div className="break-words text-[20px] font-extrabold">{klient?.displayName ?? '—'}</div>
        </div>
        <button type="button" onClick={() => void zacznij()} disabled={!klient || !odbior || praca}
          className="mt-auto rounded-2xl px-5 py-5 text-[20px] font-extrabold text-white disabled:opacity-40"
          style={{ background: 'var(--accent)' }}>Skanuj sztuki →</button>
      </div>
    </div>
  )
}
