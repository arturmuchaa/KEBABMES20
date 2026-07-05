/**
 * CompanySettingsPage — Dane firmy (do nagłówka wydruków zamówień).
 */
import { useEffect, useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { settingsApi, type CompanySettings } from '@/lib/apiClient'
import { Save, Building2, Percent, Scale, Plus, Trash2 } from 'lucide-react'

import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'

const emptyCompany: CompanySettings = {
  name: '', nip: '', regon: '', address: '', city: '', postalCode: '', phone: '', email: '',
  vetNumber: '', marketDomestic: true, marketEu: true, loadPlace: '',
}

export function CompanySettingsPage() {
  const { data, loading, refetch } = useApi(() => settingsApi.getCompany())
  const { mutate, loading: saving } = useMutation((dto: CompanySettings) => settingsApi.saveCompany(dto))

  const [form, setForm] = useState<CompanySettings>(emptyCompany)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (data) setForm(data) }, [data])

  // ── Wydajność rozbioru (planowanie zapotrzebowania na surowiec) ──
  const { data: yieldData, refetch: refetchYield } = useApi(() => settingsApi.getDeboningYield())
  const { mutate: saveYield, loading: savingYield } = useMutation((p: number) => settingsApi.saveDeboningYield(p))
  const [yieldPct, setYieldPct] = useState('')
  const [yieldSaved, setYieldSaved] = useState(false)
  const [yieldErr, setYieldErr] = useState('')

  useEffect(() => { if (yieldData != null) setYieldPct(String(yieldData)) }, [yieldData])

  // ── Wózki rozbioru (tary do ważenia RS232 na HMI) ──
  const { data: taresData, refetch: refetchTares } = useApi(() => settingsApi.getCartTares())
  const { mutate: putTares, loading: savingTares } = useMutation((t: number[]) => settingsApi.saveCartTares(t))
  const [tares, setTares] = useState<string[]>([])
  const [taresSaved, setTaresSaved] = useState(false)
  const [taresErr, setTaresErr] = useState('')

  useEffect(() => { if (taresData) setTares(taresData.map(t => String(t))) }, [taresData])

  function setTare(i: number, v: string) {
    setTares(p => p.map((t, j) => (j === i ? v : t)))
    setTaresSaved(false); setTaresErr('')
  }

  async function handleSaveTares() {
    const nums = tares.filter(t => t.trim() !== '').map(t => parseFloat(t.replace(',', '.')))
    if (nums.length === 0) { setTaresErr('Dodaj przynajmniej jeden wózek'); return }
    if (nums.some(n => !(n > 0 && n <= 50))) { setTaresErr('Każda tara musi być liczbą z zakresu 0–50 kg'); return }
    setTaresErr('')
    try {
      await putTares(nums)
      setTaresSaved(true)
      refetchTares()
    } catch (e: any) {
      setTaresErr(e?.message || 'Nie udało się zapisać')
    }
  }

  async function handleSaveYield() {
    const v = parseFloat(yieldPct.replace(',', '.'))
    if (!(v > 0 && v <= 100)) { setYieldErr('Podaj wartość z zakresu 0–100%'); return }
    setYieldErr('')
    await saveYield(v)
    setYieldSaved(true)
    refetchYield()
  }

  function set<K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) {
    setForm(p => ({ ...p, [k]: v }))
    setSaved(false)
  }

  async function handleSave() {
    await mutate(form)
    setSaved(true)
    refetch()
  }

  if (loading) {
    return <div className="space-y-3"><Skeleton className="h-7 w-64" /><Skeleton className="h-72 w-full" /></div>
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Building2 size={18} />
          </div>
          <div>
            <CardTitle>Dane firmy</CardTitle>
            <CardDescription>
              Te dane pojawią się w nagłówku wydruku zamówienia.
            </CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: 'name',       label: 'Nazwa firmy *',  ph: 'Twoja Firma Sp. z o.o.' },
              { k: 'nip',        label: 'NIP',            ph: '1234567890' },
              { k: 'regon',      label: 'REGON',          ph: '123456789' },
              { k: 'phone',      label: 'Telefon',        ph: '+48 123 456 789' },
              { k: 'email',      label: 'E-mail',         ph: 'biuro@firma.pl' },
              { k: 'postalCode', label: 'Kod pocztowy',   ph: '00-001' },
              { k: 'city',       label: 'Miasto',         ph: 'Warszawa' },
              { k: 'address',    label: 'Ulica i numer',  ph: 'ul. Przykładowa 1' },
            ].map(f => (
              <div key={f.k} className="space-y-1.5">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  value={(form as any)[f.k] ?? ''}
                  onChange={e => set(f.k as keyof CompanySettings, e.target.value)}
                  placeholder={f.ph}
                />
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Dane do HDI</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Weterynaryjny nr identyfikacyjny</Label>
                <Input value={form.vetNumber ?? ''} onChange={e => set('vetNumber', e.target.value)} placeholder="PL 12060602WE" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Miejsce załadunku <span className="text-slate-400">(puste = adres firmy)</span></Label>
                <Input value={form.loadPlace ?? ''} onChange={e => set('loadPlace', e.target.value)} placeholder="ul. … , 00-001 Miasto" />
              </div>
            </div>
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.marketDomestic} onChange={e => set('marketDomestic', e.target.checked)} /> Rynek krajowy
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!form.marketEu} onChange={e => set('marketEu', e.target.checked)} /> Unia Europejska
              </label>
            </div>
          </div>

          <Separator />

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="gap-2">
              {saving
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save size={14} />
              }
              Zapisz dane firmy
            </Button>
            {saved && (
              <CardDescription className="text-green-700 text-sm">
                ✓ Zapisano. Otwórz wydruk zamówienia aby zobaczyć efekt.
              </CardDescription>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <Percent size={18} />
          </div>
          <div>
            <CardTitle>Wydajność rozbioru</CardTitle>
            <CardDescription>
              Używana do planowania zapotrzebowania na ćwiartkę (ile ćwiartki na mięso z/s).
              Domyślnie liczona ze średniej historycznej rozbiorów.
            </CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5 w-40">
              <Label className="text-xs">Wydajność (%)</Label>
              <Input
                type="number" min="1" max="100" step="0.1"
                value={yieldPct}
                onChange={e => { setYieldPct(e.target.value); setYieldSaved(false); setYieldErr('') }}
                placeholder="70"
              />
            </div>
            <Button onClick={handleSaveYield} disabled={savingYield} className="gap-2">
              {savingYield
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save size={14} />
              }
              Zapisz wydajność
            </Button>
            {yieldSaved && <CardDescription className="text-green-700 text-sm">✓ Zapisano</CardDescription>}
            {yieldErr && <CardDescription className="text-destructive text-sm">{yieldErr}</CardDescription>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tylko planowanie — nie wpływa na faktyczny rozbiór ani stany magazynowe.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Scale size={18} />
          </div>
          <div>
            <CardTitle>Wózki rozbioru — tary do ważenia</CardTitle>
            <CardDescription>
              Lista wag wózków (kg), którą panel rozbioru pokazuje jako kafle przy ważeniu
              automatycznym. Panel sortuje je od najlżejszego; opcja „bez wózka" jest zawsze.
            </CardDescription>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            {tares.map((t, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input
                  type="number" min="0.1" max="50" step="0.1"
                  className="w-24"
                  value={t}
                  onChange={e => setTare(i, e.target.value)}
                  placeholder="5.5"
                />
                <Button variant="ghost" size="icon" className="text-slate-400 hover:text-destructive"
                  onClick={() => { setTares(p => p.filter((_, j) => j !== i)); setTaresSaved(false) }}
                  title="Usuń wózek">
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="gap-1.5"
              onClick={() => { setTares(p => [...p, '']); setTaresSaved(false) }}>
              <Plus size={14} /> Dodaj wózek
            </Button>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleSaveTares} disabled={savingTares} className="gap-2">
              {savingTares
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save size={14} />
              }
              Zapisz wózki
            </Button>
            {taresSaved && <CardDescription className="text-green-700 text-sm">✓ Zapisano — panel zobaczy zmianę od razu</CardDescription>}
            {taresErr && <CardDescription className="text-destructive text-sm">{taresErr}</CardDescription>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Duplikaty i kolejność ogarnia system — zapisze posortowaną listę bez powtórzeń (zaokrągloną do 0,1 kg).
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
