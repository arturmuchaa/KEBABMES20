import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Snowflake, Truck, AlertTriangle,
  Package, CheckCircle2, CircleDashed, CircleDot, CheckCircle,
  Camera,
} from 'lucide-react'
import {
  palletScanApi,
  vehiclesApi,
  type PalletScanResult,
  type Vehicle,
} from '@/lib/api'
import { fmtKg } from '@/lib/utils'

const LAST_VEHICLE_KEY = 'kebab.mobile.lastVehicleId'

type StateView =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; pallet: PalletScanResult }
  | { kind: 'busy'; pallet: PalletScanResult; action: 'cold_storage' | 'loaded' }
  | { kind: 'done'; pallet: PalletScanResult; action: 'cold_storage' | 'loaded' }

function StatusPill({ status }: { status: string }) {
  if (status === 'loaded') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-300">
        <CheckCircle size={14} /> Załadowana
      </span>
    )
  }
  if (status === 'cold_storage') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-3 py-1 text-sm text-sky-300">
        <CircleDot size={14} /> W mroźni
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-3 py-1 text-sm text-slate-300">
      <CircleDashed size={14} /> Utworzona
    </span>
  )
}

export function MobilePalletLandingPage() {
  const { orderId = '', palletNo = '' } = useParams<{ orderId: string; palletNo: string }>()
  const navigate = useNavigate()

  const code = `PAL|${orderId}|${palletNo}`
  const [state, setState] = useState<StateView>({ kind: 'loading' })
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [showVehicles, setShowVehicles] = useState(false)

  useEffect(() => {
    palletScanApi.lookup(code)
      .then((p) => setState({ kind: 'ready', pallet: p }))
      .catch((e) => setState({ kind: 'error', message: e instanceof Error ? e.message : 'Błąd' }))
  }, [code])

  useEffect(() => {
    vehiclesApi.list(false).then(setVehicles).catch(() => setVehicles([]))
  }, [])

  const lastVehicle = vehicles.find(
    (v) => v.id === (typeof window !== 'undefined' ? localStorage.getItem(LAST_VEHICLE_KEY) : ''),
  )

  async function doAction(action: 'cold_storage' | 'loaded', vehicleId = '') {
    if (state.kind !== 'ready') return
    setState({ kind: 'busy', pallet: state.pallet, action })
    try {
      const result = await palletScanApi.scan(code, action, '', vehicleId)
      setState({ kind: 'done', pallet: result, action })
      if (action === 'loaded' && vehicleId) {
        try { localStorage.setItem(LAST_VEHICLE_KEY, vehicleId) } catch {}
      }
      try { navigator.vibrate?.(80) } catch {}
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Błąd skanu' })
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white">
      <header className="flex items-center justify-between border-b border-white/10 bg-slate-950/60 px-4 py-3">
        <Link to="/mobile" className="flex items-center gap-1 text-sm text-slate-300 hover:text-white">
          <ArrowLeft size={16} /> Mobile
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Package size={16} /> Paleta
        </div>
        <div className="w-12" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {state.kind === 'loading' && (
          <div className="py-10 text-center text-sm text-slate-400">Ładowanie palety…</div>
        )}

        {state.kind === 'error' && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-red-500/60 bg-red-600/10 p-4">
            <AlertTriangle size={28} className="shrink-0 text-red-400" />
            <div className="min-w-0">
              <div className="text-base font-semibold">Błąd</div>
              <div className="mt-1 text-sm text-slate-300">{state.message}</div>
            </div>
          </div>
        )}

        {state.kind !== 'loading' && state.kind !== 'error' && (
          <>
            <section className="rounded-xl border border-white/10 bg-slate-800/60 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">Zamówienie</div>
              <div className="text-lg font-bold">{state.pallet.order.clientName}</div>
              <div className="text-sm text-slate-300">
                {state.pallet.order.orderNo}
                {state.pallet.order.deliveryDate ? ` · ${state.pallet.order.deliveryDate}` : ''}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <div>
                  <div className="text-3xl font-bold leading-none">P{state.pallet.palletNo}</div>
                  <div className="mt-1 text-xs text-slate-400">numer palety</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums">{fmtKg(state.pallet.totalKg, 1)} <span className="text-base font-normal text-slate-400">kg</span></div>
                  <div className="text-xs text-slate-400">{state.pallet.totalQty} szt</div>
                </div>
              </div>

              <div className="mt-3"><StatusPill status={state.pallet.status} /></div>
            </section>

            {state.kind === 'done' && (
              <div className={`rounded-2xl border-2 p-5 text-center ${
                state.action === 'loaded'
                  ? 'border-amber-400 bg-amber-500/20'
                  : 'border-sky-400 bg-sky-500/20'
              }`}>
                <CheckCircle2 size={56} className={`mx-auto ${
                  state.action === 'loaded' ? 'text-amber-300' : 'text-sky-300'
                }`} />
                <div className="mt-2 text-2xl font-extrabold uppercase tracking-wide">
                  {state.action === 'cold_storage' ? 'W MROŹNI' : 'ZAŁADOWANE'}
                </div>
                <div className="mt-1 text-sm text-slate-200">
                  P{state.pallet.palletNo} · {state.pallet.order.clientName}
                </div>
                <div className="text-xs text-slate-400">{state.pallet.order.orderNo}</div>
              </div>
            )}

            {state.kind === 'ready' && state.pallet.status === 'created' && (
              <button
                type="button"
                onClick={() => doAction('cold_storage')}
                className="flex items-center gap-4 rounded-2xl bg-sky-600 px-5 py-6 text-left shadow-lg hover:bg-sky-500 active:scale-[0.99]"
              >
                <Snowflake size={44} />
                <div>
                  <div className="text-2xl font-bold uppercase tracking-wide">Przyjmij do mroźni</div>
                  <div className="text-xs text-sky-100">Jeden tap → status „w mroźni"</div>
                </div>
              </button>
            )}

            {state.kind === 'ready' && state.pallet.status === 'cold_storage' && (
              <>
                {lastVehicle ? (
                  <>
                    <button
                      type="button"
                      onClick={() => doAction('loaded', lastVehicle.id)}
                      className="flex items-center gap-4 rounded-2xl bg-amber-600 px-5 py-6 text-left shadow-lg hover:bg-amber-500 active:scale-[0.99]"
                    >
                      <Truck size={44} />
                      <div>
                        <div className="text-2xl font-bold uppercase tracking-wide">Załaduj</div>
                        <div className="text-xs text-amber-100">
                          {lastVehicle.name}{lastVehicle.plate ? ` · ${lastVehicle.plate}` : ''}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowVehicles(true)}
                      className="rounded-xl border border-amber-500/40 bg-amber-600/10 px-4 py-3 text-sm text-amber-200 hover:bg-amber-600/20"
                    >
                      Inny samochód →
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowVehicles(true)}
                    className="flex items-center gap-4 rounded-2xl bg-amber-600 px-5 py-6 text-left shadow-lg hover:bg-amber-500 active:scale-[0.99]"
                  >
                    <Truck size={44} />
                    <div>
                      <div className="text-2xl font-bold uppercase tracking-wide">Załaduj</div>
                      <div className="text-xs text-amber-100">Wybierz samochód</div>
                    </div>
                  </button>
                )}
              </>
            )}

            {state.kind === 'ready' && state.pallet.status === 'loaded' && (
              <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-500/60 bg-emerald-600/10 p-4">
                <CheckCircle size={28} className="shrink-0 text-emerald-400" />
                <div>
                  <div className="text-base font-semibold">Paleta już załadowana</div>
                  <div className="mt-1 text-xs text-slate-300">Nic do zrobienia.</div>
                </div>
              </div>
            )}

            {state.kind === 'busy' && (
              <div className="text-center text-sm text-slate-400">Zapisuję skan…</div>
            )}

            {state.kind === 'done' && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(state.action === 'cold_storage'
                      ? '/mobile/mroznia'
                      : `/mobile/zaladunek${lastVehicle ? `/${lastVehicle.id}` : ''}`)
                  }
                  className="flex items-center justify-center gap-2 rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold hover:bg-slate-600"
                >
                  <Camera size={16} /> Skanuj dalej w aplikacji
                </button>
                <div className="text-center text-[11px] text-slate-500">
                  Skaner w aplikacji nie wymaga otwierania Safari za każdym razem.
                </div>
              </div>
            )}
          </>
        )}

        {showVehicles && state.kind === 'ready' && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center"
            onClick={() => setShowVehicles(false)}
          >
            <div
              className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-slate-900 p-4 sm:max-w-md sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 text-base font-semibold">Wybierz samochód</div>
              {vehicles.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-slate-800/40 p-3 text-sm text-slate-300">
                  Brak zdefiniowanych samochodów. Dodaj je w panelu biuro → Administracja → Samochody.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {vehicles.map((v) => {
                  const isOwn = v.kind === 'own'
                  const color = isOwn ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500'
                  return (
                    <button
                      key={v.id}
                      onClick={() => { setShowVehicles(false); doAction('loaded', v.id) }}
                      className={`flex flex-col items-start gap-1 rounded-xl ${color} px-4 py-3 text-left`}
                    >
                      <div className="text-base font-bold">{v.name}</div>
                      {v.plate && <div className="font-mono text-sm tracking-wider">{v.plate}</div>}
                    </button>
                  )
                })}
                <button
                  onClick={() => { setShowVehicles(false); doAction('loaded') }}
                  className="rounded-xl border border-white/20 px-4 py-3 text-sm text-slate-200 hover:bg-white/5"
                >
                  Bez przypisania samochodu
                </button>
                <button
                  onClick={() => setShowVehicles(false)}
                  className="rounded-xl px-4 py-2 text-sm text-slate-400 hover:bg-white/5"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
