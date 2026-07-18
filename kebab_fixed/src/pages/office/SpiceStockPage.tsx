/**
 * SpiceStockPage — Magazyn Przypraw i Dodatków (lista, styl Subiekt GT).
 *
 * Gęsta lista składników z aktualnym stanem. Klik wiersza rozwija historię
 * przyjęć tego składnika. Przyciski Nowy składnik / Przyjęcie PZ w toolbar.
 */
import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { useApi } from '@/hooks/useApi'
import { ingredientReceiptsApi, ingredientsApi } from '@/lib/apiClient'
import { fmtDatePl, todayIso, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  FlaskConical, Plus, ChevronDown, ChevronUp, ChevronsUpDown, Search, X,
} from 'lucide-react'
import type { IngredientCategory } from '@/features/ingredients/types'
import { useIngredients } from '@/features/ingredients/hooks'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type SortCol = 'name' | 'category' | 'qty' | 'unit' | 'lastReceipt' | 'expiry'

const CATEGORY_LABEL: Record<string, string> = {
  spice_mix:  'Mieszanka',
  functional: 'Dodatek funkc.',
  other:      'Inne',
}

function expiryFromNotes(notes?: string): string | undefined {
  if (!notes) return
  const m = notes.match(/Ważność:\s*(\d{4}-\d{2}-\d{2})/)
  return m?.[1]
}

function getReceiptExpiry(receipt?: { expiryDate?: string; notes?: string }) {
  return receipt?.expiryDate || expiryFromNotes(receipt?.notes)
}

function ExpiryCell({ date }: { date?: string }) {
  if (!date) return <span className="text-muted-foreground">—</span>
  const { daysLeft } = getExpiryStatus(date)
  const cls =
    daysLeft < 0     ? 'bg-red-50 text-red-700 border-red-200'   :
    daysLeft <= 30   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                       'bg-emerald-50 text-emerald-700 border-emerald-200'
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-ink-2">{fmtDatePl(date)}</span>
      <Badge variant="outline" className={cn('text-[10px]', cls)}>
        {daysLeft < 0 ? 'wygasło' : `${daysLeft}d`}
      </Badge>
    </div>
  )
}

/**
 * IngredientPicker — pole "Składnik" z wyszukiwaniem po wpisaniu.
 *
 * Zastępuje rozwijany Select, w który nie dało się nic WPISAĆ (użytkownicy
 * próbowali wpisać nazwę nowego dodatku i pole wyglądało na zablokowane).
 * Wpisanie nazwy filtruje listę; gdy brak dopasowania — przycisk tworzy
 * nowy składnik bezpośrednio z tego miejsca (onCreateNew).
 */
function IngredientPicker({ ingredients, stockMap, value, onSelect, onCreateNew }: {
  ingredients: { id: string; name: string; unit: string; category: string }[]
  stockMap: Map<string, any>
  value: string
  onSelect: (id: string) => void
  onCreateNew: (name: string) => void
}) {
  const selected = ingredients.find(i => i.id === value)
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Zamknij listę przy kliknięciu poza polem
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = query.toLowerCase().trim()
  const matches = q
    ? ingredients.filter(i => i.name.toLowerCase().includes(q))
    : ingredients
  const exact = ingredients.some(i => i.name.toLowerCase() === q)

  return (
    <div ref={boxRef} className="relative">
      <Input
        placeholder="Wpisz nazwę, np. Papryka słodka…"
        value={open ? query : (selected?.name ?? query)}
        onFocus={() => { setOpen(true); setQuery(selected?.name ?? '') }}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (value) onSelect('') }}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-surface-4 rounded-lg shadow-md max-h-56 overflow-y-auto scrollbar-thin">
          {matches.map(i => {
            const qty = stockMap.get(i.id)?.qtyAvailable ?? 0
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => { onSelect(i.id); setQuery(''); setOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-3/70',
                  i.id === value && 'bg-surface-3 font-semibold',
                )}
              >
                <span className="truncate">{i.name}</span>
                <span className={cn('text-[11px] tabular-nums flex-shrink-0', qty > 0 ? 'text-emerald-700' : 'text-ink-4')}>
                  {qty.toFixed(1)} {i.unit}
                </span>
              </button>
            )
          })}
          {matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-4">Brak składnika o tej nazwie</div>
          )}
          {q && !exact && (
            <button
              type="button"
              onClick={() => { onCreateNew(query.trim()); setOpen(false) }}
              className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold text-brand border-t border-surface-3 hover:bg-surface-3/70"
            >
              <Plus size={13} /> Dodaj nowy składnik „{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SpiceStockPage() {
  const { ingredients, stock, loading, refetch, createIngredient, addReceipt, createLoading, receiptLoading } = useIngredients()
  const { data: receipts, refetch: refetchReceipts } = useApi(() => ingredientReceiptsApi.list())

  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [ingModal,     setIngModal]     = useState(false)
  const [receiptModal, setReceiptModal] = useState(false)
  const [selIngId,     setSelIngId]     = useState('')
  const [filter,       setFilter]       = useState('')
  const [sortCol,      setSortCol]      = useState<SortCol>('name')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('asc')

  // Nowy składnik
  const [newName, setNewName] = useState('')
  const [newCat,  setNewCat]  = useState<IngredientCategory>('spice_mix')
  const [newUnit, setNewUnit] = useState('kg')

  // Przyjęcie PZ
  const [recQty,     setRecQty]     = useState('')
  const [recPrice,   setRecPrice]   = useState('')
  const [recInvoice, setRecInvoice] = useState('')
  const [recDate,    setRecDate]    = useState(todayIso())
  const [recExpiry,  setRecExpiry]  = useState('')

  // Tworzenie nowego składnika wprost z okna PZ (picker → „Dodaj nowy…")
  const [pzNewName,    setPzNewName]    = useState<string | null>(null)
  const [pzNewCat,     setPzNewCat]     = useState<IngredientCategory>('functional')
  const [pzNewUnit,    setPzNewUnit]    = useState('kg')
  const [pzNewSaving,  setPzNewSaving]  = useState(false)

  async function handlePzCreateIngredient() {
    const name = (pzNewName ?? '').trim()
    if (!name) return
    setPzNewSaving(true)
    try {
      const created = await (ingredientsApi as any).create({
        name, category: pzNewCat, unit: pzNewUnit, isUnlimited: false,
      })
      refetch()
      setSelIngId(created.id)
      setPzNewName(null)
      toast.success(`"${name}" dodany i wybrany`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu składnika')
    } finally {
      setPzNewSaving(false)
    }
  }

  const displayIngredients = ingredients.filter(i => !i.isUnlimited)

  const stockMap = useMemo(() => new Map(stock.map(s => [s.ingredientId, s])), [stock])
  const receiptMap = useMemo(() => {
    const m = new Map<string, any[]>()
    ;(receipts ?? []).forEach(r => {
      const arr = m.get(r.ingredientId) ?? []
      m.set(r.ingredientId, [...arr, r])
    })
    return m
  }, [receipts])

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = displayIngredients
    if (q) {
      result = displayIngredients.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (CATEGORY_LABEL[i.category] || '').toLowerCase().includes(q) ||
        (i.unit || '').toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      const sa = stockMap.get(a.id)
      const sb = stockMap.get(b.id)
      const recsA = (receiptMap.get(a.id) ?? []).sort((x, y) => (y.receivedDate > x.receivedDate ? 1 : -1))
      const recsB = (receiptMap.get(b.id) ?? []).sort((x, y) => (y.receivedDate > x.receivedDate ? 1 : -1))
      if (sortCol === 'name')        cmp = (a.name || '').localeCompare(b.name || '')
      if (sortCol === 'category')    cmp = (CATEGORY_LABEL[a.category] || '').localeCompare(CATEGORY_LABEL[b.category] || '')
      if (sortCol === 'qty')         cmp = (sa?.qtyAvailable ?? 0) - (sb?.qtyAvailable ?? 0)
      if (sortCol === 'unit')        cmp = (a.unit || '').localeCompare(b.unit || '')
      if (sortCol === 'lastReceipt') cmp = (recsA[0]?.receivedDate || '').localeCompare(recsB[0]?.receivedDate || '')
      if (sortCol === 'expiry')      cmp = (getReceiptExpiry(recsA[0]) || '').localeCompare(getReceiptExpiry(recsB[0]) || '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [displayIngredients, filter, sortCol, sortDir, stockMap, receiptMap])

  const totalKinds  = list.length
  const availCount  = list.filter(i => (stockMap.get(i.id)?.qtyAvailable ?? 0) > 0).length

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  async function handleCreateIng() {
    const err = await createIngredient({ name: newName, category: newCat, unit: newUnit, isUnlimited: false })
    if (err) { toast.error(err); return }
    toast.success(`"${newName}" dodany do magazynu`)
    setIngModal(false); setNewName(''); setNewCat('spice_mix'); setNewUnit('kg')
  }

  async function handleReceipt() {
    const err = await addReceipt({
      ingredientId: selIngId,
      qty:          parseFloat(recQty) || 0,
      pricePerUnit: parseFloat(recPrice) || 0,
      invoiceNo:    recInvoice || undefined,
      receivedDate: recDate,
      expiryDate:   recExpiry || undefined,
    })
    if (err) { toast.error(err); return }
    refetchReceipts()
    toast.success('Przyjęcie PZ zapisane')
    setReceiptModal(false)
    setRecQty(''); setRecPrice(''); setRecInvoice(''); setRecExpiry('')
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-fade-in">
        <Card><CardContent className="p-3"><Skeleton className="h-8 w-full" /></CardContent></Card>
        <Card><CardContent className="p-4 space-y-2">{[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-3 animate-fade-in">

      {/* Toolbar */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 pr-8 text-sm"
                placeholder="Filtruj: nazwa, kategoria…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                autoFocus
              />
              {filter && (
                <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                  <X size={13}/>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Składników:</CardDescription>
              <span className="font-bold">{totalKinds}{totalKinds !== displayIngredients.length && <span className="text-muted-foreground">/{displayIngredients.length}</span>}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Dostępnych:</CardDescription>
              <span className="font-bold text-emerald-700">{availCount}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => setIngModal(true)}>
              Nowy składnik
            </Button>
            <Button size="sm" className="h-7 px-2.5 text-xs gap-1" onClick={() => { setSelIngId(''); setReceiptModal(true) }}>
              <Plus size={12}/> Przyjęcie PZ
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {displayIngredients.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <FlaskConical size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak składników w magazynie</CardTitle>
            <CardDescription className="text-center max-w-xs">
              Dodaj składniki ręcznie lub przez Faktury (kategoria „Przyprawy i dodatki")
            </CardDescription>
          </CardContent>
        ) : list.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników dla „{filter}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  {[
                    { col: 'name'        as SortCol, label: 'Nazwa',         align: 'left'  },
                    { col: 'category'    as SortCol, label: 'Kategoria',     align: 'left'  },
                    { col: 'qty'         as SortCol, label: 'Stan',          align: 'right' },
                    { col: 'unit'        as SortCol, label: 'Jedn.',         align: 'left'  },
                    { col: 'lastReceipt' as SortCol, label: 'Ost. przyjęcie', align: 'left'  },
                    { col: 'expiry'      as SortCol, label: 'Ważność',       align: 'left'  },
                  ].map(h => (
                    <th
                      key={h.col}
                      onClick={() => toggleSort(h.col)}
                      className={cn(
                        'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="text-right px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 w-24">Akcja</th>
                </tr>
              </thead>
              <tbody>
                {list.map((ing, idx) => {
                  const s    = stockMap.get(ing.id)
                  const recs = (receiptMap.get(ing.id) ?? []).sort((a, b) => (b.receivedDate > a.receivedDate ? 1 : -1))
                  const last = recs[0]
                  const isExp = expanded === ing.id
                  const qty   = s?.qtyAvailable ?? 0
                  const expDate = getReceiptExpiry(last)

                  return (
                    <Fragment key={ing.id}>
                      <tr
                        onClick={() => setExpanded(isExp ? null : ing.id)}
                        className={cn(
                          'cursor-pointer border-b border-surface-3 transition-colors',
                          idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                          'hover:bg-surface-3/60'
                        )}
                      >
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink font-medium">
                          {ing.name}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                          {CATEGORY_LABEL[ing.category] || ing.category}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold">
                          <span className={qty > 0 ? 'text-emerald-700' : 'text-red-600'}>
                            {qty.toFixed(3)}
                          </span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                          {ing.unit}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                          {last ? fmtDatePl(last.receivedDate) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <ExpiryCell date={expDate} />
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-[10px] font-medium text-primary"
                              onClick={e => { e.stopPropagation(); setSelIngId(ing.id); setReceiptModal(true) }}
                            >
                              +PZ
                            </Button>
                            {isExp
                              ? <ChevronUp size={12} className="text-muted-foreground" />
                              : <ChevronDown size={12} className="text-muted-foreground" />
                            }
                          </div>
                        </td>
                      </tr>

                      {isExp && (
                        <tr>
                          <td colSpan={7} className="bg-surface-2/60 border-b border-surface-3 px-4 py-3">
                            <CardDescription className="text-[11px] font-bold uppercase tracking-wide mb-2">
                              Historia przyjęć
                            </CardDescription>
                            {recs.length === 0 ? (
                              <CardDescription className="text-xs">Brak przyjęć — dodaj przez PZ lub Faktury</CardDescription>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow className="hover:bg-transparent">
                                    {['Data','Ilość','Cena/jedn.','FV / PZ','Ważność'].map(h => (
                                      <TableHead key={h} className="text-[10px] uppercase tracking-wide h-7">{h}</TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {recs.slice(0, 20).map(r => (
                                    <TableRow key={r.id}>
                                      <TableCell className="text-xs py-1.5">{fmtDatePl(r.receivedDate)}</TableCell>
                                      <TableCell className="text-xs font-bold py-1.5">{r.qty} {r.unit}</TableCell>
                                      <TableCell className="py-1.5">
                                        <CardDescription className="text-xs">
                                          {r.pricePerUnit > 0 ? `${r.pricePerUnit.toFixed(2)} zł` : '—'}
                                        </CardDescription>
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        <code className="font-mono text-xs text-muted-foreground">{r.invoiceNo || '—'}</code>
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        <ExpiryCell date={getReceiptExpiry(r)} />
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal: nowy składnik */}
      <Dialog open={ingModal} onOpenChange={v => { if (!v) setIngModal(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nowy składnik</DialogTitle>
            <DialogDescription>Dodaj składnik do magazynu przypraw</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nazwa *</Label>
              <Input placeholder="np. Van Hess Hell, Chiken BKS" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Kategoria</Label>
              <Select value={newCat} onValueChange={v => setNewCat(v as IngredientCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spice_mix">Mieszanka przyprawowa</SelectItem>
                  <SelectItem value="functional">Dodatek funkcjonalny</SelectItem>
                  <SelectItem value="other">Inne</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Jednostka</Label>
              <Select value={newUnit} onValueChange={setNewUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="l">l</SelectItem>
                  <SelectItem value="szt">szt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIngModal(false)} disabled={createLoading}>Anuluj</Button>
            <Button onClick={handleCreateIng} disabled={createLoading || !newName.trim()} className="gap-2">
              {createLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Plus size={14} />
              }
              Dodaj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: przyjęcie PZ */}
      <Dialog open={receiptModal} onOpenChange={v => { if (!v) setReceiptModal(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Przyjęcie PZ</DialogTitle>
            <DialogDescription>Ręczne przyjęcie bez faktury</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Składnik * <span className="font-normal text-muted-foreground">(wpisz, aby wyszukać lub dodać nowy)</span></Label>
              <IngredientPicker
                ingredients={displayIngredients}
                stockMap={stockMap}
                value={selIngId}
                onSelect={setSelIngId}
                onCreateNew={name => { setPzNewName(name); setPzNewCat('functional'); setPzNewUnit('kg') }}
              />
            </div>

            {/* Inline: nowy składnik prosto z PZ */}
            {pzNewName !== null && (
              <Card className="border-brand-border bg-brand-light/60">
                <CardContent className="p-3 space-y-2.5">
                  <CardDescription className="text-[11px] font-bold uppercase tracking-wide text-brand">
                    Nowy składnik
                  </CardDescription>
                  <Input value={pzNewName} onChange={e => setPzNewName(e.target.value)} placeholder="Nazwa składnika" />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={pzNewCat} onValueChange={v => setPzNewCat(v as IngredientCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="spice_mix">Mieszanka przyprawowa</SelectItem>
                        <SelectItem value="functional">Dodatek funkcjonalny</SelectItem>
                        <SelectItem value="other">Inne</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={pzNewUnit} onValueChange={setPzNewUnit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kg">kg</SelectItem>
                        <SelectItem value="l">l</SelectItem>
                        <SelectItem value="szt">szt</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setPzNewName(null)} disabled={pzNewSaving}>Anuluj</Button>
                    <Button size="sm" onClick={handlePzCreateIngredient} disabled={pzNewSaving || !(pzNewName ?? '').trim()} className="gap-1.5">
                      {pzNewSaving
                        ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        : <Plus size={13} />}
                      Dodaj i wybierz
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ilość *</Label>
                <Input
                  type="number" min="0" step="0.001" placeholder="0.000"
                  value={recQty} onChange={e => setRecQty(e.target.value)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cena / jedn.</Label>
                <Input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={recPrice} onChange={e => setRecPrice(e.target.value)}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Data ważności (zalecana)</Label>
              <Input type="date" value={recExpiry} onChange={e => setRecExpiry(e.target.value)} />
              <CardDescription className="text-[10px]">Zazwyczaj +12 miesięcy od daty produkcji</CardDescription>
            </div>
            <div className="space-y-1.5">
              <Label>Nr PZ / FV</Label>
              <Input placeholder="np. PZ 001/2025" value={recInvoice} onChange={e => setRecInvoice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data przyjęcia</Label>
              <Input type="date" value={recDate} onChange={e => setRecDate(e.target.value)} />
            </div>
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="px-3 py-2">
                <CardDescription className="text-xs">
                  Faktura może zostać powiązana później w module Faktury i PZ
                </CardDescription>
              </CardContent>
            </Card>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReceiptModal(false)} disabled={receiptLoading}>Anuluj</Button>
            <Button
              onClick={handleReceipt}
              disabled={receiptLoading || !selIngId || !recQty || parseFloat(recQty) <= 0}
              className="gap-2"
            >
              {receiptLoading
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Plus size={14} />
              }
              Zatwierdź przyjęcie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
