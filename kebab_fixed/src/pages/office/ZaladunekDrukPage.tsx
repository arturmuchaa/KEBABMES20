import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Truck, AlertTriangle, Check } from 'lucide-react'
import { zaladunkiApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * Papiery jednego KURSU — wszystko, co wyjechało tym autem, w jednym miejscu.
 *
 * Magazynier nie ma ani drukarki, ani uprawnień, więc komplet drukuje biuro
 * (12.09.2026). Dokumenty otwieramy ich WŁASNYMI ekranami wydruku — te już
 * istnieją i są jedynym miejscem, które wie, jak dany papier ma wyglądać.
 * Powielanie tego tutaj skończyłoby się dwiema wersjami tego samego wydruku.
 */
type Dok = { id: string; number: string; doc_series?: string; split_scope?: string | null; scope?: string | null }
type Pozycja = {
  order_id: string
  order_no: string | null
  client_name: string | null
  wz_status: string | null
  wz: Dok[]
  hdi: Dok[]
  cmr: Dok[]
}

function Papier({ do: doAdres, etykieta, numer }: { do: string; etykieta: string; numer: string }) {
  return (
    <Link
      to={doAdres}
      target="_blank"
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
    >
      <Printer size={14} className="text-slate-500" />
      <span className="font-semibold">{etykieta}</span>
      <code className="font-mono text-xs text-slate-600">{numer}</code>
    </Link>
  )
}

export function ZaladunekDrukPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [kurs, setKurs] = useState<any>(null)
  const [blad, setBlad] = useState('')
  const [zapisuje, setZapisuje] = useState(false)
  const [oznaczony, setOznaczony] = useState(false)

  useEffect(() => {
    if (!id) return
    zaladunkiApi.get(id).then(setKurs).catch(e => setBlad(e?.message || 'Nie udało się wczytać kursu'))
  }, [id])

  async function oznacz() {
    if (zapisuje) return
    setZapisuje(true)
    try {
      await zaladunkiApi.wydrukowano(id)
      setOznaczony(true)
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się oznaczyć kursu')
    } finally {
      setZapisuje(false)
    }
  }

  const pozycje: Pozycja[] = kurs?.pozycje ?? []

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link to="/office" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft size={15} /> Pulpit
        </Link>
        <div className="flex items-center gap-2 font-bold">
          <Truck size={17} /> Papiery kursu
          {kurs?.plate && <code className="font-mono text-sm">{kurs.plate}</code>}
        </div>
      </div>

      {blad && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{blad}</div>}

      {pozycje.map((p) => (
        <Card key={p.order_id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-bold">{p.client_name || '—'}</span>
              <span className="text-xs text-muted-foreground">{p.order_no}</span>
              {p.wz_status === 'rozjazd' && (
                <Badge variant="outline" className="border-amber-400 text-amber-700 gap-1">
                  <AlertTriangle size={12} /> rozjazd — sprawdź przed wydrukiem
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {p.wz.map(d => (
                <Papier key={d.id} do={`/office/wz/${d.id}/druk`}
                  etykieta={d.doc_series === 'WM' ? 'WM (wewnętrzny)' : 'WZ'} numer={d.number} />
              ))}
              {p.hdi.map(d => (
                <Papier key={d.id} do={`/office/hdi/${d.id}/druk`}
                  etykieta={d.scope === 'fv' ? 'HDI do faktury' : 'HDI'} numer={d.number} />
              ))}
              {p.cmr.map(d => (
                <Papier key={d.id} do={`/office/cmr/${d.id}/druk`}
                  etykieta={d.scope === 'fv' ? 'CMR do faktury' : 'CMR na drogę'} numer={d.number} />
              ))}
              {p.wz.length + p.hdi.length + p.cmr.length === 0 && (
                <span className="text-sm text-muted-foreground">Brak wystawionych dokumentów</span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {kurs && (
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={oznacz} disabled={zapisuje || oznaczony || !!kurs.printed_at}>
            {oznaczony || kurs.printed_at
              ? <><Check size={15} className="mr-1.5" /> Oznaczone jako wydrukowane</>
              : 'Wydrukowane — zdejmij z pulpitu'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Ponowny wydruk zawsze z listy „Dokumenty WZ" — dokumenty się nie zmieniają.
          </span>
        </div>
      )}
    </div>
  )
}
