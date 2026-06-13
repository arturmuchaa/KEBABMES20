/**
 * MixingDayPlanEditor — plan dnia masowania (jedno zalecenie, kilka receptur).
 *
 * Biuro układa kolejkę 1→n (np. 1. Gold 2000 kg, 2. Gold2 2000, 3. Beyaz 3000);
 * operator widzi CAŁY plan na panelu i jedzie po kolei. Plan można edytować
 * w ciągu dnia — pozycje już w masownicy (in_progress) i gotowe (done) są
 * zablokowane (tylko kolejność), pozycje w kolejce można zmieniać/usuwać.
 * Zapis = PUT /api/mixing-orders/day-plan; panel operatora wykrywa zmianę (rev).
 */
import { useEffect, useMemo, useState } from 'react'
import { mixingOrdersApi } from '@/lib/apiClient'
import { useRecipes } from '@/features/ingredients/hooks'
import { fmtKg } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowDown, ArrowUp, CalendarDays, Loader2, Plus, Save, Trash2,
} from 'lucide-react'

interface PlanRow {
  id?:        string
  recipeId:   string
  meatKg:     string
  status:     string   // 'new' | planned | confirmed | in_progress | done
  orderNo?:   string
  kgDone?:    number
}

const ROW_STATUS: Record<string, { label: string; cls: string }> = {
  new:         { label: 'nowa',         cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  planned:     { label: 'w kolejce',    cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  confirmed:   { label: 'w kolejce',    cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  in_progress: { label: 'w masownicy',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  done:        { label: 'gotowe',       cls: 'bg-green-50 text-green-700 border-green-200' },
}

export function MixingDayPlanEditor({ onSaved }: { onSaved?: () => void }) {
  const { recipes } = useRecipes()
  const [rows,    setRows]    = useState<PlanRow[]>([])
  const [loaded,  setLoaded]  = useState(false)
  const [dirty,   setDirty]   = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function load() {
    try {
      const r = await mixingOrdersApi.dayPlan()
      setRows((r.items ?? []).map((o: any) => ({
        id: o.id, recipeId: o.recipeId, meatKg: String(o.meatKg),
        status: o.status, orderNo: o.orderNo, kgDone: o.kgDone,
      })))
      setLoaded(true)
      setDirty(false)
    } catch { setLoaded(true) }
  }

  useEffect(() => {
    load()
    // Odśwież co 15 s, ale nie nadpisuj edycji w toku
    const t = setInterval(() => { if (!dirty) load() }, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const locked = (r: PlanRow) => r.status === 'in_progress' || r.status === 'done'

  function move(idx: number, dir: -1 | 1) {
    setRows(p => {
      const n = [...p]
      const j = idx + dir
      if (j < 0 || j >= n.length) return p
      ;[n[idx], n[j]] = [n[j], n[idx]]
      return n
    })
    setDirty(true)
  }

  function update(idx: number, patch: Partial<PlanRow>) {
    setRows(p => p.map((r, i) => i === idx ? { ...r, ...patch } : r))
    setDirty(true)
  }

  async function save() {
    setError('')
    const valid = rows.filter(r => r.recipeId && parseFloat(r.meatKg) > 0)
    if (valid.length !== rows.length) {
      setError('Każda pozycja musi mieć recepturę i kg > 0')
      return
    }
    setSaving(true)
    try {
      await mixingOrdersApi.saveDayPlan(rows.map((r, i) => ({
        id: r.id, recipeId: r.recipeId, meatKg: parseFloat(r.meatKg), seq: i + 1,
      })))
      await load()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu planu')
    } finally {
      setSaving(false)
    }
  }

  const totalKg = useMemo(
    () => rows.reduce((s, r) => s + (parseFloat(r.meatKg) || 0), 0), [rows])

  return (
    <Card className="overflow-hidden border-violet-200">
      <div className="px-4 py-2.5 bg-violet-50/60 border-b border-violet-200 flex items-center gap-2">
        <CalendarDays size={14} className="text-violet-600"/>
        <span className="text-[12px] font-bold text-violet-800 uppercase tracking-wide">
          Plan dnia masowania
        </span>
        <span className="text-[11px] text-violet-700">
          operator jedzie po kolei 1 → {Math.max(rows.length, 1)}
        </span>
        <span className="ml-auto text-[12px] font-black text-violet-700">
          {fmtKg(totalKg, 0)} kg
        </span>
      </div>

      <div className="p-3 space-y-2">
        {!loaded ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center">Wczytuję…</div>
        ) : rows.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center border border-dashed rounded-lg">
            Brak planu na dziś — dodaj pierwszą pozycję
          </div>
        ) : (
          rows.map((r, i) => {
            const st = ROW_STATUS[r.status] ?? ROW_STATUS.new
            const isLocked = locked(r)
            return (
              <div key={r.id ?? `new-${i}`}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                  isLocked ? 'bg-muted/40' : 'bg-white'}`}>
                <span className="w-6 text-center text-sm font-black text-violet-700 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <Select value={r.recipeId || '__none'} disabled={isLocked}
                    onValueChange={v => update(i, { recipeId: v === '__none' ? '' : v })}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Receptura..."/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Receptura...</SelectItem>
                      {(recipes ?? []).map((rc: any) => (
                        <SelectItem key={rc.id} value={rc.id}>{rc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1 w-28 flex-shrink-0">
                  <Input type="number" min="1" step="10" value={r.meatKg} disabled={isLocked}
                    onChange={e => update(i, { meatKg: e.target.value })}
                    className="h-8 text-[13px] font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                  <span className="text-[10px] text-muted-foreground">kg</span>
                </div>
                <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${st.cls}`}>
                  {st.label}{r.status === 'in_progress' && r.kgDone ? ` · ${fmtKg(r.kgDone, 0)} kg` : ''}
                </Badge>
                <div className="flex flex-col flex-shrink-0 gap-0.5">
                  <button onClick={() => move(i, -1)} disabled={i === 0}
                    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer text-muted-foreground hover:text-ink hover:bg-muted/60 disabled:opacity-20 disabled:cursor-not-allowed">
                    <ArrowUp size={14}/>
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer text-muted-foreground hover:text-ink hover:bg-muted/60 disabled:opacity-20 disabled:cursor-not-allowed">
                    <ArrowDown size={14}/>
                  </button>
                </div>
                <button
                  onClick={() => { setRows(p => p.filter((_, j) => j !== i)); setDirty(true) }}
                  disabled={isLocked}
                  title={isLocked ? 'Pozycja w masownicy/gotowa — nie można usunąć' : 'Usuń z planu'}
                  className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-20 flex-shrink-0">
                  <Trash2 size={13}/>
                </button>
              </div>
            )
          })
        )}

        {error && (
          <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-[12px]"
            onClick={() => { setRows(p => [...p, { recipeId: '', meatKg: '100', status: 'new' }]); setDirty(true) }}>
            <Plus size={13}/> Dodaj pozycję
          </Button>
          <Button size="sm" disabled={saving || !dirty}
            onClick={save}
            className="h-8 gap-1.5 text-[12px] ml-auto bg-violet-600 hover:bg-violet-700">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
            {dirty ? 'Zapisz plan (operator zobaczy zmianę)' : 'Plan zapisany'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
