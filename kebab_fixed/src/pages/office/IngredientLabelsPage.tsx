/**
 * IngredientLabelsPage — druk etykiet 100×150 mm na palety DDFiP.
 *
 * Wchodzi się tu zaraz po zarejestrowaniu przyjęcia ALBO później z rejestru,
 * bo druk lubi się nie udać: BrowserPrint bywa wyłączony, taśma się kończy,
 * a etykieta odkleja się po drodze do magazynu nr 28. Ekran nic nie zapisuje
 * w księdze, więc druk można powtórzyć do skutku.
 *
 * JEDNA etykieta na POZYCJĘ, nie na dokument: jedno auto przywozi przyprawę,
 * folię i osłonkę naraz, a każda z nich stoi potem gdzie indziej.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Printer } from 'lucide-react'

import { useApi } from '@/hooks/useApi'
import { ingredientReceptionsApi } from '@/lib/apiClient'
import type { IngredientReception } from '@/lib/api'
import { getDevices, probeBrowserPrint, sendZpl } from '@/lib/zebra'
import { fmtDatePl } from '@/lib/utils'
import { ddfipLabelZpl } from '@/features/ingredients/ddfipLabelZpl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const LIST_PATH = '/office/przyjecie-ddfip'

/** Przerwa MIĘDZY etykietami: BrowserPrint oddaje sterowanie zanim drukarka
 *  zdąży odciąć poprzednią, a zlepione zadania wychodzą krzywo. */
const pauza = (ms: number) => new Promise<void>(res => setTimeout(res, ms))

export function IngredientLabelsPage() {
  const { receptionId = '' } = useParams()
  const navigate = useNavigate()
  const { data, loading } = useApi<IngredientReception>(
    () => ingredientReceptionsApi.byId(receptionId), [receptionId])

  const [kopie, setKopie] = useState<Record<string, string>>({})
  const [drukuje, setDrukuje] = useState(false)

  const dokument = data as IngredientReception | null

  async function drukuj(zadania: string[], komunikat: string) {
    setDrukuje(true)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) {
        const sonda = await probeBrowserPrint()
        throw new Error(sonda.reason
          ?? 'Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona.')
      }
      for (let i = 0; i < zadania.length; i++) {
        await sendZpl(dev, zadania[i])
        if (i < zadania.length - 1) await pauza(400)
      }
      toast.success(komunikat)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd druku')
    } finally {
      setDrukuje(false)
    }
  }

  function zplDlaPozycji(l: IngredientReception['lines'][number]): string {
    return ddfipLabelZpl({
      receptionNo:    dokument?.receptionNo ?? '',
      ingredientName: l.ingredientName,
      qty:            l.qty,
      unit:           l.unit,
      batchNo:        l.batchNo,
      expiryDate:     l.expiryDate,
      supplierName:   dokument?.supplierName ?? '',
      documentNo:     dokument?.documentNo ?? '',
      receivedDate:   dokument?.receivedDate ?? '',
    }, { copies: Math.max(1, Number(kopie[l.id] ?? 1) || 1) })
  }

  if (loading || !dokument) {
    return <div className="p-6 text-sm text-muted-foreground">Wczytywanie dostawy…</div>
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div>
        <button type="button" onClick={() => navigate(LIST_PATH)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft size={15} /> Wróć do rejestru
        </button>
        <CardTitle className="text-xl">
          Etykiety — przyjęcie {dokument.receptionNo}
        </CardTitle>
        <CardDescription>
          {dokument.supplierName} · {fmtDatePl(dokument.receivedDate)} ·
          taśma 100 × 150 mm, naklejana na paletę
        </CardDescription>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {['Składnik', 'Ilość', 'Partia dostawcy', 'Termin', 'Kopie', ''].map(h => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dokument.lines.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-semibold text-ink">{l.ingredientName}</TableCell>
                  <TableCell className="tabular-nums">{l.qty} {l.unit}</TableCell>
                  <TableCell><code className="font-mono text-xs">{l.batchNo || '—'}</code></TableCell>
                  <TableCell className="text-ink-2">
                    {l.expiryDate ? fmtDatePl(l.expiryDate) : 'bez terminu'}
                  </TableCell>
                  <TableCell>
                    <Input type="number" min={1} className="w-20"
                      value={kopie[l.id] ?? '1'}
                      onChange={e => setKopie(k => ({ ...k, [l.id]: e.target.value }))} />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={drukuje}
                      onClick={() => drukuj([zplDlaPozycji(l)], `Etykieta „${l.ingredientName}" wysłana`)}>
                      <Printer size={13} className="mr-1" /> Drukuj
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {dokument.lines.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-sm text-ink-4">
                    {dokument.decision === 'N'
                      ? 'Dostawa odrzucona — nic nie weszło na magazyn, więc nie ma czego oklejać.'
                      : 'Brak pozycji.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dokument.lines.length > 0 && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(LIST_PATH)}>Gotowe</Button>
          <Button disabled={drukuje}
            onClick={() => drukuj(dokument.lines.map(zplDlaPozycji),
              `Wysłano ${dokument.lines.length} etykiet`)}>
            <Printer size={15} className="mr-1.5" />
            {drukuje ? 'Drukuję…' : 'Drukuj wszystkie'}
          </Button>
        </div>
      )}
    </div>
  )
}
