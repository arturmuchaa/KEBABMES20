/**
 * MixingPage — Masowanie / Produkcja
 *
 * State machine:
 *  step 1 → machine selection
 *  step 2 → meat lot selection (FEFO)
 *  step 3 → recipe & ingredient steps
 *  step 4 → confirm & submit
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, FlaskConical, Package, CheckCircle2,
  Circle, Plus, Minus, RotateCcw, Send, AlertTriangle,
  Beef, Scale, Clock,
} from 'lucide-react'
import {
  fetchMeatStock, fetchRecipes, fetchMachineLocks,
  createMixingOrder, startMixingOrder, confirmMixingStep,
  finishMixingSession, type MeatStock, type Recipe,
} from '@/api'
import { Button } from '@/components/ui/button'
import { Badge, ExpiryBadge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonTable } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast-utils'
import { fmtKg, fmtDate, cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────

type Step = 'machine' | 'lots' | 'recipe' | 'ingredients' | 'confirm'
interface LotSelection { lot: MeatStock; kg: number }

const MACHINES = [1, 2, 3]
const STEPS: { id: Step; label: string }[] = [
  { id: 'machine',     label: 'Masownica' },
  { id: 'lots',        label: 'Partie mięsa' },
  { id: 'recipe',      label: 'Receptura' },
  { id: 'ingredients', label: 'Składniki' },
  { id: 'confirm',     label: 'Potwierdzenie' },
]

// ─── Main Component ───────────────────────────────────────────

export function MixingPage() {
  const qc = useQueryClient()

  // Step navigation
  const [step, setStep] = useState<Step>('machine')

  // Selections
  const [machineId,    setMachineId]    = useState<number | null>(null)
  const [selectedLots, setSelectedLots] = useState<LotSelection[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)
  const [confirmedSteps, setConfirmedSteps] = useState<Map<number, number>>(new Map())
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null)
  const [outputKg, setOutputKg] = useState('')
  const [done, setDone] = useState(false)

  // Queries
  const { data: meatStock = [], isLoading: loadStock } = useQuery({
    queryKey: ['meat-stock'],
    queryFn:  fetchMeatStock,
    refetchInterval: 20_000,
  })

  const { data: recipes = [], isLoading: loadRecipes } = useQuery({
    queryKey: ['recipes'],
    queryFn:  fetchRecipes,
  })

  const { data: locks = [] } = useQuery({
    queryKey: ['machine-locks'],
    queryFn:  fetchMachineLocks,
    refetchInterval: 5_000,
  })

  // Derived
  const totalSelectedKg = selectedLots.reduce((s, l) => s + l.kg, 0)
  const lockedMachines  = new Set(locks.map(l => l.machine_id))

  const ingredientSteps = useMemo(() => {
    if (!selectedRecipe || totalSelectedKg === 0) return []
    return selectedRecipe.ingredients.map(ing => ({
      ...ing,
      qtyRequired: Number(((ing.qty_per_100kg * totalSelectedKg) / 100).toFixed(3)),
    }))
  }, [selectedRecipe, totalSelectedKg])

  const allIngredientsConfirmed = ingredientSteps.length > 0 &&
    ingredientSteps.every((_, i) => confirmedSteps.has(i + 1))

  // ── Mutations ─────────────────────────────────────────────

  const createOrder = useMutation({
    mutationFn: () => createMixingOrder({
      recipeId:     selectedRecipe!.id,
      meatKg:       totalSelectedKg,
      productTypeId: selectedRecipe!.product_type_id || undefined,
      meatLots:     selectedLots.map(l => ({ meatLotId: l.lot.id, kgPlanned: l.kg })),
    }),
    onSuccess: async (order) => {
      setCurrentOrderId(order.id)
      await startMixingOrder(order.id, machineId!)
      toast.success(`Zlecenie ${order.orderNo} uruchomione na masownicy ${machineId}`)
      qc.invalidateQueries({ queryKey: ['meat-stock'] })
      qc.invalidateQueries({ queryKey: ['machine-locks'] })
      setStep('ingredients')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Błąd tworzenia zlecenia'),
  })

  const confirmStep = useMutation({
    mutationFn: ({ stepNo, qty }: { stepNo: number; qty: number }) =>
      confirmMixingStep(currentOrderId!, stepNo, qty),
    onSuccess: (_, { stepNo, qty }) => {
      setConfirmedSteps(prev => new Map(prev).set(stepNo, qty))
      toast.success(`Krok ${stepNo} potwierdzony`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Błąd potwierdzenia'),
  })

  const finishOrder = useMutation({
    mutationFn: () => finishMixingSession(currentOrderId!, Number(outputKg) || totalSelectedKg),
    onSuccess: (order) => {
      toast.success('Masowanie zakończone — partia zapisana!')
      qc.invalidateQueries({ queryKey: ['meat-stock'] })
      qc.invalidateQueries({ queryKey: ['machine-locks'] })
      setDone(true)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Błąd zakończenia'),
  })

  // ── Reset ─────────────────────────────────────────────────

  function reset() {
    setStep('machine'); setMachineId(null); setSelectedLots([])
    setSelectedRecipe(null); setConfirmedSteps(new Map())
    setCurrentOrderId(null); setOutputKg(''); setDone(false)
  }

  // ── Done screen ───────────────────────────────────────────

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 animate-fade-in">
        <div className="w-20 h-20 rounded-full bg-emerald-500/10 ring-2 ring-emerald-500/30 flex items-center justify-center">
          <CheckCircle2 size={40} className="text-emerald-400" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white">Masowanie zakończone!</h2>
          <p className="text-slate-400 mt-1">Partia mięsa przyprawionego została zapisana w systemie.</p>
        </div>
        <Button size="xl" onClick={reset}>
          <RotateCcw size={18} /> Nowe masowanie
        </Button>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────

  return (
    <div className="max-w-4xl animate-fade-in">
      {/* ── Stepper ───────────────────────────────────────── */}
      <Stepper current={step} steps={STEPS} />

      <div className="mt-6">
        {/* STEP 1: Machine */}
        {step === 'machine' && (
          <StepMachine
            machines={MACHINES}
            selected={machineId}
            locked={lockedMachines}
            onSelect={id => { setMachineId(id); setStep('lots') }}
          />
        )}

        {/* STEP 2: Lots */}
        {step === 'lots' && (
          <StepLots
            stock={meatStock}
            loading={loadStock}
            selected={selectedLots}
            onChange={setSelectedLots}
            onBack={() => setStep('machine')}
            onNext={() => setStep('recipe')}
          />
        )}

        {/* STEP 3: Recipe */}
        {step === 'recipe' && (
          <StepRecipe
            recipes={recipes}
            loading={loadRecipes}
            selected={selectedRecipe}
            onSelect={setSelectedRecipe}
            onBack={() => setStep('lots')}
            onNext={() => {
              createOrder.mutate()
            }}
            isCreating={createOrder.isPending}
            totalKg={totalSelectedKg}
          />
        )}

        {/* STEP 4: Ingredients */}
        {step === 'ingredients' && (
          <StepIngredients
            steps={ingredientSteps}
            confirmed={confirmedSteps}
            onConfirm={(stepNo, qty) => confirmStep.mutate({ stepNo, qty })}
            confirming={confirmStep.isPending}
            allDone={allIngredientsConfirmed}
            onNext={() => setStep('confirm')}
          />
        )}

        {/* STEP 5: Confirm */}
        {step === 'confirm' && (
          <StepConfirm
            machine={machineId!}
            lots={selectedLots}
            recipe={selectedRecipe!}
            steps={ingredientSteps}
            confirmed={confirmedSteps}
            outputKg={outputKg}
            onOutputKgChange={setOutputKg}
            onBack={() => setStep('ingredients')}
            onFinish={() => finishOrder.mutate()}
            isFinishing={finishOrder.isPending}
          />
        )}
      </div>
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────

function Stepper({ current, steps }: { current: Step; steps: typeof STEPS }) {
  const idx = steps.findIndex(s => s.id === current)
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => {
        const done    = i < idx
        const active  = i === idx
        const future  = i > idx
        return (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
              active  && 'bg-mes-accent text-white shadow-mes-glow',
              done    && 'text-emerald-400',
              future  && 'text-slate-600',
            )}>
              {done
                ? <CheckCircle2 size={13} />
                : <span className={cn(
                    'w-4 h-4 rounded-full border flex items-center justify-center text-[10px] font-bold',
                    active ? 'border-white/40 bg-white/10' : 'border-slate-700'
                  )}>{i + 1}</span>
              }
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight size={14} className="text-slate-700 mx-0.5" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Machine Selection ────────────────────────────────

function StepMachine({ machines, selected, locked, onSelect }: {
  machines: number[]
  selected: number | null
  locked: Set<number>
  onSelect: (id: number) => void
}) {
  return (
    <div className="animate-slide-in">
      <StepHeader icon={<FlaskConical size={20} />} title="Wybierz masownicę" />
      <div className="grid grid-cols-3 gap-4 mt-6">
        {machines.map(id => {
          const isLocked = locked.has(id)
          return (
            <button
              key={id}
              disabled={isLocked}
              onClick={() => onSelect(id)}
              className={cn(
                'relative flex flex-col items-center justify-center h-44 rounded-2xl border-2 transition-all duration-200',
                'text-4xl font-black select-none',
                isLocked
                  ? 'border-mes-border bg-mes-surface text-slate-700 cursor-not-allowed'
                  : 'border-mes-border bg-mes-elevated hover:border-mes-accent hover:shadow-mes-glow cursor-pointer active:scale-95',
                selected === id && 'border-mes-accent shadow-mes-glow bg-mes-accent/10',
              )}
            >
              <span className={cn(
                'transition-colors',
                isLocked ? 'text-slate-700' : selected === id ? 'text-mes-accent-l' : 'text-slate-200'
              )}>
                {id}
              </span>
              <span className="text-xs font-medium mt-2 text-slate-500">Masownica {id}</span>
              {isLocked && (
                <div className="absolute top-3 right-3">
                  <Badge variant="red">Zajęta</Badge>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Step 2: Lot Selection ────────────────────────────────────

function StepLots({ stock, loading, selected, onChange, onBack, onNext }: {
  stock: MeatStock[]
  loading: boolean
  selected: LotSelection[]
  onChange: (s: LotSelection[]) => void
  onBack: () => void
  onNext: () => void
}) {
  const totalKg = selected.reduce((s, l) => s + l.kg, 0)

  function toggleLot(lot: MeatStock) {
    const exists = selected.find(s => s.lot.id === lot.id)
    if (exists) {
      onChange(selected.filter(s => s.lot.id !== lot.id))
    } else {
      onChange([...selected, { lot, kg: Math.min(lot.kg_available, 50) }])
    }
  }

  function updateKg(lotId: string, kg: number) {
    onChange(selected.map(s =>
      s.lot.id === lotId ? { ...s, kg: Math.max(0.001, Math.min(kg, s.lot.kg_available)) } : s
    ))
  }

  // FEFO sort
  const sorted = [...stock].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))

  return (
    <div className="animate-slide-in space-y-4">
      <StepHeader icon={<Beef size={20} />} title="Wybierz partie mięsa (FEFO)" />

      {/* Summary bar */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 bg-mes-accent/10 border border-mes-accent/20 rounded-xl px-4 py-3">
          <Scale size={16} className="text-mes-accent-l" />
          <span className="text-sm text-slate-300">
            Wybrano <strong className="text-white">{selected.length}</strong> partii —
            łącznie <strong className="text-mes-accent-l">{fmtKg(totalKg)}</strong>
          </span>
        </div>
      )}

      {loading ? <SkeletonTable rows={4} /> : (
        <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
          {sorted.length === 0 ? (
            <div className="py-12 text-center text-slate-500">Brak dostępnych partii mięsa</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-mes-border text-slate-500 text-xs">
                  <th className="px-4 py-3 text-left w-10"></th>
                  <th className="px-4 py-3 text-left">Lot / Partia</th>
                  <th className="px-4 py-3 text-left">Surowiec</th>
                  <th className="px-4 py-3 text-right">Dostępne</th>
                  <th className="px-4 py-3 text-left">FEFO</th>
                  <th className="px-4 py-3 text-right w-36">Pobierz kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mes-border/50">
                {sorted.map(lot => {
                  const sel = selected.find(s => s.lot.id === lot.id)
                  return (
                    <tr key={lot.id}
                      onClick={() => toggleLot(lot)}
                      className={cn(
                        'transition-colors cursor-pointer select-none',
                        sel
                          ? 'bg-mes-accent/10 hover:bg-mes-accent/15'
                          : 'hover:bg-mes-elevated/40'
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className={cn(
                          'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                          sel ? 'bg-mes-accent border-mes-accent' : 'border-mes-border'
                        )}>
                          {sel && <CheckCircle2 size={12} className="text-white" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-mes-accent-l font-semibold">
                        {lot.lot_no}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{lot.raw_batch_no}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono">
                        {fmtKg(lot.kg_available)}
                      </td>
                      <td className="px-4 py-3">
                        <ExpiryBadge expiryDate={lot.expiry_date} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {sel && (
                          <input
                            type="number"
                            value={sel.kg}
                            min={0.001}
                            max={lot.kg_available}
                            step={0.5}
                            onChange={e => updateKg(lot.id, Number(e.target.value))}
                            className="w-28 h-8 bg-mes-bg border border-mes-accent/40 rounded px-2 text-right text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-mes-accent"
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={selected.length === 0 || totalKg <= 0}
        nextLabel="Wybierz recepturę →"
      />
    </div>
  )
}

// ─── Step 3: Recipe Selection ─────────────────────────────────

function StepRecipe({ recipes, loading, selected, onSelect, onBack, onNext, isCreating, totalKg }: {
  recipes: Recipe[]
  loading: boolean
  selected: Recipe | null
  onSelect: (r: Recipe) => void
  onBack: () => void
  onNext: () => void
  isCreating: boolean
  totalKg: number
}) {
  return (
    <div className="animate-slide-in space-y-4">
      <StepHeader icon={<Package size={20} />} title="Wybierz recepturę" />

      {loading ? <SkeletonTable rows={3} /> : (
        <div className="grid gap-3">
          {recipes.map(r => (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className={cn(
                'w-full text-left p-4 rounded-xl border-2 transition-all',
                selected?.id === r.id
                  ? 'border-mes-accent bg-mes-accent/10 shadow-mes-glow'
                  : 'border-mes-border bg-mes-elevated hover:border-mes-accent/50'
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-white">{r.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{r.product_type_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">{r.ingredients.length} składników</div>
                  <div className="text-xs text-emerald-400 mt-0.5">
                    Wydajność: {r.total_output_per_100kg}%
                  </div>
                </div>
              </div>
              {selected?.id === r.id && totalKg > 0 && (
                <div className="mt-3 pt-3 border-t border-mes-accent/20 grid grid-cols-3 gap-3">
                  {r.ingredients.slice(0, 3).map(ing => (
                    <div key={ing.id} className="text-xs text-slate-400">
                      <span className="text-slate-300 font-medium">{ing.ingredient_name}</span>
                      <br />
                      {((ing.qty_per_100kg * totalKg) / 100).toFixed(3)} {ing.unit}
                    </div>
                  ))}
                  {r.ingredients.length > 3 && (
                    <div className="text-xs text-slate-600">+{r.ingredients.length - 3} więcej</div>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!selected}
        nextLabel="Uruchom masowanie →"
        nextLoading={isCreating}
        nextVariant="success"
      />
    </div>
  )
}

// ─── Step 4: Ingredients ──────────────────────────────────────

function StepIngredients({ steps, confirmed, onConfirm, confirming, allDone, onNext }: {
  steps: Array<{ stepNo?: number; ingredientName: string; unit: string; qtyRequired: number; is_unlimited: boolean; ingredient_id: string }>
  confirmed: Map<number, number>
  onConfirm: (stepNo: number, qty: number) => void
  confirming: boolean
  allDone: boolean
  onNext: () => void
}) {
  const [qtyInputs, setQtyInputs] = useState<Map<number, string>>(new Map())

  return (
    <div className="animate-slide-in space-y-4">
      <StepHeader icon={<FlaskConical size={20} />} title="Dodaj składniki" />

      <div className="space-y-3">
        {steps.map((s, i) => {
          const stepNo   = i + 1
          const isDone   = confirmed.has(stepNo)
          const inputVal = qtyInputs.get(stepNo) ?? String(s.qtyRequired)

          return (
            <div
              key={s.ingredient_id || i}
              className={cn(
                'flex items-center gap-4 p-4 rounded-xl border-2 transition-all',
                isDone
                  ? 'border-emerald-500/30 bg-emerald-950/20'
                  : 'border-mes-border bg-mes-elevated'
              )}
            >
              {/* Step number */}
              <div className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                isDone ? 'bg-emerald-500 text-white' : 'bg-mes-muted text-slate-400'
              )}>
                {isDone ? <CheckCircle2 size={16} /> : stepNo}
              </div>

              {/* Ingredient info */}
              <div className="flex-1">
                <div className="font-semibold text-white text-sm">{s.ingredientName}</div>
                <div className="text-xs text-slate-500">
                  Wymagane: <span className="text-slate-300 font-mono">
                    {s.qtyRequired.toFixed(3)} {s.unit}
                  </span>
                  {s.is_unlimited && <span className="ml-2 text-cyan-400">(nieograniczone)</span>}
                </div>
              </div>

              {/* Qty input + confirm */}
              {!isDone ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={inputVal}
                    onChange={e => setQtyInputs(prev => new Map(prev).set(stepNo, e.target.value))}
                    className="w-28 h-9 bg-mes-bg border border-mes-border rounded px-2 text-right text-sm text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-mes-accent"
                  />
                  <span className="text-xs text-slate-500 w-8">{s.unit}</span>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => onConfirm(stepNo, Number(inputVal) || s.qtyRequired)}
                    loading={confirming}
                  >
                    <CheckCircle2 size={13} /> OK
                  </Button>
                </div>
              ) : (
                <div className="text-sm text-emerald-400 font-mono tabular-nums">
                  ✓ {confirmed.get(stepNo)?.toFixed(3)} {s.unit}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allDone && (
        <div className="flex justify-end pt-2">
          <Button size="lg" onClick={onNext}>
            Podsumowanie → <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Step 5: Confirm & Finish ─────────────────────────────────

function StepConfirm({ machine, lots, recipe, steps, confirmed, outputKg, onOutputKgChange, onBack, onFinish, isFinishing }: {
  machine: number
  lots: LotSelection[]
  recipe: Recipe
  steps: any[]
  confirmed: Map<number, number>
  outputKg: string
  onOutputKgChange: (v: string) => void
  onBack: () => void
  onFinish: () => void
  isFinishing: boolean
}) {
  const totalInput = lots.reduce((s, l) => s + l.kg, 0)
  const estOutput  = (recipe.total_output_per_100kg * totalInput) / 100

  return (
    <div className="animate-slide-in space-y-4">
      <StepHeader icon={<CheckCircle2 size={20} />} title="Potwierdzenie i zakończenie" />

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Podsumowanie</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Masownica" value={`Nr ${machine}`} />
            <Row label="Receptura"  value={recipe.name} />
            <Row label="Partie mięsa" value={`${lots.length} szt.`} />
            <Row label="Mięso ogółem" value={fmtKg(totalInput)} />
            <Row label="Oczekiwana wydajność" value={`${recipe.total_output_per_100kg}%`} />
            <Row label="Szacowana masa wyjściowa" value={fmtKg(estOutput)} accent />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Partie mięsa użyte</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {lots.map(l => (
              <Row key={l.lot.id} label={l.lot.lot_no} value={fmtKg(l.kg)} />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Masa rzeczywista wyjściowa</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <input
              type="number"
              placeholder={estOutput.toFixed(3)}
              value={outputKg}
              onChange={e => onOutputKgChange(e.target.value)}
              className="w-48 h-11 bg-mes-bg border border-mes-border rounded-lg px-4 text-right text-base text-white tabular-nums focus:outline-none focus:ring-2 focus:ring-mes-accent"
            />
            <span className="text-slate-400">kg</span>
            <span className="text-xs text-slate-600">
              (pozostaw puste aby użyć wartości szacowanej)
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 justify-between pt-2">
        <Button variant="outline" onClick={onBack}>← Wróć</Button>
        <Button size="xl" variant="success" onClick={onFinish} loading={isFinishing}>
          <Send size={18} /> Zakończ i zapisz partię
        </Button>
      </div>
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────

function StepHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="p-2.5 rounded-xl bg-mes-accent/10 ring-1 ring-mes-accent/20 text-mes-accent-l">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
  )
}

function NavButtons({ onBack, onNext, nextDisabled, nextLabel, nextLoading, nextVariant }: {
  onBack:      () => void
  onNext:      () => void
  nextDisabled?: boolean
  nextLabel?:  string
  nextLoading?: boolean
  nextVariant?: 'default' | 'success'
}) {
  return (
    <div className="flex justify-between pt-2">
      <Button variant="outline" onClick={onBack}>← Wróć</Button>
      <Button
        variant={nextVariant || 'default'}
        onClick={onNext}
        disabled={nextDisabled}
        loading={nextLoading}
        size="lg"
      >
        {nextLabel || 'Dalej →'}
      </Button>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cn('font-medium', accent ? 'text-mes-accent-l' : 'text-slate-200')}>
        {value}
      </span>
    </div>
  )
}
