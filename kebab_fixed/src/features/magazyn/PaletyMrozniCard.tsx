/**
 * Biuro → Ustawienia firmy: palety do ważenia przy wjeździe do mroźni.
 *
 * Każda pozycja: nazwa, tara od–do (widełki, bo palet nie waży się sztuka po
 * sztuce) i zapas % netto (tuleje, folia, działka wagi). Kiosk magazynu
 * pokazuje je jako kafle przy ważeniu pełnego kartonu.
 */
import { useEffect, useState } from 'react'
import { Plus, Save, Snowflake, Trash2 } from 'lucide-react'
import { magazynApi, type PaletaMrozni } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface Wiersz { id: string; name: string; tareMinKg: string; tareMaxKg: string; marginPct: string }

const naWiersz = (p: PaletaMrozni): Wiersz => ({
  id: p.id, name: p.name, tareMinKg: String(p.tareMinKg), tareMaxKg: String(p.tareMaxKg), marginPct: String(p.marginPct),
})
const liczba = (v: string) => Number(String(v).replace(',', '.'))

export function PaletyMrozniCard() {
  const [wiersze, setWiersze] = useState<Wiersz[]>([])
  const [zapis, setZapis] = useState(false)
  const [ok, setOk] = useState(false)
  const [blad, setBlad] = useState('')

  useEffect(() => {
    magazynApi.paletyMrozni().then(p => setWiersze(p.map(naWiersz))).catch(e => setBlad(e?.message || 'Nie udało się wczytać palet'))
  }, [])

  function zmien(i: number, pole: keyof Wiersz, v: string) {
    setWiersze(w => w.map((x, j) => (j === i ? { ...x, [pole]: v } : x)))
    setOk(false); setBlad('')
  }

  async function zapisz() {
    const lista = wiersze.filter(w => w.name.trim())
    for (const w of lista) {
      const od = liczba(w.tareMinKg), doo = liczba(w.tareMaxKg), z = liczba(w.marginPct || '0')
      if (!(od >= 0 && doo >= od && doo <= 200)) { setBlad(`${w.name}: tara „od” musi być ≤ „do” (0–200 kg)`); return }
      if (!(z >= 0 && z <= 20)) { setBlad(`${w.name}: zapas 0–20%`); return }
    }
    if (!lista.length) { setBlad('Dodaj przynajmniej jedną paletę'); return }
    setZapis(true)
    try {
      const p = await magazynApi.zapiszPaletyMrozni(lista.map(w => ({
        id: w.id, name: w.name.trim(), tareMinKg: liczba(w.tareMinKg), tareMaxKg: liczba(w.tareMaxKg),
        marginPct: liczba(w.marginPct || '0'),
      })))
      setWiersze(p.map(naWiersz)); setOk(true)
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się zapisać')
    } finally { setZapis(false) }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <div className="w-10 h-10 rounded-xl bg-surface-3 text-ink-2 flex items-center justify-center">
          <Snowflake size={18} />
        </div>
        <div>
          <CardTitle>Palety magazynu — ważenie przed mroźnią</CardTitle>
          <CardDescription>
            Kafle palet na kiosku magazynu. Waga zgodna, gdy netto ze sztuk mieści się w brutto
            minus tara (od–do), z zapasem % netto ustawionym dla każdej palety.
          </CardDescription>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="pt-5 space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_100px_40px] gap-2 text-[11px] font-semibold uppercase text-muted-foreground">
          <span>Paleta</span><span>Tara od kg</span><span>Tara do kg</span><span>Zapas %</span><span />
        </div>
        {wiersze.map((w, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_110px_100px_40px] items-center gap-2">
            <Input aria-label="Nazwa palety" value={w.name} onChange={e => zmien(i, 'name', e.target.value)} placeholder="EURO" />
            <Input aria-label="Tara od" inputMode="decimal" value={w.tareMinKg} onChange={e => zmien(i, 'tareMinKg', e.target.value)} />
            <Input aria-label="Tara do" inputMode="decimal" value={w.tareMaxKg} onChange={e => zmien(i, 'tareMaxKg', e.target.value)} />
            <Input aria-label="Zapas" inputMode="decimal" value={w.marginPct} onChange={e => zmien(i, 'marginPct', e.target.value)} />
            <Button variant="ghost" size="icon" className="text-slate-400 hover:text-destructive" title="Usuń paletę"
              onClick={() => { setWiersze(p => p.filter((_, j) => j !== i)); setOk(false) }}>
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        <Button variant="outline" className="gap-1.5"
          onClick={() => { setWiersze(p => [...p, { id: '', name: '', tareMinKg: '', tareMaxKg: '', marginPct: '1' }]); setOk(false) }}>
          <Plus size={14} /> Dodaj paletę
        </Button>
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={() => void zapisz()} disabled={zapis} className="gap-2">
            <Save size={14} /> Zapisz palety
          </Button>
          {ok && <CardDescription className="text-green-700 text-sm">✓ Zapisano — kiosk zobaczy zmianę przy następnym ważeniu</CardDescription>}
          {blad && <CardDescription className="text-destructive text-sm">{blad}</CardDescription>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paleta o znanej wadze: wpisz tę samą liczbę w „od” i „do” (np. EURO 35 kg ±5% = 33,25–36,75).
        </p>
      </CardContent>
    </Card>
  )
}
