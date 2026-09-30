/**
 * Biuro → Wydania: wydania pojedynczych sztuk przekazane z kiosku magazynu
 * (właściciel 30.09.2026).
 *
 * Magazynier zeskanował sztuki (zeszły z mroźni) i kliknął „Przekaż do biura".
 * Tu biuro wystawia WZ (rozchód stanu wyrobu gotowego), a zaraz potem HDI
 * i — gdy jedzie naszym autem albo przez granicę — CMR. Faktura w Subiekcie.
 */
import { useEffect, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { dispatchesApi, hdiApi, magazynApi, type WydanieSztuk } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CmrFormModal } from '@/components/cmr/CmrFormModal'
import { fmtKg } from '@/lib/utils'

/** Wydanie z wystawionym WZ — zostaje na karcie, bo biuro drukuje HDI/CMR zaraz potem. */
interface Wystawione { w: WydanieSztuk; wzId: string; wzNumber: string; hdiId?: string }

export function WydaniaSztukCard({ otworz, onWystawiono }: {
  /** Otwarcie dokumentu do druku (ta sama ścieżka co na liście WZ). */
  otworz: (url: string) => void
  /** Po wystawieniu WZ — odśwież listę dokumentów. */
  onWystawiono: () => void
}) {
  const [lista, setLista] = useState<WydanieSztuk[]>([])
  const [gotowe, setGotowe] = useState<Record<string, Wystawione>>({})
  const [zajete, setZajete] = useState<string | null>(null)
  const [cmrDla, setCmrDla] = useState<string | null>(null)

  const wczytaj = () => magazynApi.wydanieSztukDoWystawienia()
    .then(r => setLista(Array.isArray(r) ? r : [])).catch(() => {})
  useEffect(() => {
    void wczytaj()
    const t = setInterval(wczytaj, 30000)
    return () => clearInterval(t)
  }, [])

  async function wystawWz(w: WydanieSztuk) {
    setZajete(w.id)
    try {
      const r = await dispatchesApi.close(w.id) as { wzId?: string; wzNumber?: string }
      if (r.wzId) setGotowe(g => ({ ...g, [w.id]: { w, wzId: r.wzId!, wzNumber: r.wzNumber ?? '' } }))
      onWystawiono()
    } catch (e: any) {
      alert(e?.message || 'Nie udało się wystawić WZ')
    } finally { setZajete(null) }
  }

  async function wystawHdi(dispatchId: string, wzId: string) {
    setZajete(dispatchId)
    try {
      const doc = await hdiApi.generateFromWz(wzId)
      setGotowe(g => ({ ...g, [dispatchId]: { ...g[dispatchId], hdiId: doc.id } }))
      otworz(`/office/hdi/${doc.id}/druk`)
    } catch (e: any) {
      alert(e?.message || 'Nie udało się wystawić HDI')
    } finally { setZajete(null) }
  }

  // Wystawione zostają na karcie do końca wizyty na stronie — z listy
  // „do wystawienia" wydanie znika w chwili wystawienia WZ.
  const widoczne = [...lista.filter(w => !gotowe[w.id]), ...Object.values(gotowe).map(g => g.w)]

  if (!widoczne.length) return null

  return (
    <Card data-testid="wydania-sztuk">
      <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
        <div className="w-9 h-9 rounded-xl bg-surface-3 text-ink-2 flex items-center justify-center">
          <PackageOpen size={17} />
        </div>
        <div>
          <CardTitle className="text-sm">Wydania sztuk z magazynu</CardTitle>
          <CardDescription className="text-[11px]">
            Magazyn zeskanował sztuki i przekazał wydanie. Wystaw WZ, potem HDI i w razie potrzeby CMR. Fakturę wystaw w Subiekcie.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {widoczne.map(w => {
          const g = gotowe[w.id]
          return (
            <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{w.clientName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {w.qty} szt · {fmtKg(w.kg)} kg · {w.notes || (w.pickup === 'nasze' ? 'nasze auto' : 'odbiór przez klienta')}
                  {w.operator ? ` · wydał ${w.operator}` : ''}
                </div>
                {w.units?.length ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {sklad(w)}
                  </div>
                ) : null}
              </div>
              {g ? (
                <>
                  <span className="text-xs font-semibold text-green-700">✓ {g.wzNumber}</span>
                  <Button size="sm" variant="outline" onClick={() => otworz(`/office/wz/${g.wzId}/druk`)}>Drukuj WZ</Button>
                  <Button size="sm" variant="outline" disabled={zajete === w.id}
                    onClick={() => g.hdiId ? otworz(`/office/hdi/${g.hdiId}/druk`) : void wystawHdi(w.id, g.wzId)}>
                    {g.hdiId ? 'Drukuj HDI' : 'Wystaw HDI'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCmrDla(w.id)}>CMR</Button>
                </>
              ) : (
                <Button size="sm" disabled={zajete === w.id} onClick={() => void wystawWz(w)}>
                  {zajete === w.id ? 'Wystawiam…' : 'Wystaw WZ'}
                </Button>
              )}
            </div>
          )
        })}
      </CardContent>
      {cmrDla ? <CmrFormModal dispatchId={cmrDla} onClose={() => setCmrDla(null)} /> : null}
    </Card>
  )
}

function sklad(w: WydanieSztuk): string {
  const m = new Map<string, number>()
  for (const u of w.units) {
    const k = `${u.kg.toLocaleString('pl-PL')} kg ${u.recipeName}`.trim()
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([k, n]) => `${n} × ${k}`).join(' · ')
}
