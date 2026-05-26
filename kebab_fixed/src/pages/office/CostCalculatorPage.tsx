import { useEffect, useState } from 'react'
import { costApi, type CostParams, type CostWindow, type RecipePriceSummary } from '@/lib/apiClient'
import { cn } from '@/lib/utils'
import { AlertTriangle, Calculator, ChevronDown, ChevronUp, Info, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const WINDOW_OPTIONS: Array<{ key: Exclude<CostWindow, 'all'>; label: string }> = [
  { key: 'today', label: 'Dziś' },
  { key: '7d', label: '7 dni' },
  { key: '30d', label: '30 dni' },
]

const zl = (n: number | null | undefined, dp = 2) =>
  `${Number(n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: dp, maximumFractionDigits: dp })} zł`

const numOrNull = (value: string) => {
  const trimmed = value.trim().replace(',', '.')
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

type DetailWindow = Exclude<CostWindow, 'all'>

interface CostIngredientLine {
  ingredientId: string
  name: string
  unit: string
  qtyPer100kg: number
  unitPrice: number | null
  costPer100kg: number
  missingPrice: boolean
}

interface CostRecipeDetail {
  recipeId: string
  recipeName: string
  productTypeName?: string
  window: DetailWindow
  outputPer100kg: number
  params: {
    quarterPrice: number
    akord: number
    yieldPct: number
    backsPct: number
    bonesPct: number
    backsPrice: number
    bonesPrice: number
    plantPerKg: number
  }
  meatCostPerKg: number
  meatCostPer100kg: number
  ingredients: CostIngredientLine[]
  ingredientsCostPer100kg: number
  plantPerKg: number
  costPerKgBase: number
  hasMissingPrice: boolean
}

interface PriceOverrides {
  meatPrice: string
  ingredientPrices: Record<string, string>
}

function emptyOverrides(): PriceOverrides {
  return { meatPrice: '', ingredientPrices: {} }
}

function detailKey(recipeId: string, window: DetailWindow) {
  return `${recipeId}:${window}`
}

function priceCell(price: { costPerKg: number; hasMissingPrice: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="font-semibold tabular-nums">{zl(price.costPerKg)}</span>
      {price.hasMissingPrice && (
        <span className="text-[10px] font-medium text-amber-700">braki</span>
      )}
    </div>
  )
}

function calculateDetail(detail: CostRecipeDetail, overrides: PriceOverrides) {
  const meatManual = numOrNull(overrides.meatPrice)
  const meatPrice = meatManual ?? detail.meatCostPerKg
  const meatCostPer100kg = meatPrice * 100
  const meatCostPerKgProduct = meatCostPer100kg / (detail.outputPer100kg || 1)

  let ingredientsCostPer100kg = 0
  let hasMissingPrice = false

  const ingredients = detail.ingredients.map((ingredient) => {
    const manual = numOrNull(overrides.ingredientPrices[ingredient.ingredientId] ?? '')
    const effectivePrice = manual ?? ingredient.unitPrice
    const missingPrice = effectivePrice === null || effectivePrice === undefined
    const costPer100kg = missingPrice ? 0 : Number((ingredient.qtyPer100kg * effectivePrice).toFixed(4))
    if (missingPrice) hasMissingPrice = true
    else ingredientsCostPer100kg += costPer100kg
    return {
      ...ingredient,
      manualPrice: overrides.ingredientPrices[ingredient.ingredientId] ?? '',
      effectivePrice: missingPrice ? null : effectivePrice,
      costPer100kg,
      costPerKgProduct: missingPrice ? null : costPer100kg / (detail.outputPer100kg || 1),
      missingPrice,
    }
  })

  const costPerKgBase = ((meatCostPer100kg + ingredientsCostPer100kg) / (detail.outputPer100kg || 1)) + detail.plantPerKg

  return {
    meatPrice,
    meatCostPer100kg,
    meatCostPerKgProduct,
    ingredients,
    ingredientsCostPer100kg,
    costPerKgBase,
    hasMissingPrice,
  }
}

export function CostCalculatorPage() {
  const [summaries, setSummaries] = useState<RecipePriceSummary[]>([])
  const [details, setDetails] = useState<Record<string, CostRecipeDetail>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [activeWindow, setActiveWindow] = useState<Record<string, DetailWindow>>({})
  const [overrides, setOverrides] = useState<Record<string, PriceOverrides>>({})
  const [paramsForm, setParamsForm] = useState({ backsPrice: '', bonesPrice: '', plantPerKg: '' })
  const [loading, setLoading] = useState(true)
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null)
  const [savingParams, setSavingParams] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  async function loadPage() {
    setLoading(true)
    try {
      const [summaryRows, params] = await Promise.all([
        costApi.recipesSummary().catch(() => []),
        costApi.params().catch(() => ({ backsPrice: 0.5, bonesPrice: 0.02, plantPerKg: 2 } as CostParams)),
      ])
      setSummaries(summaryRows)
      setParamsForm({
        backsPrice: String(params.backsPrice ?? 0.5),
        bonesPrice: String(params.bonesPrice ?? 0.02),
        plantPerKg: String(params.plantPerKg ?? 2),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPage()
  }, [])

  async function loadDetail(recipeId: string, window: DetailWindow) {
    const key = detailKey(recipeId, window)
    if (details[key]) return
    setLoadingDetailKey(key)
    try {
      const detail = await costApi.recipeCost(recipeId, { window }) as CostRecipeDetail
      setDetails(prev => ({ ...prev, [key]: detail }))
    } finally {
      setLoadingDetailKey(null)
    }
  }

  async function toggleExpanded(recipeId: string) {
    if (expanded === recipeId) {
      setExpanded(null)
      return
    }
    const window = activeWindow[recipeId] ?? 'today'
    setExpanded(recipeId)
    await loadDetail(recipeId, window)
  }

  async function changeWindow(recipeId: string, window: DetailWindow) {
    setActiveWindow(prev => ({ ...prev, [recipeId]: window }))
    setOverrides(prev => ({ ...prev, [detailKey(recipeId, window)]: emptyOverrides() }))
    await loadDetail(recipeId, window)
  }

  function updateParamField(field: keyof CostParams, value: string) {
    setParamsForm(prev => ({ ...prev, [field]: value }))
  }

  async function saveParams() {
    setSavingParams(true)
    try {
      await costApi.saveParams({
        backsPrice: Number(paramsForm.backsPrice) || 0,
        bonesPrice: Number(paramsForm.bonesPrice) || 0,
        plantPerKg: Number(paramsForm.plantPerKg) || 0,
      })
      setSavedMsg('Zapisano parametry')
      setDetails({})
      setOverrides({})
      await loadPage()
      setTimeout(() => setSavedMsg(''), 2500)
    } finally {
      setSavingParams(false)
    }
  }

  function setMeatOverride(key: string, value: string) {
    setOverrides(prev => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyOverrides()), meatPrice: value, ingredientPrices: { ...(prev[key]?.ingredientPrices ?? {}) } },
    }))
  }

  function setIngredientOverride(key: string, ingredientId: string, value: string) {
    setOverrides(prev => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? emptyOverrides()),
        ingredientPrices: {
          ...(prev[key]?.ingredientPrices ?? {}),
          [ingredientId]: value,
        },
      },
    }))
  }

  function resetOverrides(key: string) {
    setOverrides(prev => ({ ...prev, [key]: emptyOverrides() }))
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Calculator size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Kalkulacja cen</h1>
              <p className="text-sm text-muted-foreground">
                Wszystkie receptury w jednym miejscu. Kolumny pokazują koszt 1 kg wyrobu bez opakowania dla cen z dziś, z ostatnich 7 dni i z ostatnich 30 dni.
              </p>
            </div>
          </div>
          <div className="rounded-xl border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
            Szczegóły i ręczne ceny zobaczysz po rozwinięciu receptury.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Parametry stałe zakładu</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Te wartości wpływają na systemową cenę mięsa i końcową kalkulację każdej receptury.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {savedMsg && <span className="text-xs font-medium text-emerald-600">{savedMsg}</span>}
              <Button size="sm" className="gap-1.5" onClick={saveParams} disabled={savingParams}>
                <Save size={13} /> Zapisz
              </Button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cena grzbietów</Label>
              <Input type="number" step="0.0001" value={paramsForm.backsPrice} onChange={e => updateParamField('backsPrice', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Cena kości</Label>
              <Input type="number" step="0.0001" value={paramsForm.bonesPrice} onChange={e => updateParamField('bonesPrice', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Koszt zakładu / kg</Label>
              <Input type="number" step="0.0001" value={paramsForm.plantPerKg} onChange={e => updateParamField('plantPerKg', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : summaries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Brak aktywnych receptur do wyliczenia.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(120px,0.7fr)_minmax(140px,0.7fr)_minmax(140px,0.7fr)_minmax(140px,0.7fr)_40px] gap-3 border-b bg-surface-2/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <div>Receptura</div>
            <div>Wydajność</div>
            <div className="text-right">Cena dziś</div>
            <div className="text-right">Cena 7 dni</div>
            <div className="text-right">Cena 30 dni</div>
            <div />
          </div>

          {summaries.map(summary => {
            const window = activeWindow[summary.recipeId] ?? 'today'
            const key = detailKey(summary.recipeId, window)
            const detail = details[key]
            const calc = detail ? calculateDetail(detail, overrides[key] ?? emptyOverrides()) : null
            const isExpanded = expanded === summary.recipeId
            const isLoadingDetail = loadingDetailKey === key

            return (
              <div key={summary.recipeId} className="border-b last:border-b-0">
                <button
                  type="button"
                  className="grid w-full grid-cols-[minmax(0,1.7fr)_minmax(120px,0.7fr)_minmax(140px,0.7fr)_minmax(140px,0.7fr)_minmax(140px,0.7fr)_40px] gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/40"
                  onClick={() => toggleExpanded(summary.recipeId)}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{summary.recipeName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {summary.productTypeName || 'Bez przypisanego rodzaju produktu'}
                    </div>
                  </div>
                  <div className="self-center text-sm font-medium tabular-nums">{summary.totalOutputPer100kg} kg</div>
                  <div className="self-center text-right">{priceCell(summary.prices.today)}</div>
                  <div className="self-center text-right">{priceCell(summary.prices['7d'])}</div>
                  <div className="self-center text-right">{priceCell(summary.prices['30d'])}</div>
                  <div className="self-center justify-self-end text-muted-foreground">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="bg-surface-2/25 px-4 pb-4 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <div>
                        <h3 className="text-sm font-semibold">Szczegółowa kalkulacja</h3>
                        <p className="text-xs text-muted-foreground">
                          Zakres cen: {WINDOW_OPTIONS.find(item => item.key === window)?.label}. Jeśli wpiszesz swoją cenę, zastąpi ona wartość z systemu tylko w tym podglądzie.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {WINDOW_OPTIONS.map(option => (
                          <Button
                            key={option.key}
                            type="button"
                            size="sm"
                            variant={window === option.key ? 'default' : 'outline'}
                            className="h-8"
                            onClick={() => changeWindow(summary.recipeId, option.key)}
                          >
                            {option.label}
                          </Button>
                        ))}
                        <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => resetOverrides(key)}>
                          <RotateCcw size={12} /> Systemowe
                        </Button>
                      </div>
                    </div>

                    {isLoadingDetail && !detail ? (
                      <div className="space-y-2 py-4">
                        <Skeleton className="h-12 w-full" />
                        <Skeleton className="h-56 w-full" />
                      </div>
                    ) : detail && calc ? (
                      <div className="space-y-4 pt-4">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-xl border bg-background px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cena końcowa / kg</div>
                            <div className="mt-1 text-2xl font-black text-primary tabular-nums">{zl(calc.costPerKgBase)}</div>
                          </div>
                          <div className="rounded-xl border bg-background px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mięso / 100 kg</div>
                            <div className="mt-1 text-lg font-bold tabular-nums">{zl(calc.meatCostPer100kg)}</div>
                          </div>
                          <div className="rounded-xl border bg-background px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Dodatki / 100 kg</div>
                            <div className="mt-1 text-lg font-bold tabular-nums">{zl(calc.ingredientsCostPer100kg)}</div>
                          </div>
                          <div className="rounded-xl border bg-background px-3 py-2">
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Koszt zakładu / kg</div>
                            <div className="mt-1 text-lg font-bold tabular-nums">{zl(detail.plantPerKg)}</div>
                          </div>
                        </div>

                        <div className="rounded-xl border bg-background">
                          <div className="border-b px-4 py-3">
                            <div className="text-sm font-semibold">Ceny wejściowe</div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Kolumna „Twoja cena” jest opcjonalna. Puste pole oznacza użycie ceny systemowej.
                            </p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[860px] text-sm">
                              <thead className="bg-surface-2/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-2 text-left">Pozycja</th>
                                  <th className="px-4 py-2 text-right">Ilość / 100 kg</th>
                                  <th className="px-4 py-2 text-right">Cena systemowa</th>
                                  <th className="px-4 py-2 text-right">Twoja cena</th>
                                  <th className="px-4 py-2 text-right">Koszt / 100 kg</th>
                                  <th className="px-4 py-2 text-right">Koszt / kg wyrobu</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t">
                                  <td className="px-4 py-3 font-semibold">Mięso</td>
                                  <td className="px-4 py-3 text-right tabular-nums">100 kg</td>
                                  <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">{zl(detail.meatCostPerKg, 4)}/kg</td>
                                  <td className="px-4 py-3">
                                    <Input
                                      type="number"
                                      step="0.0001"
                                      value={(overrides[key] ?? emptyOverrides()).meatPrice}
                                      onChange={e => setMeatOverride(key, e.target.value)}
                                      placeholder={detail.meatCostPerKg.toFixed(4)}
                                      className="h-8 text-right"
                                    />
                                  </td>
                                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{zl(calc.meatCostPer100kg)}</td>
                                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{zl(calc.meatCostPerKgProduct)}</td>
                                </tr>

                                {calc.ingredients.map(ingredient => (
                                  <tr key={ingredient.ingredientId} className={cn('border-t', ingredient.missingPrice && 'bg-amber-50/50')}>
                                    <td className="px-4 py-3">
                                      <div className="font-medium">{ingredient.name}</div>
                                      <div className="text-xs text-muted-foreground">{ingredient.unit}</div>
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums">
                                      {ingredient.qtyPer100kg} {ingredient.unit}
                                    </td>
                                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                                      {ingredient.unitPrice == null ? '—' : `${zl(ingredient.unitPrice, 4)}/${ingredient.unit}`}
                                    </td>
                                    <td className="px-4 py-3">
                                      <Input
                                        type="number"
                                        step="0.0001"
                                        value={(overrides[key] ?? emptyOverrides()).ingredientPrices[ingredient.ingredientId] ?? ''}
                                        onChange={e => setIngredientOverride(key, ingredient.ingredientId, e.target.value)}
                                        placeholder={ingredient.unitPrice == null ? '' : ingredient.unitPrice.toFixed(4)}
                                        className="h-8 text-right"
                                      />
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                                      {ingredient.missingPrice ? '—' : zl(ingredient.costPer100kg)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                                      {ingredient.costPerKgProduct == null ? '—' : zl(ingredient.costPerKgProduct)}
                                    </td>
                                  </tr>
                                ))}

                                <tr className="border-t bg-surface-2/40">
                                  <td className="px-4 py-3 font-bold">Koszt 1 kg wyrobu</td>
                                  <td className="px-4 py-3 text-right text-xs text-muted-foreground" colSpan={4}>
                                    Wsad / {detail.outputPer100kg} kg + koszt zakładu
                                  </td>
                                  <td className="px-4 py-3 text-right text-base font-black text-primary tabular-nums">{zl(calc.costPerKgBase)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="rounded-xl border bg-background p-4">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <Info size={14} className="text-primary" />
                              Źródło systemowej ceny mięsa
                            </div>
                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cena ćwiartki</div>
                                <div className="mt-1 font-semibold tabular-nums">{zl(detail.params.quarterPrice, 4)}/kg</div>
                              </div>
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Akord rozbioru</div>
                                <div className="mt-1 font-semibold tabular-nums">{zl(detail.params.akord, 4)}/kg</div>
                              </div>
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Uzysk</div>
                                <div className="mt-1 font-semibold tabular-nums">{detail.params.yieldPct.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%</div>
                              </div>
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Grzbiety w ćwiartce</div>
                                <div className="mt-1 font-semibold tabular-nums">{detail.params.backsPct.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%</div>
                              </div>
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Kości w ćwiartce</div>
                                <div className="mt-1 font-semibold tabular-nums">{detail.params.bonesPct.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%</div>
                              </div>
                              <div className="rounded-lg border px-3 py-2">
                                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Koszt zakładu</div>
                                <div className="mt-1 font-semibold tabular-nums">{zl(detail.params.plantPerKg, 4)}/kg</div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border bg-background p-4">
                            <div className="text-sm font-semibold">Uwagi do kalkulacji</div>
                            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                              <p>Mięso liczone jest systemowo z ceny ćwiartki, akordu, uzysku oraz odjęcia wartości grzbietów i kości.</p>
                              <p>Dodatki korzystają z cen zakupu z wybranego zakresu dat, a gdy ich brakuje, kalkulacja sygnalizuje niedoliczenie.</p>
                              <p>Ręczna cena działa tylko w tym rozwiniętym podglądzie i nie zapisuje się do bazy.</p>
                            </div>
                            {calc.hasMissingPrice && (
                              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>Brakuje cen dla części dodatków. Pozycje bez ceny nie są doliczane do wyniku.</span>
                              </div>
                            )}
                            {!calc.hasMissingPrice && (
                              <Badge variant="outline" className="mt-3 border-emerald-200 bg-emerald-50 text-emerald-700">
                                Wszystkie użyte ceny są dostępne w systemie
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
