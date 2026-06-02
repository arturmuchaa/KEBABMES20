import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Package, PackageOpen, X } from 'lucide-react'
import { cartonsApi, productTypesApi, recipesApi, type CartonScanResult } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'

interface OpenCarton {
  id: string
  recipeName: string
  clientName: string
  targetQty: number
  packedQty: number
}

interface ScanEntry {
  ts: number
  ok: boolean
  message: string
  result?: CartonScanResult
}

export function MobilePakowaniePage() {
  // Formularz tworzenia kartonu
  const [formProductTypeId, setFormProductTypeId] = useState('')
  const [formRecipeId, setFormRecipeId] = useState('')
  const [formClientName, setFormClientName] = useState('')
  const [formTargetQty, setFormTargetQty] = useState('')
  const [formTargetWeightKg, setFormTargetWeightKg] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Aktywny karton
  const [carton, setCarton] = useState<OpenCarton | null>(null)

  // Skan
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<ScanEntry | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const productTypesRes = useApi(() => productTypesApi.list(), [])
  const recipesRes = useApi(() => recipesApi.list(), [])

  const productTypes = (productTypesRes.data ?? []).filter((pt: any) => pt.active !== false)
  const recipes = (recipesRes.data ?? []).filter((r: any) => r.active !== false)

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (carton) focusInput()
  }, [carton, focusInput])

  async function handleCreateCarton(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const qty = parseInt(formTargetQty, 10)
    const weightKg = parseFloat(formTargetWeightKg.replace(',', '.'))
    if (!formProductTypeId) { setCreateError('Wybierz rodzaj produktu'); return }
    if (!formRecipeId)      { setCreateError('Wybierz recepturę'); return }
    if (!formClientName.trim()) { setCreateError('Podaj klienta'); return }
    if (!qty || qty <= 0)   { setCreateError('Podaj docelową ilość sztuk'); return }
    if (!weightKg || weightKg <= 0) { setCreateError('Podaj docelową wagę kg'); return }

    setCreating(true)
    try {
      const result = await cartonsApi.create({
        clientName: formClientName.trim(),
        productTypeId: formProductTypeId,
        recipeId: formRecipeId,
        targetQty: qty,
        targetWeightKg: weightKg,
      })
      const recipeName = recipes.find((r: any) => r.id === formRecipeId)?.name ?? formRecipeId
      setCarton({
        id: result.id,
        recipeName,
        clientName: formClientName.trim(),
        targetQty: qty,
        packedQty: 0,
      })
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Nie udało się otworzyć kartonu')
    } finally {
      setCreating(false)
    }
  }

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy || !carton) return
    setBusy(true)
    try {
      const result = await cartonsApi.scan(carton.id, trimmed)
      if (result.ok) {
        beepOk()
        try { navigator.vibrate?.(80) } catch {}
        const newPacked = result.packedQty
        if (result.cartonStatus === 'full') {
          setLast({
            ts: Date.now(),
            ok: true,
            message: `Karton pełny — otwórz nowy karton`,
            result,
          })
          setCarton(null)
        } else {
          setCarton((prev) => prev ? { ...prev, packedQty: newPacked } : null)
          setLast({
            ts: Date.now(),
            ok: true,
            message: `Sztuka spakowana`,
            result,
          })
        }
      } else {
        beepErr()
        try { navigator.vibrate?.([60, 40, 60]) } catch {}
        setLast({
          ts: Date.now(),
          ok: false,
          message: result.reason || 'Nieprawidłowy kod',
          result,
        })
      }
    } catch (e) {
      beepErr()
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
      setLast({
        ts: Date.now(),
        ok: false,
        message: e instanceof Error ? e.message : 'Błąd skanowania',
      })
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  function handleCloseCarton() {
    if (!confirm('Zamknąć bieżący karton?')) return
    setCarton(null)
    setLast(null)
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-violet-200 bg-violet-600 px-4 py-3 text-white shadow-sm">
        <Link
          to="/mobile"
          className="flex items-center gap-1 text-sm font-semibold text-violet-50 hover:text-white"
        >
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Package size={18} /> Pakowanie
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {/* ─── Aktywny karton ─── */}
        {carton ? (
          <>
            {/* Nagłówek kartonu */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-300 bg-violet-50 px-3 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <PackageOpen size={22} className="shrink-0 text-violet-600" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">Karton otwarty</div>
                  <div className="text-sm font-bold text-slate-900">{carton.recipeName}</div>
                  <div className="text-xs text-slate-500">{carton.clientName}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums text-violet-700">
                    {carton.packedQty}
                    <span className="text-violet-400">/{carton.targetQty}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">szt</div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseCarton}
                  aria-label="Zamknij karton"
                  className="rounded p-1 text-slate-500 hover:bg-violet-100 hover:text-red-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Skan */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmit(value) }}
              className="flex items-stretch gap-2"
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Zeskanuj QR sztuki"
                autoFocus
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-lg border-2 border-violet-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="flex items-center justify-center rounded-lg bg-violet-600 px-4 text-white hover:bg-violet-700"
                aria-label="Skanuj aparatem"
              >
                <Camera size={22} />
              </button>
            </form>

            {/* Feedback */}
            {last && (
              <div
                className={`flex items-start gap-3 rounded-xl border-2 p-4 ${
                  last.ok
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-red-300 bg-red-50'
                }`}
              >
                {last.ok
                  ? <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-600" />
                  : <AlertTriangle size={28} className="mt-0.5 shrink-0 text-red-600" />}
                <div className="min-w-0 flex-1">
                  <div className={`text-lg font-bold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                    {last.ok ? 'OK' : 'BŁĄD'}
                  </div>
                  <div className={`mt-0.5 text-sm ${last.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                    {last.message}
                  </div>
                  {last.ok && last.result && !last.message.includes('pełny') && (
                    <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-800">
                      {last.result.packedQty}
                      <span className="text-emerald-500">/{last.result.targetQty}</span>
                      <span className="ml-2 text-sm font-normal text-emerald-600">szt</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* ─── Formularz otwierania kartonu ─── */}
            {last && last.message.includes('pełny') && (
              <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
                <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <div className="text-lg font-bold text-emerald-800">Karton pełny</div>
                  <div className="text-sm text-emerald-700">Otwórz nowy karton poniżej</div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
                <PackageOpen size={16} className="text-violet-600" /> Otwórz karton
              </div>
              <form onSubmit={handleCreateCarton} className="flex flex-col gap-3">
                {/* Rodzaj produktu */}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Rodzaj produktu *
                  </label>
                  {productTypesRes.loading ? (
                    <div className="text-sm text-slate-500">Ładowanie…</div>
                  ) : (
                    <select
                      value={formProductTypeId}
                      onChange={(e) => setFormProductTypeId(e.target.value)}
                      className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    >
                      <option value="">— wybierz —</option>
                      {productTypes.map((pt: any) => (
                        <option key={pt.id} value={pt.id}>{pt.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Receptura */}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Receptura *
                  </label>
                  {recipesRes.loading ? (
                    <div className="text-sm text-slate-500">Ładowanie…</div>
                  ) : (
                    <select
                      value={formRecipeId}
                      onChange={(e) => setFormRecipeId(e.target.value)}
                      className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    >
                      <option value="">— wybierz —</option>
                      {recipes.map((r: any) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Klient */}
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Klient *
                  </label>
                  <input
                    type="text"
                    value={formClientName}
                    onChange={(e) => setFormClientName(e.target.value)}
                    placeholder="Nazwa klienta"
                    autoComplete="off"
                    className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                </div>

                {/* Docelowa ilość + waga */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Ilość (szt) *
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={formTargetQty}
                      onChange={(e) => setFormTargetQty(e.target.value)}
                      placeholder="np. 10"
                      min={1}
                      className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Waga (kg) *
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formTargetWeightKg}
                      onChange={(e) => setFormTargetWeightKg(e.target.value)}
                      placeholder="np. 40"
                      className="w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                </div>

                {createError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertTriangle size={16} className="shrink-0" />
                    {createError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-base font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  <PackageOpen size={18} />
                  {creating ? 'Otwieranie…' : 'Otwórz karton'}
                </button>
              </form>
            </div>
          </>
        )}
      </main>

      {scannerOpen && (
        <QrScannerModal
          onScan={(text) => { setScannerOpen(false); handleSubmit(text); focusInput() }}
          onClose={() => { setScannerOpen(false); focusInput() }}
        />
      )}
    </div>
  )
}
