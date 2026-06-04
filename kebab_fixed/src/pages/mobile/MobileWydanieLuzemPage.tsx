import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Truck, X, Undo2 } from 'lucide-react'
import { dispatchesApi, clientsApi, type DispatchScanResult, type DispatchBatchRow } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'

interface ActiveDispatch { id: string; clientName: string; qty: number }

export function MobileWydanieLuzemPage() {
  const [dispatch, setDispatch] = useState<ActiveDispatch | null>(null)
  const [batch, setBatch] = useState<DispatchBatchRow[]>([])
  const [clientName, setClientName] = useState('')
  const [clientId, setClientId] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; message: string } | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clientsRes = useApi(() => clientsApi.list(), [])
  const openRes = useApi(() => dispatchesApi.listOpen(), [])

  const focusInput = useCallback(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])
  useEffect(() => { if (dispatch) focusInput() }, [dispatch, focusInput])

  async function createDispatch() {
    if (!clientName.trim()) { setLast({ ok: false, message: 'Wybierz klienta' }); return }
    try {
      const r = await dispatchesApi.create({ clientId: clientId || undefined, clientName: clientName.trim() })
      setDispatch({ id: r.id, clientName: clientName.trim(), qty: 0 })
      setBatch([]); setLast(null)
    } catch (e) {
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd tworzenia wydania' })
    }
  }

  async function openExisting(id: string, name: string) {
    const d = await dispatchesApi.detail(id)
    setDispatch({ id, clientName: name, qty: Number(d.qty ?? 0) })
    setBatch(d.batch_breakdown ?? [])
    setLast(null)
  }

  async function handleScan(code: string, mode: 'scan' | 'remove' = 'scan') {
    const trimmed = code.trim()
    if (!trimmed || busy || !dispatch) return
    setBusy(true)
    try {
      const r: DispatchScanResult = mode === 'remove'
        ? await dispatchesApi.remove(dispatch.id, trimmed)
        : await dispatchesApi.scan(dispatch.id, trimmed)
      if (r.ok) {
        beepOk(); try { navigator.vibrate?.(80) } catch {}
        setDispatch(prev => prev ? { ...prev, qty: r.qty } : null)
        setBatch(r.batchBreakdown ?? [])
        setLast({ ok: true, message: mode === 'remove' ? 'Sztuka cofnięta' : 'Sztuka dodana' })
      } else {
        beepErr(); try { navigator.vibrate?.([60, 40, 60]) } catch {}
        setLast({ ok: false, message: r.reason || 'Nieprawidłowy kod' })
      }
    } catch (e) {
      beepErr(); setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd' })
    } finally { setBusy(false); setValue(''); focusInput() }
  }

  async function closeDispatch() {
    if (!dispatch) return
    if (!confirm(`Zatwierdzić wydanie dla ${dispatch.clientName}? Sztuki zejdą ze stanu.`)) return
    try {
      await dispatchesApi.close(dispatch.id)
      setLast({ ok: true, message: 'Wydanie zatwierdzone — towar wydany' })
      setDispatch(null); setBatch([]); openRes.refetch?.()
    } catch (e) {
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd zamknięcia' })
    }
  }

  const clients = clientsRes.data ?? []
  const openList = openRes.data ?? []

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-orange-200 bg-orange-600 px-4 py-3 text-white shadow-sm">
        <Link to="/mobile" className="flex items-center gap-1 text-sm font-semibold text-orange-50 hover:text-white">
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Truck size={18} /> Wydanie luzem
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {dispatch ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-orange-300 bg-orange-50 px-3 py-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-orange-600">Wydanie otwarte</div>
                <div className="text-sm font-bold">{dispatch.clientName}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold tabular-nums text-orange-700">{dispatch.qty} szt</div>
                <button onClick={() => { setDispatch(null); openRes.refetch?.() }} aria-label="Zamknij" className="rounded p-1 text-slate-500 hover:text-red-600"><X size={18} /></button>
              </div>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleScan(value) }} className="flex items-stretch gap-2">
              <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Zeskanuj QR sztuki" autoFocus autoComplete="off" spellCheck={false}
                className="flex-1 rounded-lg border-2 border-orange-300 bg-white px-3 py-3 text-base focus:border-orange-500 focus:outline-none" />
              <button type="button" onClick={() => setScannerOpen(true)} className="flex items-center justify-center rounded-lg bg-orange-600 px-4 text-white" aria-label="Kamera"><Camera size={22} /></button>
              <button type="button" onClick={() => handleScan(value, 'remove')} className="flex items-center justify-center rounded-lg bg-slate-200 px-3 text-slate-700" aria-label="Cofnij sztukę"><Undo2 size={20} /></button>
            </form>

            {last && (
              <div className={`flex items-start gap-3 rounded-xl border-2 p-4 ${last.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                {last.ok ? <CheckCircle2 size={28} className="text-emerald-600" /> : <AlertTriangle size={28} className="text-red-600" />}
                <div className={`text-sm font-semibold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>{last.message}</div>
              </div>
            )}

            {batch.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Partie na wydaniu</div>
                {batch.map(b => (
                  <div key={b.batchNo || '—'} className="flex justify-between border-b border-slate-100 py-1 text-sm tabular-nums last:border-0">
                    <span>Partia {b.batchNo || '—'}</span><span className="font-semibold">{b.qty} szt · {b.weightKg.toFixed(0)} kg</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={closeDispatch} className="mt-2 rounded-lg bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700">Zatwierdź wydanie</button>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Nowe wydanie luzem</div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Klient *</label>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setClientName(clients.find((c: any) => c.id === e.target.value)?.name ?? '') }}
                className="mb-3 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base">
                <option value="">— wybierz —</option>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={createDispatch} className="w-full rounded-lg bg-orange-600 px-4 py-3 text-base font-bold text-white hover:bg-orange-700">Rozpocznij wydanie</button>
              {last && !last.ok && <div className="mt-2 text-sm text-red-700">{last.message}</div>}
            </div>

            {openList.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Otwarte wydania</div>
                <ul className="flex flex-col gap-2">
                  {openList.map(d => (
                    <li key={d.id}>
                      <button onClick={() => openExisting(d.id, d.clientName)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:bg-orange-50">
                        <span className="text-sm font-semibold">{d.clientName || '—'}</span>
                        <span className="text-sm font-bold tabular-nums text-orange-700">{d.qty} szt</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      {scannerOpen && (
        <QrScannerModal onScan={(t) => { setScannerOpen(false); handleScan(t); focusInput() }} onClose={() => { setScannerOpen(false); focusInput() }} />
      )}
    </div>
  )
}
