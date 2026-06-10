import { useEffect, useState } from 'react'
import { wzApi, WzLine } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { AlertTriangle, FileCheck2, Printer, RefreshCw } from 'lucide-react'

const toNum = (s: string) => {
  const n = parseFloat((s || '').trim().replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const sanitizeDecimal = (s: string) => {
  const cleaned = s.replace(/[^\d.,]/g, '')
  const firstSep = cleaned.search(/[.,]/)
  if (firstSep === -1) return cleaned
  return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, '')
}
const fmtKg3 = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')

type Preview = {
  order_id: string; order_no: string; buyer_name: string; buyer_nip: string
  produced: number; ordered: number; incomplete: boolean
  lines: WzLine[]
  existing: { id: string; number: string; valued: boolean } | null
}

/** Okno wystawiania WZ z zamówienia — jak WZ ręczny: pozycje z wagą,
 *  cena ZA KG w PLN/EUR (kurs NBP) albo "bez cen" (uzupełnienie później). */
export function WzFromOrderModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [data, setData] = useState<Preview | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [err, setErr] = useState('')
  const [priceStrs, setPriceStrs] = useState<string[]>([])
  const [currency, setCurrency] = useState<'PLN' | 'EUR'>('PLN')
  const [eurRateStr, setEurRateStr] = useState('')
  const [eurRateDate, setEurRateDate] = useState('')
  const [rateLoading, setRateLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    wzApi.fromOrderPreview(orderId)
      .then(d => { setData(d); setPriceStrs((d.lines || []).map(() => '')) })
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Błąd pobierania pozycji'))
  }, [orderId])

  const eurRate = toNum(eurRateStr)
  const fetchNbpRate = () => {
    setRateLoading(true)
    fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json')
      .then(r => r.json())
      .then(d => {
        const rate = d?.rates?.[0]
        if (rate?.mid) { setEurRateStr(String(rate.mid)); setEurRateDate(rate.effectiveDate || '') }
      })
      .catch(() => {})
      .finally(() => setRateLoading(false))
  }
  useEffect(() => { if (currency === 'EUR' && !eurRateStr) fetchNbpRate() }, [currency])  // eslint-disable-line react-hooks/exhaustive-deps

  const sym = currency === 'EUR' ? '€' : 'zł'
  const lineBase = (l: WzLine) => (l.total_kg ?? 0) > 0 ? Number(l.total_kg) : l.qty
  const total = (data?.lines || []).reduce((s, l, i) => s + lineBase(l) * toNum(priceStrs[i] ?? ''), 0)
  const totalKg = (data?.lines || []).reduce((s, l) => s + Number(l.total_kg ?? 0), 0)

  const openPrint = (id: string) => {
    const url = `/office/wz/${id}/druk`
    const win = window.open(url, '_blank')
    if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
  }

  const issue = async (valued: boolean) => {
    if (!data) return
    if (valued) {
      if (priceStrs.some(s => !(toNum(s) > 0))) { setErr('Uzupełnij cenę za kg dla każdej pozycji (albo wystaw bez cen)'); return }
      if (currency === 'EUR' && !(eurRate > 0)) { setErr('Brak kursu EUR — pobierz z NBP lub wpisz ręcznie'); return }
    }
    setErr(''); setSaving(true)
    try {
      const doc = await wzApi.fromOrder(orderId, valued ? {
        valued: true,
        currency,
        eurRate: currency === 'EUR' ? eurRate : null,
        prices: priceStrs.map((s, i) => ({ index: i, price: toNum(s) })),
      } : { valued: false })
      openPrint(doc.id)
      onClose()
    } catch (e: any) {
      setErr(e?.message || 'Błąd wystawiania WZ')
    } finally { setSaving(false) }
  }

  const zeroProduced = data ? data.produced <= 0 : false

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Wystaw WZ {data ? <span className="font-mono text-primary">— {data.order_no}</span> : ''}
          </DialogTitle>
        </DialogHeader>

        {loadErr && (
          <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{loadErr}</div>
        )}
        {!data && !loadErr && <div className="py-8 text-center text-muted-foreground text-sm">Ładowanie pozycji…</div>}

        {data && data.existing && (
          <div className="space-y-3">
            <div className="text-[13px] bg-blue-50 border border-blue-200 text-blue-800 rounded-md px-3 py-2">
              Dla tego zamówienia istnieje już dokument <b className="font-mono">{data.existing.number}</b>
              {data.existing.valued ? ' (wyceniony)' : ' (bez cen — uzupełnisz je na liście Dokumenty WZ)'}.
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Zamknij</Button>
              <Button className="gap-1.5" onClick={() => { openPrint(data.existing!.id); onClose() }}>
                <Printer size={14} /> Otwórz WZ {data.existing.number}
              </Button>
            </div>
          </div>
        )}

        {data && !data.existing && zeroProduced && (
          <div className="space-y-3">
            <div className="text-[13px] bg-red-50 border border-red-200 text-red-800 rounded-md px-3 py-2">
              Brak zaraportowanej produkcji dla tego zamówienia (0 z {data.ordered} szt).
              WZ z zamówienia powstaje ze sztuk wpisanych na tablecie produkcyjnym —
              zakończ produkcję na tablecie albo wystaw WZ ręcznie (Dokumenty WZ → Nowy WZ).
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>Zamknij</Button>
            </div>
          </div>
        )}

        {data && !data.existing && !zeroProduced && (
          <div className="space-y-3">
            {data.incomplete && (
              <div className="flex items-start gap-2 text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <div>
                  Zaraportowano <b>{data.produced} z {data.ordered} szt</b> — dokument powstanie
                  na stan faktyczny produkcji i może zawierać braki.
                </div>
              </div>
            )}

            <Table className="text-[12px]">
              <TableHeader>
                <TableRow>
                  {['Towar', 'Partia', 'Szt', 'Waga', `Cena/kg [${sym}]`, `Wartość [${sym}]`].map((h, i) => (
                    <TableHead key={i} className="text-[9px] uppercase tracking-wider h-7 px-2">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="py-1.5 px-2 font-medium">{l.name}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono text-green-700">{l.batch_no || '—'}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono">{l.qty}</TableCell>
                    <TableCell className="py-1.5 px-2 font-mono font-semibold whitespace-nowrap">
                      {(l.total_kg ?? 0) > 0 ? `${fmtKg3(Number(l.total_kg))} kg` : '—'}
                      {l.kg_per_unit ? <div className="text-[10px] font-normal text-muted-foreground">{fmtKg3(Number(l.kg_per_unit))} kg/szt</div> : null}
                    </TableCell>
                    <TableCell className="py-1.5 px-2">
                      <Input type="text" inputMode="decimal" placeholder="0,00"
                             value={priceStrs[i] ?? ''}
                             className="h-8 w-24 font-mono"
                             onFocus={e => e.target.select()}
                             onChange={e => setPriceStrs(ps => ps.map((p, j) => j === i ? sanitizeDecimal(e.target.value) : p))} />
                    </TableCell>
                    <TableCell className="py-1.5 px-2 text-right font-mono font-semibold whitespace-nowrap">
                      {(lineBase(l) * toNum(priceStrs[i] ?? '')).toFixed(2)} {sym}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Waluta</Label>
                <div className="flex rounded-md border overflow-hidden">
                  {(['PLN', 'EUR'] as const).map(c => (
                    <button key={c}
                            className={cn('px-4 h-8 text-[11px] font-semibold transition-colors',
                              currency === c ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted')}
                            onClick={() => setCurrency(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              {currency === 'EUR' && (
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Kurs EUR {eurRateDate ? `(NBP ${eurRateDate})` : ''}
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="text" inputMode="decimal" value={eurRateStr} placeholder="kurs EUR"
                           className="h-8 w-28 font-mono text-[12px]"
                           onFocus={e => e.target.select()}
                           onChange={e => { setEurRateStr(sanitizeDecimal(e.target.value)); setEurRateDate('') }} />
                    <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" title="Pobierz kurs z NBP"
                            disabled={rateLoading} onClick={fetchNbpRate}>
                      <RefreshCw size={13} className={rateLoading ? 'animate-spin' : ''} />
                    </Button>
                  </div>
                </div>
              )}
              <div className="ml-auto text-right">
                <div className="text-[11px] text-muted-foreground">Razem {fmtKg3(totalKg)} kg</div>
                <div className="font-mono font-bold text-xl">
                  {total.toFixed(2)} <span className="text-[12px] font-medium text-muted-foreground">{sym}</span>
                </div>
                {currency === 'EUR' && eurRate > 0 && total > 0 && (
                  <div className="text-[11px] text-muted-foreground">≈ {(total * eurRate).toFixed(2)} zł</div>
                )}
              </div>
            </div>

            {err && (
              <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{err}</div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-1 border-t">
              <Button variant="outline" disabled={saving} onClick={onClose}>Anuluj</Button>
              <Button variant="outline" disabled={saving} className="gap-1.5" onClick={() => issue(false)}>
                Wystaw bez cen
                <Badge variant="warning" className="text-[9px] px-1.5">ceny później</Badge>
              </Button>
              <Button disabled={saving} className="gap-1.5" onClick={() => issue(true)}>
                <FileCheck2 size={14} /> {saving ? 'Wystawianie…' : 'Wystaw z cenami'}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-right -mt-1">
              Wystawienie zdejmuje pozycje ze stanu wyrobów gotowych.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
