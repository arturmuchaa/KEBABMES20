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
import { useCallback, useEffect, useState } from 'react'
import { HMI_FONT, HMI_VARS } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { useAuth } from '@/features/auth/AuthContext'
import { useServiceHold, ServiceMenuModal, serviceSections } from '@/features/deboning/ServiceMenu'
import { magazynApi, type PodsumowanieMagazynu } from '@/lib/api'
import { Kafel } from '@/features/magazyn/components/Kafel'
import { Alarm } from '@/features/magazyn/components/Alarm'
import { EkranKartonow } from '@/features/magazyn/EkranKartonow'
import { EkranPakowania } from '@/features/magazyn/EkranPakowania'
import { EkranWyboruAuta } from '@/features/magazyn/EkranWyboruAuta'
import { EkranZaladunku } from '@/features/magazyn/EkranZaladunku'
import { EkranMrozni } from '@/features/magazyn/EkranMrozni'
import type { EkranMagazynu, StanAlarmu } from '@/features/magazyn/magazynTypes'
import { etykietaDnia, krotkaData } from '@/features/magazyn/pula'

declare const __MAGAZYN_VERSION__: string

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
  const [ekran, setEkran] = useState<EkranMagazynu>('kafle')
  const [pojazdId, setPojazdId] = useState('')
  const [aktywnyKarton, setAktywnyKarton] = useState<string | null>(null)
  const [alarm, setAlarm] = useState<StanAlarmu | null>(null)
  const [stan, setStan] = useState<PodsumowanieMagazynu | null>(null)
  const [teraz, setTeraz] = useState(() => new Date())
  const [menuSerwisowe, setMenuSerwisowe] = useState(false)
  const { holdProps } = useServiceHold(() => setMenuSerwisowe(true))

  const pokazAlarm = useCallback((a: Omit<StanAlarmu, 'ts'>) => {
    const pelny: StanAlarmu = { ...a, ts: Date.now() }
    setAlarm(pelny)
    setTimeout(() => setAlarm(x => (x && x.ts === pelny.ts ? null : x)), ALARM_MS)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTeraz(new Date()), 15000)
    return () => clearInterval(t)
  }, [])

  // Żywy stan pod kaflami — tylko gdy kafle są na ekranie.
  useEffect(() => {
    if (ekran !== 'kafle') return
    let zywy = true
    const wczytaj = () => magazynApi.podsumowanie()
      .then(s => { if (zywy) setStan(s) })
      .catch(() => { /* kafle działają i bez liczb */ })
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
        {meta.back ? (
          <button type="button" onClick={() => setEkran(meta.back!)}
            className="h-11 shrink-0 rounded-lg px-4 text-[14px] font-bold"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
            ← Wstecz
          </button>
        ) : null}
        <div {...holdProps} style={{ touchAction: 'manipulation' }}>
          <div className="text-xl font-extrabold uppercase leading-none tracking-tight">{meta.t}</div>
          <div className="hmi-v10-mono mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: 'var(--mut)' }}>{meta.p}</div>
        </div>
        <Chip label="Operator" value={(user?.name ?? '—').split(' ')[0]} accent />
        <Chip label="Dzień" value={dzien} />
        <div className="flex-1" />
        <div className="hmi-v10-mono text-[26px] font-bold tracking-tight">{hhmm(teraz)}</div>
        <button type="button" onClick={() => logout()}
          className="h-9 shrink-0 rounded-lg px-4 text-[13px] font-bold"
          style={{ border: '1px solid var(--line)', color: 'var(--mut)', background: 'var(--panel)' }}>
          Wyloguj
        </button>
      </header>

      {ekran === 'kafle' ? (
        <main className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-5 px-6" style={{ gridAutoRows: '1fr' }}>
          <Kafel nazwa="Kartony" czynnosc="Spakuj sztuki do kartonu" glif="▣"
            licznik={k ? String(k.sztukDoSpakowania) : '—'} jednostka="szt do spakowania"
            stan={k
              ? (k.zalegle
                  ? `${k.zalegle} szt zaległych z poprzednich dni · ${k.otwarte} otwartych kartonów`
                  : `${k.otwarte} otwartych kartonów · brakuje w nich ${k.brakujeWKartonach} szt`)
              : 'wczytuję stan…'}
            podglad={(k?.dni ?? []).map(d => ({
              lewo: `${krotkaData(d.data)} · ${etykietaDnia(d.data, teraz).etykieta}`,
              prawo: `${d.sztuk} szt`, wyrozniony: d.zalegle }))}
            wariant={k?.zalegle ? 'pilne' : k && k.otwarte > 0 && k.sztukDoSpakowania === 0 ? 'gotowe' : 'zwykly'}
            onClick={() => setEkran('kartony')} />
          <Kafel nazwa="Wydanie" czynnosc="Załaduj auto" glif="⇥"
            licznik={w ? String(w.zamowien) : '—'} jednostka={w?.zamowien === 1 ? 'zamówienie na dziś' : 'zamówień na dziś'}
            stan={w ? (w.zamowien ? `${Math.round(w.kg).toLocaleString('pl-PL')} kg do wydania dziś` : 'na dziś nic nie czeka')
                    : 'wczytuję stan…'}
            podglad={(w?.lista ?? []).map(z => ({
              lewo: z.klient, prawo: `${Math.round(z.kg).toLocaleString('pl-PL')} kg` }))}
            onClick={() => setEkran('wydanie-auta')} />
          <Kafel nazwa="Mroźnia" czynnosc="Wstaw pełną paletę" glif="❄"
            licznik={stan ? String(stan.mroznia.palet) : '—'} jednostka="palet w mroźni"
            stan="czeka na załadunek"
            podglad={(stan?.mroznia.lista ?? []).map(m => ({
              lewo: m.klient, prawo: `${m.palet} pal.` }))}
            onClick={() => setEkran('mroznia')} />
          <Kafel nazwa="Przyjęcie" czynnosc="Przyjmij dostawę z rampy" glif="⤓"
            licznik="—" stan="w kolejnym wydaniu panelu" disabled onClick={() => {}} />
        </main>
      ) : null}

      {ekran === 'kartony' ? (
        <EkranKartonow onWybor={id => { setAktywnyKarton(id); setEkran('kartony-praca') }} />
      ) : null}

      {ekran === 'kartony-praca' ? (
        <EkranPakowania aktywnyId={aktywnyKarton} onAktywny={setAktywnyKarton} onAlarm={pokazAlarm} />
      ) : null}

      {ekran === 'wydanie-auta' ? (
        <EkranWyboruAuta onWybor={id => { setPojazdId(id); setEkran('wydanie-praca') }} />
      ) : null}

      {ekran === 'wydanie-praca' ? (
        <EkranZaladunku vehicleId={pojazdId} onAlarm={pokazAlarm} onKoniec={() => setEkran('kafle')} />
      ) : null}

      {ekran === 'mroznia' ? <EkranMrozni onAlarm={pokazAlarm} /> : null}

      <Alarm alarm={alarm} />

      <ServiceMenuModal open={menuSerwisowe} onClose={() => setMenuSerwisowe(false)}
        channel="magazyn" version={__MAGAZYN_VERSION__}
        buildLabel={`Magazyn · ${__MAGAZYN_VERSION__}`}
        sections={serviceSections('magazyn')} />
    </div>
  )
}
