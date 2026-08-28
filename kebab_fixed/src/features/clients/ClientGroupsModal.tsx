/**
 * Grupy odbiorców — kilka spółek jednego kontrahenta.
 *
 * YALCIN to dwie spółki, odbiorca wrocławski ma pięć oddziałów. Dla hali to
 * jeden klient, więc towar zrobiony dla jednej spółki ma pokrywać zamówienia
 * pozostałych, zamiast leżeć obok i udawać, że nie istnieje.
 *
 * Grupa łączy WYŁĄCZNIE pulę wyrobu przy liczeniu pokrycia zamówień. Dokumenty
 * (WZ, HDI, CMR, faktura) zostają przy konkretnej spółce — sprzedaje się firmie,
 * nie grupie, a odbiorca na papierze musi mieć swój NIP i adres.
 */
import { useEffect, useState } from 'react'
import { Plus, Trash2, Users, Loader2 } from 'lucide-react'
import { clientGroupsApi, type ClientGroup, type Client } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

export function ClientGroupsModal({ clients, onClose, onChanged }: {
  clients: Client[]
  onClose: () => void
  onChanged?: () => void
}) {
  const [grupy, setGrupy] = useState<ClientGroup[] | null>(null)
  const [nowa, setNowa] = useState('')
  const [edytowana, setEdytowana] = useState<string | null>(null)
  const [zaznaczeni, setZaznaczeni] = useState<Set<string>>(new Set())
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState('')

  const wczytaj = () =>
    clientGroupsApi.list().then(setGrupy).catch(() => setGrupy([]))
  useEffect(() => { void wczytaj() }, [])

  const nazwaKlienta = (c: { name: string; displayName?: string }) =>
    c.displayName && c.displayName !== c.name ? `${c.displayName} — ${c.name}` : c.name

  /** W której grupie siedzi dany odbiorca (poza edytowaną) — spółka należy
   *  najwyżej do jednej, więc resztę pokazujemy jako zajętą. */
  const grupaKlienta = (id: string) =>
    (grupy ?? []).find(g => g.id !== edytowana && g.members.some(m => m.id === id))

  const otworzSklad = (g: ClientGroup) => {
    setBlad('')
    setEdytowana(g.id)
    setZaznaczeni(new Set(g.members.map(m => m.id)))
  }

  const dzialaj = async (fn: () => Promise<unknown>) => {
    setZajety(true); setBlad('')
    try {
      await fn()
      await wczytaj()
      onChanged?.()
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się zapisać')
    } finally {
      setZajety(false)
    }
  }

  const zapiszSklad = () => dzialaj(async () => {
    await clientGroupsApi.setMembers(edytowana!, [...zaznaczeni])
    setEdytowana(null)
  })

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users size={17} /> Grupy odbiorców</DialogTitle>
          <DialogDescription>
            Spółki w jednej grupie dzielą zapas wyrobu — towar zrobiony dla jednej
            pokryje zamówienie drugiej. Dokumenty zostają przy konkretnej firmie.
          </DialogDescription>
        </DialogHeader>

        {blad && (
          <p data-testid="grupy-blad" className="rounded-[3px] border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
            {blad}
          </p>
        )}

        <div className="flex gap-2">
          <input data-testid="grupa-nazwa" value={nowa} onChange={e => setNowa(e.target.value)}
            placeholder="Nazwa grupy, np. WROCŁAW"
            className="h-9 flex-1 rounded-[3px] border border-ink-4 px-3 text-sm" />
          <Button size="sm" className="gap-1.5" data-testid="grupa-dodaj"
            disabled={zajety || !nowa.trim()}
            onClick={() => dzialaj(async () => { await clientGroupsApi.create(nowa.trim()); setNowa('') })}>
            <Plus size={14} /> Nowa grupa
          </Button>
        </div>

        {grupy === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Wczytuję…</p>
        ) : grupy.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nie ma jeszcze żadnej grupy. Załóż ją i wskaż spółki, które mają dzielić zapas.
          </p>
        ) : (
          <div className="space-y-3">
            {grupy.map(g => (
              <div key={g.id} data-testid={`grupa-${g.id}`} className="rounded-lg border border-surface-4 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{g.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {g.members.length === 0 ? 'brak spółek'
                      : `${g.members.length} ${g.members.length === 1 ? 'spółka' : 'spółki/spółek'}`}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]"
                      data-testid={`grupa-sklad-${g.id}`} disabled={zajety}
                      onClick={() => edytowana === g.id ? setEdytowana(null) : otworzSklad(g)}>
                      {edytowana === g.id ? 'Zwiń' : 'Skład'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-700"
                      data-testid={`grupa-usun-${g.id}`} disabled={zajety}
                      onClick={() => {
                        if (!window.confirm(`Rozwiązać grupę „${g.name}"?\n\nSpółki zostaną w kartotece — wrócą tylko do własnych, osobnych pul wyrobu.`)) return
                        void dzialaj(() => clientGroupsApi.remove(g.id))
                      }}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>

                {g.members.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.members.map(m => (
                      <span key={m.id} className="rounded-[3px] border border-surface-4 bg-surface-2 px-2 py-0.5 text-[11px]">
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}

                {edytowana === g.id && (
                  <div className="mt-3 border-t border-surface-3 pt-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Zaznacz spółki należące do grupy
                    </p>
                    <div className="max-h-56 space-y-1 overflow-auto">
                      {clients.map(c => {
                        const gdzie = grupaKlienta(c.id)
                        return (
                          <label key={c.id}
                            className={`flex items-center gap-2 rounded-[3px] px-2 py-1 text-sm ${gdzie ? 'opacity-50' : 'hover:bg-surface-2'}`}>
                            <input type="checkbox" data-testid={`klient-${c.id}`}
                              disabled={!!gdzie}
                              checked={zaznaczeni.has(c.id)}
                              onChange={e => setZaznaczeni(z => {
                                const n = new Set(z)
                                if (e.target.checked) n.add(c.id); else n.delete(c.id)
                                return n
                              })} />
                            <span>{nazwaKlienta(c)}</span>
                            {gdzie && (
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                już w grupie {gdzie.name}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" data-testid={`grupa-zapisz-${g.id}`} disabled={zajety}
                        onClick={() => void zapiszSklad()}>
                        {zajety ? <Loader2 size={13} className="animate-spin" /> : null} Zapisz skład
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEdytowana(null)}>Anuluj</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
