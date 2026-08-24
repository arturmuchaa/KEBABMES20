/**
 * OrderEntryPage — terminal wprowadzania zamówień klienta.
 *
 * Zastępuje modal z ClientOrdersPage, w którym każda pozycja zaczynała się od
 * zera: operator wybierał myszką rodzaj, recepturę i tuleję DLA KAŻDEJ linii,
 * choć w jednym zamówieniu różnią się one zwykle tylko wagą i liczbą sztuk.
 *
 * Trzy zasady tego ekranu:
 *   1. KLIENT RAZ. Wybierany na wejściu, potem wisi na listwie u góry.
 *   2. POZYCJA DZIEDZICZY. Po zatwierdzeniu linii rodzaj/receptura/tuleja
 *      zostają, czyszczą się tylko szt i kg — kursor ląduje od razu na „szt".
 *      Kolejna pozycja to więc dwie liczby i dwa ⏎.
 *   3. RĘKA NIE SCHODZI Z KLAWIATURY. ⏎ zatwierdza pole i pozycję, ⇥ skacze,
 *      wybór z listy sam przesuwa kursor dalej, ⌃⏎ zapisuje zamówienie.
 *
 * Backend i kontrakt /api/client-orders są NIETKNIĘTE — na wyjściu leci ten
 * sam CreateClientOrderDto co dotąd (POST przy nowym, PUT przy edycji).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, CornerDownLeft, Pencil, RotateCcw, Trash2, X } from 'lucide-react'

import { useApi } from '@/hooks/useApi'
import { clientsApi, packagingApi } from '@/lib/apiClient'
import { clientOrdersApi } from '@/lib/api'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import { fmtKgTrim, todayIso, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { CreateClientOrderDto } from '@/lib/mockApi'
import type { PreviewItem } from '@/lib/api'

import { emptyLine, filterRecipesFor, type LineForm } from '../order-form/types'
import { MaterialRequirementsPanel } from '../order-form/MaterialRequirementsPanel'
import {
  applyIdentity, carryOver, draftComplete, identityComplete, inheritedSlots,
  initialSlot, lineKg, nextSlot, num, prevSlot, totals, type Slot,
} from './model'
import { ComboField, FieldShell, NumberField } from './fields'
import { ClientStep } from './ClientStep'
import './order-entry.css'

/** Znak arytmetyczny między polami wsadu — czyta się „40 × 8,5 = 340 kg". */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-[15px]">
      <div className="flex h-10 items-center font-mono text-[15px] text-ink-5">{children}</div>
    </div>
  )
}

export function OrderEntryPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const editing  = !!id

  // ── Słowniki ───────────────────────────────────────────────────
  const { data: clientList } = useApi(() => clientsApi.list())
  const { data: pkgList }    = useApi(() => packagingApi.list())
  const { data: orderList }  = useApi(() => clientOrdersApi.list())
  const { productTypes }     = useProductTypes()
  const { recipes }          = useRecipes()
  const { data: existing }   = useApi(() => (id ? clientOrdersApi.byId(id) : Promise.resolve(null)), [id])

  const clients   = clientList  ?? []
  const packaging = pkgList     ?? []
  const ptList    = productTypes ?? []
  const rcList    = recipes      ?? []

  // ── Stan zamówienia ────────────────────────────────────────────
  const [step,         setStep]         = useState<'client' | 'lines'>('client')
  const [clientId,     setClientId]     = useState('')
  const [orderDate,    setOrderDate]    = useState(todayIso())
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes,        setNotes]        = useState('')
  const [lines,        setLines]        = useState<LineForm[]>([])

  // ── Stan wsadu (edytowana pozycja) ─────────────────────────────
  const [draft,      setDraft]      = useState<LineForm>(emptyLine())
  const [slot,       setSlot]       = useState<Slot>('productTypeId')
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [hint,       setHint]       = useState('')
  const [stamp,      setStamp]      = useState(0)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  // Wyjście z niezapisanym zamówieniem wymaga potwierdzenia. Świadomie BEZ
  // confirm() — w oknie Tauri natywne dialogi bywają wygłuszone i operator
  // straciłby robotę bez żadnego pytania. Dwa razy Esc / dwa kliknięcia.
  const [armedExit,  setArmedExit]  = useState(false)

  // Zasianie danych przy edycji — RAZ. Bez tej blokady kolejny przelot
  // useApi (polling/refetch) skasowałby to, co operator zdążył poprawić.
  const seeded = useRef(false)
  useEffect(() => {
    if (!existing || seeded.current) return
    seeded.current = true
    setClientId(existing.clientId)
    setOrderDate(existing.orderDate || todayIso())
    setDeliveryDate(existing.deliveryDate ?? '')
    setNotes(existing.notes ?? '')
    setLines(existing.lines.map(l => ({
      qty: String(l.qty), kgPerUnit: String(l.kgPerUnit),
      productTypeId: l.productTypeId, recipeId: l.recipeId,
      packagingId: l.packagingId ?? '', notes: l.notes ?? '',
    })))
    setStep('lines')
  }, [existing])

  // ── Listy do pól wyboru ────────────────────────────────────────
  const ptItems = useMemo(() => ptList.map((p: any) => ({ id: p.id, label: p.name })), [ptList])
  const rcItems = useMemo(
    () => filterRecipesFor(rcList as any, draft).map((r: any) => ({ id: r.id, label: r.name, sub: r.productTypeName })),
    [rcList, draft.productTypeId], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const pkItems = useMemo(
    () => packaging.map((p: any) => ({ id: p.id, label: p.name, sub: `${p.kgAvailable} ${p.unit ?? 'szt'}` })),
    [packaging],
  )

  const client   = clients.find(c => c.id === clientId)
  const sum      = totals(lines)
  const draftKg  = lineKg(draft)
  const inherit  = editingIdx === null ? inheritedSlots(draft, lines[lines.length - 1]) : new Set<Slot>()
  const carrying = inherit.size > 0

  // Ostatnio obsługiwani kontrahenci — najczęściej to oni wracają.
  const recentIds = useMemo(() => {
    const seen: string[] = []
    for (const o of orderList ?? []) if (!seen.includes(o.clientId)) seen.push(o.clientId)
    return seen
  }, [orderList])

  // Podgląd zapotrzebowania: pozycje zapisane + wsad, gdy już coś znaczy.
  const previewItems: PreviewItem[] = useMemo(() => [
    ...lines.map(l => ({ qty: num(l.qty), kgPerUnit: num(l.kgPerUnit), recipeId: l.recipeId, productTypeId: l.productTypeId })),
    ...(draftComplete(draft)
      ? [{ qty: num(draft.qty), kgPerUnit: num(draft.kgPerUnit), recipeId: draft.recipeId, productTypeId: draft.productTypeId }]
      : []),
  ], [lines, draft])

  // ── Ruch kursora ───────────────────────────────────────────────
  /** Kolejny slot po `from`, z pominięciem tego, czego nie ma czego wybierać. */
  const advanceFrom = useCallback((from: Slot, line: LineForm): Slot => {
    let next = nextSlot(from)
    if (next === 'recipeId') {
      const opts = filterRecipesFor(rcList as any, line)
      if (opts.length === 1) next = 'packagingId'   // jedyna pasująca — nie ma wyboru
    }
    if (next === 'packagingId' && pkItems.length === 0) next = 'qty'
    return next
  }, [rcList, pkItems.length])

  /** Wybór z listy: ustaw wartość i PRZESUŃ KURSOR — to jest „auto-skok po wypełnieniu". */
  function pickIdentity(field: Slot, value: string) {
    let nd = applyIdentity(draft, field, value, rcList as any)
    // Jedyna pasująca receptura wskakuje sama.
    if (field === 'productTypeId' && !nd.recipeId) {
      const opts = filterRecipesFor(rcList as any, nd)
      if (opts.length === 1) nd = { ...nd, recipeId: opts[0].id }
    }
    setDraft(nd)
    setHint('')
    setSlot(advanceFrom(field, nd))
  }

  function goNext(from: Slot) {
    if (from === 'kgPerUnit') { commit(); return }
    setSlot(advanceFrom(from, draft))
  }
  const goPrev = (from: Slot) => setSlot(prevSlot(from))

  // ── Dopisanie / poprawa pozycji ────────────────────────────────
  function commit() {
    if (!draft.productTypeId)   { setSlot('productTypeId'); setHint('Wybierz rodzaj produktu'); return }
    if (!draft.recipeId)        { setSlot('recipeId');      setHint('Wybierz recepturę');        return }
    if (num(draft.qty) <= 0)    { setSlot('qty');           setHint('Podaj liczbę sztuk');       return }
    if (num(draft.kgPerUnit)<=0){ setSlot('kgPerUnit');     setHint('Podaj wagę sztuki');        return }

    const line = { ...draft }
    setLines(ls => (editingIdx === null ? [...ls, line] : ls.map((l, i) => (i === editingIdx ? line : l))))
    setEditingIdx(null)
    setHint('')
    setError('')
    setStamp(s => s + 1)

    const next = carryOver(line)
    setDraft(next)
    setSlot(initialSlot(next))
  }

  function editLine(i: number) {
    setDraft({ ...lines[i] })
    setEditingIdx(i)
    setHint('')
    setSlot('qty')
  }

  function cancelEdit() {
    const next = carryOver(lines[lines.length - 1])
    setEditingIdx(null)
    setDraft(next)
    setSlot(initialSlot(next))
  }

  // Aktualna lista pozycji dla uchwytów żyjących poza cyklem renderu.
  const linesRef = useRef(lines); linesRef.current = lines

  /** Wyjście bez zapisu — za pierwszym razem tylko ostrzegamy.
   *  Stan „uzbrojone" trzymamy też w refie: decyzja zapada w uchwycie
   *  zdarzenia, a nie w aktualizatorze stanu (tam nawigacja byłaby efektem
   *  ubocznym w trakcie renderu). */
  const armedRef = useRef(false)
  const armTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(armTimer.current), [])

  const leave = useCallback(() => {
    if (linesRef.current.length === 0 || armedRef.current) { navigate('/office/zamowienia'); return }
    armedRef.current = true
    setArmedExit(true)
    armTimer.current = window.setTimeout(() => { armedRef.current = false; setArmedExit(false) }, 4000)
  }, [navigate])

  function removeLine(i: number) {
    setLines(ls => ls.filter((_, j) => j !== i))
    if (editingIdx === i) cancelEdit()
    else if (editingIdx !== null && editingIdx > i) setEditingIdx(editingIdx - 1)
  }

  // ── Zapis ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!clientId) { setStep('client'); return }
    // Wsad wypełniony do końca, ale niezatwierdzony — nie gubimy go po cichu.
    const all = draftComplete(draft) && editingIdx === null ? [...lines, draft] : lines
    if (all.length === 0) { setError('Dodaj przynajmniej jedną pozycję'); return }

    const dto: CreateClientOrderDto = {
      clientId,
      orderDate,
      deliveryDate: deliveryDate || undefined,
      notes: notes || undefined,
      lines: all.map(l => ({
        qty: num(l.qty),
        kgPerUnit: num(l.kgPerUnit),
        productTypeId: l.productTypeId,
        productTypeName: (ptList as any[]).find(p => p.id === l.productTypeId)?.name
                      || (rcList as any[]).find(r => r.id === l.recipeId)?.productTypeName
                      || '',
        recipeId: l.recipeId,
        recipeName: (rcList as any[]).find(r => r.id === l.recipeId)?.name || '',
        packagingId: l.packagingId || undefined,
        packagingName: l.packagingId ? ((packaging as any[]).find(p => p.id === l.packagingId)?.name || '') : undefined,
      })),
    }

    setSaving(true)
    setError('')
    try {
      if (editing && id) await clientOrdersApi.update(id, dto)
      else               await clientOrdersApi.create(dto)
      navigate('/office/zamowienia')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać zamówienia')
    } finally {
      setSaving(false)
    }
  }, [clientId, orderDate, deliveryDate, notes, lines, draft, editingIdx, editing, id, ptList, rcList, packaging, navigate])

  // ── Skróty globalne ────────────────────────────────────────────
  const saveRef = useRef(save); saveRef.current = save
  const leaveRef = useRef(leave); leaveRef.current = leave
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2')                                { e.preventDefault(); setStep('client') }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveRef.current() }
      else if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('input, textarea')) {
        e.preventDefault(); leaveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Krok 1: klient ─────────────────────────────────────────────
  if (step === 'client') {
    return (
      <div className="animate-fade-in py-6">
        <ClientStep
          clients={clients}
          recentIds={recentIds}
          onPick={cid => {
            setClientId(cid)
            setStep('lines')
            setSlot(initialSlot(draft))
          }}
          onCancel={() => navigate('/office/zamowienia')}
        />
      </div>
    )
  }

  // ── Krok 2: pozycje ────────────────────────────────────────────
  return (
    <div className="animate-fade-in flex min-h-[calc(100vh-7.5rem)] flex-col gap-3">

      {/* ── Listwa zamówienia ── */}
      <section className="border border-surface-4 bg-white shadow-card">
        <div className="flex items-stretch">
          <div className="flex min-w-0 flex-1 items-center gap-4 bg-ink px-5 py-3 text-white">
            <button
              onClick={leave}
              title="Wróć do listy zamówień (Esc)"
              className="-ml-1.5 shrink-0 p-1.5 text-white/55 transition-colors hover:text-white"
            >
              <ArrowLeft size={17} />
            </button>
            <div className="min-w-0">
              <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-white/45">
                {editing ? `Edycja ${existing?.orderNo ?? ''}` : 'Nowe zamówienie dla'}
              </div>
              <div className="truncate font-display text-[19px] font-bold leading-tight tracking-[-0.01em]">
                {client ? (client.displayName || client.name) : '—'}
              </div>
            </div>
            <button
              onClick={() => setStep('client')}
              className="ml-auto shrink-0 border border-white/25 px-2.5 py-1 text-[11px] font-medium text-white/80 transition-colors hover:border-white hover:bg-white hover:text-ink"
            >
              Zmień <kbd className="oe-key ml-1 border-white/30 bg-white/10 text-white">F2</kbd>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-4 px-5">
            <label className="flex flex-col gap-0.5">
              <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-4">Data zamówienia</span>
              <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
                     className="h-8 border border-surface-4 bg-white px-2 font-mono text-[12px] text-ink outline-none focus:border-ink" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="font-display text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-4">Termin dostawy</span>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                     className="h-8 border border-surface-4 bg-white px-2 font-mono text-[12px] text-ink outline-none focus:border-ink" />
            </label>
          </div>
        </div>
      </section>

      {/* ── Wsad: nowa / poprawiana pozycja ── */}
      <section className={cn('border bg-white shadow-card', editingIdx === null ? 'border-surface-4' : 'border-ink')}>
        <header className="flex items-center gap-2 border-b border-surface-3 bg-surface-2 px-4 py-1.5">
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink">
            {editingIdx === null ? `Pozycja ${lines.length + 1}` : `Poprawa pozycji ${editingIdx + 1}`}
          </span>
          {carrying && editingIdx === null && (
            <span className="flex items-center gap-1 border border-surface-4 bg-white px-1.5 py-px text-[10px] text-ink-3">
              <RotateCcw size={9} />
              rodzaj, receptura i tuleja przeniesione z pozycji {lines.length}
            </span>
          )}
          {editingIdx !== null && (
            <button onClick={cancelEdit} className="flex items-center gap-1 text-[10.5px] text-ink-3 hover:text-ink">
              <X size={11} /> porzuć poprawkę
            </button>
          )}
          <span className="ml-auto text-[10.5px] text-ink-4">
            <kbd className="oe-key">⏎</kbd> dalej / dodaj · <kbd className="oe-key">⇥</kbd> pole · <kbd className="oe-key">⇧⇥</kbd> wstecz
          </span>
        </header>

        <div className="flex items-start gap-2.5 px-4 pb-3 pt-2.5">
          <ComboField
            label="Rodzaj" width="w-[210px]" placeholder="Rodzaj produktu…"
            items={ptItems} value={draft.productTypeId}
            active={slot === 'productTypeId'} inherited={inherit.has('productTypeId')}
            onActivate={() => setSlot('productTypeId')}
            onPick={v => pickIdentity('productTypeId', v)}
            onNext={() => goNext('productTypeId')}
            onPrev={() => goPrev('productTypeId')}
          />
          <ComboField
            label="Receptura" width="min-w-[180px] flex-1" placeholder="Receptura…"
            items={rcItems} value={draft.recipeId}
            active={slot === 'recipeId'} inherited={inherit.has('recipeId')}
            emptyHint={draft.productTypeId ? 'Brak receptur dla tego rodzaju' : 'Najpierw wybierz rodzaj'}
            onActivate={() => setSlot('recipeId')}
            onPick={v => pickIdentity('recipeId', v)}
            onNext={() => goNext('recipeId')}
            onPrev={() => goPrev('recipeId')}
          />
          <ComboField
            label="Tuleja" width="w-[190px]" placeholder="— bez tulei —" noneLabel="— bez tulei —"
            items={pkItems} value={draft.packagingId}
            active={slot === 'packagingId'} inherited={inherit.has('packagingId')}
            onActivate={() => setSlot('packagingId')}
            onPick={v => pickIdentity('packagingId', v)}
            onNext={() => goNext('packagingId')}
            onPrev={() => goPrev('packagingId')}
          />
          <NumberField
            label="Sztuk" width="w-[104px]" placeholder="0"
            value={draft.qty} onChange={v => { setDraft(d => ({ ...d, qty: v })); setHint('') }}
            active={slot === 'qty'} onActivate={() => setSlot('qty')}
            onNext={() => goNext('qty')} onPrev={() => goPrev('qty')}
          />
          <Glyph>×</Glyph>
          <NumberField
            label="Waga sztuki" width="w-[122px]" placeholder="0,0" suffix="kg"
            value={draft.kgPerUnit} onChange={v => { setDraft(d => ({ ...d, kgPerUnit: v })); setHint('') }}
            active={slot === 'kgPerUnit'} onActivate={() => setSlot('kgPerUnit')}
            onNext={() => goNext('kgPerUnit')} onPrev={() => goPrev('kgPerUnit')}
          />

          <Glyph>=</Glyph>

          {/* Wynik pozycji — liczba, na którą operator patrzy przy wbijaniu. */}
          <FieldShell label="Razem" active={false} className="w-[132px]">
            <div className={cn(
              'flex h-10 items-baseline justify-end gap-1 rounded-b-[3px] rounded-tr-[3px] border px-2.5',
              draftKg > 0 ? 'border-ink bg-white' : 'border-surface-4 bg-surface-2',
            )}>
              <span className="font-mono text-[20px] font-bold leading-none tabular-nums text-ink">
                {draftKg > 0 ? fmtKgTrim(draftKg) : '—'}
              </span>
              <span className="font-display text-[10px] font-bold uppercase text-ink-4">kg</span>
            </div>
          </FieldShell>

          <div className="flex flex-col self-stretch pt-[15px]">
            <Button
              onClick={commit}
              disabled={!draftComplete(draft)}
              className="h-10 gap-1.5 rounded-none px-4 font-display text-[12px] font-bold uppercase tracking-wide"
            >
              {editingIdx === null ? <CornerDownLeft size={14} /> : <Check size={14} />}
              {editingIdx === null ? 'Dodaj' : 'Zapisz poz.'}
            </Button>
          </div>
        </div>

        {hint && (
          <div className="border-t border-surface-3 bg-surface-2 px-4 py-1.5 text-[11.5px] font-semibold text-danger">
            {hint}
          </div>
        )}
      </section>

      {/* ── Paragon + zapotrzebowanie ── */}
      <div className="flex min-h-0 flex-1 items-stretch gap-3">

        <div className="flex min-h-[220px] min-w-0 flex-1 flex-col">
        <section className="oe-tear flex min-h-0 flex-1 flex-col border border-surface-4 bg-white shadow-card">
          <header className="flex items-baseline gap-2 border-b border-surface-4 bg-surface-2 px-4 py-1.5">
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink">Pozycje zamówienia</span>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-4">{sum.count} poz.</span>
          </header>

          {/* Nagłówek kolumn. Bez niego trzy nazwy zlewały się w jeden urwany
              napis i przy kilku pozycjach nie dawało się rzucić okiem, co jest
              rodzajem, co recepturą, a co tuleją. Szerokości MUSZĄ być te same
              co w wierszu poniżej — inaczej nagłówek kłamie. */}
          {lines.length > 0 && (
            <div
              data-testid="oe-line-head"
              className="flex items-center gap-2.5 border-b border-surface-3 bg-surface-2/60 px-4 py-1
                         font-display text-[9.5px] font-bold uppercase tracking-[0.13em] text-ink-4"
            >
              <span className="w-5 shrink-0" />
              <span className="w-[104px] shrink-0">Ilość</span>
              <span className="min-w-0 flex-[3]">Rodzaj</span>
              <span className="min-w-0 flex-[3]">Receptura</span>
              <span className="min-w-0 flex-[2]">Tuleja</span>
              <span className="w-[92px] shrink-0 text-right">Razem</span>
              <span className="w-[52px] shrink-0" />
            </div>
          )}

          {lines.length === 0 ? (
            <div className="flex flex-1 flex-col items-center gap-1 pt-10">
              <p className="text-[13px] text-ink-3">Jeszcze pusto.</p>
              <p className="text-[11.5px] text-ink-4">
                Wypełnij wsad powyżej i naciśnij <kbd className="oe-key">⏎</kbd> — pozycja spadnie tutaj.
              </p>
            </div>
          ) : (
            <>
              <div className="oe-receipt oe-scroll min-h-0 flex-1 overflow-y-auto">
                {lines.map((l, i) => {
                  const pt = (ptList as any[]).find(p => p.id === l.productTypeId)?.name || '—'
                  const rc = (rcList as any[]).find(r => r.id === l.recipeId)?.name || '—'
                  const pk = l.packagingId ? ((packaging as any[]).find(p => p.id === l.packagingId)?.name || '') : ''
                  const isLast = i === lines.length - 1
                  return (
                    <div
                      key={`${i}-${stamp}`}
                      data-testid="oe-line"
                      onDoubleClick={() => editLine(i)}
                      className={cn(
                        'oe-noselect group flex h-8 items-center gap-2.5 px-4 text-[12.5px]',
                        editingIdx === i && 'bg-ink text-white',
                        editingIdx !== i && 'hover:bg-surface-2',
                        isLast && editingIdx === null && stamp > 0 && 'oe-stamped',
                      )}
                    >
                      <span className={cn('w-5 shrink-0 text-right font-mono text-[11px] tabular-nums',
                        editingIdx === i ? 'text-white/50' : 'text-ink-5')}>{i + 1}</span>
                      <span className="w-[104px] shrink-0 font-mono text-[12.5px] font-bold tabular-nums">
                        {num(l.qty)}<span className={cn('mx-1 font-sans text-[10px] font-normal', editingIdx === i ? 'text-white/50' : 'text-ink-4')}>×</span>{fmtKgTrim(num(l.kgPerUnit))}
                      </span>
                      <span data-testid="oe-col-rodzaj"
                        className="min-w-0 flex-[3] truncate font-medium" title={pt}>{pt}</span>
                      <span data-testid="oe-col-receptura"
                        className={cn('min-w-0 flex-[3] truncate', editingIdx === i ? 'text-white/70' : 'text-ink-2')}
                        title={rc}>{rc}</span>
                      {/* Myślnik, nie pustka: „bez tulei" to decyzja operatora,
                          a pusta kratka wygląda jak niedokończona pozycja. */}
                      <span data-testid="oe-col-tuleja"
                        className={cn('min-w-0 flex-[2] truncate', editingIdx === i ? 'text-white/70' : 'text-ink-3')}
                        title={pk || undefined}>{pk || '—'}</span>
                      <span className="w-[92px] shrink-0 text-right font-mono text-[13px] font-bold tabular-nums">
                        {fmtKgTrim(lineKg(l))}<span className={cn('ml-1 font-sans text-[10px] font-normal', editingIdx === i ? 'text-white/50' : 'text-ink-4')}>kg</span>
                      </span>
                      <span className="flex w-[52px] shrink-0 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button onClick={() => editLine(i)} title="Popraw pozycję (dwuklik)"
                          className={cn('grid h-6 w-6 place-items-center', editingIdx === i ? 'text-white/70 hover:text-white' : 'text-ink-4 hover:bg-surface-3 hover:text-ink')}>
                          <Pencil size={12} />
                        </button>
                        <button onClick={() => removeLine(i)} title="Usuń pozycję"
                          className={cn('grid h-6 w-6 place-items-center', editingIdx === i ? 'text-white/70 hover:text-white' : 'text-ink-4 hover:bg-danger-light hover:text-danger')}>
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>
        </div>

        <aside className="w-[292px] shrink-0 space-y-3">
          <MaterialRequirementsPanel items={previewItems} />
          <div className="border border-surface-4 bg-white shadow-card">
            <div className="border-b border-surface-3 bg-surface-2 px-3 py-1.5 font-display text-[9.5px] font-bold uppercase tracking-[0.14em] text-ink-3">
              Uwagi do zamówienia
            </div>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="np. dostawa przed 8:00, paleta EUR…"
              className="w-full resize-none bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-5"
            />
          </div>
        </aside>
      </div>

      {/* ── Stopka: suma i zapis ── */}
      <section className="sticky bottom-0 z-10 flex items-center gap-4 border border-surface-4 bg-white px-4 py-2.5 shadow-[0_-2px_10px_rgba(0,0,0,.05)]">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">Suma zamówienia</span>
        <span className="font-mono text-[12.5px] tabular-nums text-ink-3">
          {sum.count} poz. · {sum.units} szt
        </span>
        <span className="oe-leader" />
        <span className="font-mono text-[27px] font-bold leading-none tabular-nums text-ink">
          {fmtKgTrim(sum.kg)}<span className="ml-1 font-display text-[12px] font-bold uppercase text-ink-4">kg</span>
        </span>

        {error && <span className="max-w-[280px] text-[12px] font-semibold text-danger">{error}</span>}

        <div className="ml-4 flex items-center gap-2">
          <Button variant="outline" onClick={leave} disabled={saving}
                  className={cn('h-10 rounded-none px-4', armedExit && 'border-danger text-danger')}>
            {armedExit ? 'Porzucić? Kliknij raz jeszcze' : 'Anuluj'}
          </Button>
          <Button onClick={() => void save()} disabled={saving || (lines.length === 0 && !draftComplete(draft))}
                  className="h-10 gap-2 rounded-none px-6 font-display text-[13px] font-bold uppercase tracking-wide">
            {saving
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              : <Check size={16} />}
            {editing ? 'Zapisz zmiany' : 'Zapisz zamówienie'}
            <kbd className="oe-key border-white/30 bg-white/10 text-white/90">⌃⏎</kbd>
          </Button>
        </div>
      </section>
    </div>
  )
}
