import { useRef, useState } from 'react'
import { discoverZebraDevices, sendZpl, zebraErrorMessage, type ZebraDevice } from '@/lib/zebra'
import { calibrateZebra, readZebraDiagnostics } from '@/lib/zebraPrinter'
import {
  loadedZebraMedia, selectZebra, selectedZebraUid, ZEBRA_PROFILES, zebraMediaTestZpl,
  type ZebraProfileId,
} from '@/lib/zebraProfiles'
import { tearOffMaxMm, tearOffZpl } from '@/features/deboning/labelPrinterSetup'

export function ZebraPrinterPanel({ defaultProfile = '50x80', disabled = false, onBusyChange, onCalibrated }: {
  defaultProfile?: ZebraProfileId
  disabled?: boolean
  onBusyChange?: (busy: boolean) => void
  onCalibrated?: (profile: ZebraProfileId, lengthMm: number) => void
}) {
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [uid, setUid] = useState(selectedZebraUid)
  const [profile, setProfile] = useState<ZebraProfileId>(() => loadedZebraMedia(selectedZebraUid()) ?? defaultProfile)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [tear, setTear] = useState('0')
  const locked = busy || disabled

  async function run(action: () => Promise<string>) {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(true); onBusyChange?.(true); setError(false); setMessage('Łączę z drukarką…')
    try { setMessage(await action()) }
    catch (e) { setError(true); setMessage(zebraErrorMessage(e)) }
    finally { busyRef.current = false; setBusy(false); onBusyChange?.(false) }
  }

  async function discover() {
    const list = await discoverZebraDevices()
    setDevices(list)
    const next = list.find(d => d.uid === uid) ?? (!uid ? list[0] : undefined)
    if (next) { setUid(next.uid); selectZebra(next.uid) }
    return { list, next }
  }
  async function printer() {
    const { next } = await discover()
    if (!next) throw new Error('Wybrana drukarka jest niedostępna. Sprawdź USB albo wybierz inną z listy.')
    return next
  }

  return (
    <section className="rounded-lg border border-slate-300 bg-white p-3 text-slate-900 space-y-3">
      <h3 className="font-bold text-sm">Drukarka etykiet — Zebra GC420t</h3>
      <p className="text-xs">203 dpi · etykiety z przerwami · termiczne, bez kalki</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Drukarka Zebra" value={uid} disabled={locked}
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white p-2 text-sm"
          onChange={e => {
            const id = e.target.value
            setUid(id); selectZebra(id); setProfile(loadedZebraMedia(id) ?? defaultProfile); setMessage('')
          }}>
          {!devices.some(d => d.uid === uid) && <option value={uid}>{uid ? 'Zapamiętana drukarka — odśwież listę' : 'Wybierz drukarkę'}</option>}
          {devices.map(d => <option key={d.uid} value={d.uid}>{d.name} ({d.uid})</option>)}
        </select>
        <button type="button" disabled={locked} className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void run(async () => {
            const { list } = await discover()
            return list.length ? `Znaleziono drukarek: ${list.length}. Wybór jest zapamiętywany na tym stanowisku.` : 'Nie znaleziono drukarki. Sprawdź USB i BrowserPrint.'
          })}>Odśwież listę</button>
      </div>
      <label className="block text-xs font-semibold">Założona rolka (szerokość × długość)
        <select aria-label="Rozmiar rolki" value={profile} disabled={locked}
          className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"
          onChange={e => { setProfile(e.target.value as ZebraProfileId); setMessage('Załóż wybraną rolkę, dosuń prowadnice i uruchom kalibrację.') }}>
          {Object.entries(ZEBRA_PROFILES).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" disabled={locked} className="min-h-12 rounded bg-slate-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          onClick={() => void run(async () => {
            const result = await calibrateZebra(await printer(), profile, setMessage)
            onCalibrated?.(profile, result.lengthMm)
            return result.message
          })}>Zmieniam rolkę / kalibruj</button>
        <button type="button" disabled={locked} className="min-h-12 rounded border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50"
          onClick={() => void run(async () => {
            await sendZpl(await printer(), zebraMediaTestZpl(profile))
            return 'Przekazano jedną etykietę testową do BrowserPrint. Sprawdź całą ramkę, podziałkę co 10 mm i zatrzymanie na przerwie.'
          })}>Jedna etykieta testowa</button>
        <button type="button" disabled={locked} className="min-h-12 rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => void run(async () => readZebraDiagnostics(await printer(), profile))}>Odczytaj stan</button>
      </div>
      <details>
        <summary className="cursor-pointer text-xs">Punkt odrywania — regulacja po kalibracji</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <input aria-label="Punkt odrywania mm" type="number" step="0.5" min={-tearOffMaxMm()} max={tearOffMaxMm()}
            value={tear} disabled={locked} onChange={e => setTear(e.target.value)} className="w-20 rounded border p-2" /> mm
          <button type="button" disabled={locked} className="min-h-10 rounded border px-3 disabled:opacity-50"
            onClick={() => void run(async () => {
              const value = Number(tear)
              if (!tear.trim() || !Number.isFinite(value) || Math.abs(value) > tearOffMaxMm()) throw new Error(`Podaj wartość od −${tearOffMaxMm()} do ${tearOffMaxMm()} mm.`)
              await sendZpl(await printer(), tearOffZpl(value))
              return `Wysłano punkt odrywania ${value} mm. Sprawdź na następnej etykiecie.`
            })}>Ustaw punkt odrywania</button>
        </div>
      </details>
      <p className="text-xs text-slate-600">Zmiana rolki nie skaluje projektu etykiety. Kalibracja wysunie kilka naklejek; poczekaj na odczyt. Przy prawidłowej kalibracji pojedyncze naciśnięcie FEED wysuwa jedną etykietę.</p>
      {message && <pre role={error ? 'alert' : 'status'} className={`whitespace-pre-wrap break-words rounded p-2 text-xs ${error ? 'bg-red-50 text-red-800' : 'bg-slate-100'}`}>{message}</pre>}
    </section>
  )
}
