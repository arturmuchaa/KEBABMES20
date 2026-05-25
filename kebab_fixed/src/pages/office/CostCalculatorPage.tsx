/**
 * CostCalculatorPage — kalkulacja kosztu 1 kg wyrobu wg receptury.
 *
 * Hybryda: średnie z realnych danych podstawiane jako domyślne, każde pole nadpisywalne.
 * Ceny składników/opakowań z ostatniej faktury (FZ). Brak ceny → pozycja oznaczona
 * i NIEDOLICZONA. Parametry zakładu/odpadów zapisywane w ustawieniach (app_settings).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { recipesApi, packagingApi, costApi, type CostParams } from '@/lib/apiClient'
import { cn } from '@/lib/utils'
import { Calculator, AlertTriangle, Save, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const zl = (n: number | null | undefined, dp = 2) =>
  (Number(n ?? 0)).toLocaleString('pl-PL', { minimumFractionDigits: dp, maximumFractionDigits: dp }) + ' zł'

interface Overrides {
  quarterPrice: string; akord: string; yieldPct: string
  backsPct: string; bonesPct: string
  backsPrice: string; bonesPrice: string; plantPerKg: string
}

const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s))

export function CostCalculatorPage() {
  const [recipes, setRecipes] = useState<any[]>([])
  const [packaging, setPackaging] = useState<any[]>([])
  const [recipeId, setRecipeId] = useState('')
  const [ov, setOv] = useState<Overrides | null>(null)
  const [pkgIds, setPkgIds] = useState<string[]>([])
  const [kgPerUnit, setKgPerUnit] = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  // Wczytanie słowników + podstawienie średnich/parametrów
  useEffect(() => {
    (async () => {
      const [recs, pkgs, avg, params] = await Promise.all([
        recipesApi.list().catch(() => []),
        packagingApi.list().catch(() => []),
        costApi.averages().catch(() => ({} as Record<string, number>)),
        costApi.params().catch(() => ({ backsPrice: 0.5, bonesPrice: 0.02, plantPerKg: 2 } as CostParams)),
      ])
      setRecipes(recs as any[])
      setPackaging(pkgs as any[])
      setOv({
        quarterPrice: String(avg.quarterPrice ?? ''),
        akord:        String(avg.akord ?? ''),
        yieldPct:     String(avg.yieldPct ?? ''),
        backsPct:     String(avg.backsPct ?? ''),
        bonesPct:     String(avg.bonesPct ?? ''),
        backsPrice:   String(params.backsPrice ?? 0.5),
        bonesPrice:   String(params.bonesPrice ?? 0.02),
        plantPerKg:   String(params.plantPerKg ?? 2),
      })
      if ((recs as any[]).length) setRecipeId((recs as any[])[0].id)
    })()
  }, [])

  // Przeliczenie (debounce) przy zmianie receptury/parametrów/opakowań
  useEffect(() => {
    if (!recipeId || !ov) return
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const q: Record<string, unknown> = {
          quarterPrice: numOrUndef(ov.quarterPrice),
          akord:        numOrUndef(ov.akord),
          yieldPct:     numOrUndef(ov.yieldPct),
          backsPct:     numOrUndef(ov.backsPct),
          bonesPct:     numOrUndef(ov.bonesPct),
          backsPrice:   numOrUndef(ov.backsPrice),
          bonesPrice:   numOrUndef(ov.bonesPrice),
          plantPerKg:   numOrUndef(ov.plantPerKg),
          packagingIds: pkgIds.length ? pkgIds : undefined,
          kgPerUnit:    numOrUndef(kgPerUnit),
        }
        setResult(await costApi.recipeCost(recipeId, q))
      } finally {
        setLoading(false)
      }
    }, 350)
    return () => clearTimeout(debounce.current)
  }, [recipeId, ov, pkgIds, kgPerUnit])

  const setField = (k: keyof Overrides, v: string) => setOv(p => (p ? { ...p, [k]: v } : p))

  async function saveParams() {
    if (!ov) return
    await costApi.saveParams({
      backsPrice: Number(ov.backsPrice) || 0,
      bonesPrice: Number(ov.bonesPrice) || 0,
      plantPerKg: Number(ov.plantPerKg) || 0,
    })
    setSavedMsg('Zapisano parametry'); setTimeout(() => setSavedMsg(''), 2500)
  }

  const togglePkg = (id: string) =>
    setPkgIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const totalWithPkg = result?.costPerKgWithPackaging ?? 0
  const hasPkg = pkgIds.length > 0 && Number(kgPerUnit) > 0

  const field = (label: string, k: keyof Overrides, suffix?: string) => (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input type="number" step="0.0001" value={ov?.[k] ?? ''} onChange={e => setField(k, e.target.value)} className="h-8 text-sm pr-8" />
        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  )

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Toolbar: wybór receptury + wynik */}
      <Card>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Calculator size={18} className="text-primary" />
            <div className="w-72">
              <Select value={recipeId} onValueChange={setRecipeId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Wybierz recepturę..." /></SelectTrigger>
                <SelectContent>
                  {recipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {result && (
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Koszt 1 kg {hasPkg ? '(z opakowaniem)' : '(bez opakowania)'}</div>
              <div className="text-3xl font-black text-primary tabular-nums">{zl(totalWithPkg)}</div>
              {loading && <div className="text-[10px] text-muted-foreground">przeliczanie…</div>}
            </div>
          )}
        </div>
      </Card>

      {/* Parametry (hybryda: średnie + nadpisanie) */}
      {ov && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Parametry (średnie z danych — możesz nadpisać)</h3>
              <div className="flex items-center gap-2">
                {savedMsg && <span className="text-[11px] text-emerald-600 font-medium">{savedMsg}</span>}
                <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={saveParams} title="Zapisz ceny odpadów i koszt zakładu na stałe">
                  <Save size={12} /> Zapisz parametry zakładu
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field('Cena ćwiartki', 'quarterPrice', 'zł/kg')}
              {field('Akord rozbioru', 'akord', 'zł/kg ćw.')}
              {field('Uzysk', 'yieldPct', '%')}
              {field('Grzbiety w ćwiartce', 'backsPct', '%')}
              {field('Kości w ćwiartce', 'bonesPct', '%')}
              {field('Cena grzbietów', 'backsPrice', 'zł/kg')}
              {field('Cena kości', 'bonesPrice', 'zł/kg')}
              {field('Koszt zakładu', 'plantPerKg', 'zł/kg')}
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Info size={12} /> „Zapisz parametry zakładu" utrwala ceny grzbietów/kości i koszt zakładu. Pozostałe pola to nadpisania jednorazowe dla tej kalkulacji.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Rozbicie kosztu */}
      {result && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm tabular-nums">
              <tbody>
                <tr className="border-b border-surface-3">
                  <td className="px-4 py-2.5 font-medium">Mięso z rozbioru <span className="text-muted-foreground text-xs">(po uzysku, z akordem, − odpady)</span></td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{zl(result.meatCostPerKg, 4)}/kg mięsa · {zl(result.meatCostPer100kg)}/100kg</td>
                  <td className="px-4 py-2.5 text-right font-semibold w-32">{zl((result.meatCostPer100kg) / (result.outputPer100kg || 1))}/kg</td>
                </tr>

                {/* Składniki */}
                <tr className="bg-surface-2/40 border-b border-surface-3">
                  <td colSpan={3} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    Przyprawy / bindingi wg receptury (na 100 kg mięsa → /{result.outputPer100kg} kg wyrobu)
                  </td>
                </tr>
                {result.ingredients.map((ing: any) => (
                  <tr key={ing.ingredientId} className={cn('border-b border-surface-3', ing.missingPrice && 'bg-red-50/50')}>
                    <td className="px-4 py-2 pl-8">
                      {ing.name} <span className="text-muted-foreground text-xs">· {ing.qtyPer100kg} {ing.unit}/100kg</span>
                      {ing.missingPrice && (
                        <Badge variant="outline" className="ml-2 text-[10px] gap-1 bg-red-50 text-red-700 border-red-200">
                          <AlertTriangle size={10} /> brak ceny — niedoliczone
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                      {ing.missingPrice ? '—' : `${zl(ing.unitPrice, 2)}/${ing.unit} · ${zl(ing.costPer100kg)}/100kg`}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {ing.missingPrice ? <span className="text-red-600">—</span> : `${zl(ing.costPer100kg / (result.outputPer100kg || 1))}/kg`}
                    </td>
                  </tr>
                ))}

                <tr className="border-b border-surface-3">
                  <td className="px-4 py-2.5 font-medium">Koszt zakładu</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">stały parametr</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{zl(result.plantPerKg)}/kg</td>
                </tr>

                {/* Suma bez opakowań */}
                <tr className="border-b-2 border-surface-4 bg-surface-2/60">
                  <td className="px-4 py-2.5 font-bold">Koszt 1 kg wyrobu (bez opakowania)</td>
                  <td />
                  <td className="px-4 py-2.5 text-right font-black text-primary text-base">{zl(result.costPerKgBase)}/kg</td>
                </tr>

                {/* Opakowania */}
                {hasPkg && result.packaging?.map((p: any) => (
                  <tr key={p.packagingId} className={cn('border-b border-surface-3', p.missingPrice && 'bg-red-50/50')}>
                    <td className="px-4 py-2 pl-8">
                      Opakowanie: {p.name}
                      {p.missingPrice && (
                        <Badge variant="outline" className="ml-2 text-[10px] gap-1 bg-red-50 text-red-700 border-red-200">
                          <AlertTriangle size={10} /> brak ceny
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground text-xs">{p.missingPrice ? '—' : `${zl(p.unitPrice)}/szt`}</td>
                    <td className="px-4 py-2 text-right font-medium">{p.missingPrice ? '—' : `${zl((p.unitPrice) / (Number(kgPerUnit) || 1))}/kg`}</td>
                  </tr>
                ))}
                {hasPkg && (
                  <tr className="border-b-2 border-surface-4 bg-emerald-50/40">
                    <td className="px-4 py-2.5 font-bold">Koszt 1 kg wyrobu (z opakowaniem)</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">+ {zl(result.packagingPerKg)}/kg opak.</td>
                    <td className="px-4 py-2.5 text-right font-black text-emerald-700 text-base">{zl(result.costPerKgWithPackaging)}/kg</td>
                  </tr>
                )}
              </tbody>
            </table>

            {result.hasMissingPrice && (
              <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Niektóre pozycje nie mają ceny w fakturach (FZ) i nie zostały doliczone — koszt jest zaniżony. Dodaj fakturę zakupu z ceną dla tych pozycji.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Opakowania — wybór */}
      {ov && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Opakowania (opcjonalnie — doliczane do kosztu/kg)</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Rozmiar (kg na sztukę)</Label>
                <Input type="number" step="0.1" value={kgPerUnit} onChange={e => setKgPerUnit(e.target.value)} placeholder="np. 40" className="h-8 w-32 text-sm" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {packaging.map(p => (
                  <button
                    key={p.id}
                    onClick={() => togglePkg(p.id)}
                    className={cn(
                      'px-2.5 py-1 rounded border text-xs font-medium transition-colors',
                      pkgIds.includes(p.id) ? 'bg-primary text-white border-primary' : 'border-surface-4 hover:bg-surface-2',
                    )}
                  >
                    {p.name}
                  </button>
                ))}
                {packaging.length === 0 && <span className="text-xs text-muted-foreground">Brak zdefiniowanych opakowań</span>}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Koszt opakowania/kg = suma cen wybranych opakowań (z FZ) ÷ rozmiar (kg/szt).</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
