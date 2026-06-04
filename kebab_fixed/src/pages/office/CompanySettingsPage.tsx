/**
 * CompanySettingsPage — Dane firmy (do nagłówka wydruków zamówień).
 */
import { useEffect, useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { settingsApi, type CompanySettings } from '@/lib/apiClient'
import { Save, Building2 } from 'lucide-react'

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
    </div>
  )
}
