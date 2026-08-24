/**
 * PlanTerminal — pasek wsadu pozycji planu produkcji.
 *
 * Ten sam kontrakt klawiatury co terminal zamówień, bo to ten sam ruch ręki:
 * wpisz fragment, ⏎, leć dalej. Plan dnia ma około dziesięciu pozycji, więc
 * każde zbędne sięgnięcie po mysz mnoży się przez dziesięć — i to ono
 * sprawiło, że stary ekran planowania odbił.
 *
 * Kolejność slotów i dziedziczenie siedzą w `planLineModel` (czysta logika,
 * testowana osobno); tutaj zostaje sam render i kursor.
 */
import { useMemo, useState } from 'react'
import { ComboField, NumberField, FieldShell } from '@/components/terminal/fields'
import { cn, fmtKgTrim } from '@/lib/utils'
import {
  emptyPlanLine, carryOver, inheritedSlots, initialSlot, nextSlot, prevSlot,
  applyIdentity, draftComplete, lineKg, num,
  type PlanLine, type Slot,
} from '../planLineModel'

interface Nazwane { id: string; name: string }
interface RecipeOpt extends Nazwane { productTypeId?: string }

const Glyph = ({ children }: { children: React.ReactNode }) => (
  <span className="self-end pb-2.5 font-mono text-[15px] font-bold text-ink-4">{children}</span>
)

export function PlanTerminal({
  productTypes, recipes, packaging, clients, lastLine, onCommit,
  editing = false, onCancelEdit,
}: {
  productTypes: Nazwane[]
  recipes:      RecipeOpt[]
  packaging:    Nazwane[]
  clients:      Nazwane[]
  /** Nowa pozycja: ostatnio dopisana, po której dziedziczy się tożsamość.
   *  Tryb poprawiania: POPRAWIANA pozycja — wchodzi w całości, z liczbami. */
  lastLine:     PlanLine | null
  /** Pasek poprawia istniejącą pozycję zamiast dopisywać nową. */
  editing?:     boolean
  onCancelEdit?: () => void
  onCommit:     (line: PlanLine) => void
}) {
  // W trybie poprawiania NIE dziedziczymy: wsad ma pokazać pozycję taką, jaka
  // jest — z ilością i wagą — bo poprawiane bywa właśnie któreś z tych pól.
  const start = editing && lastLine ? lastLine : carryOver(lastLine)
  const [draft, setDraft] = useState<PlanLine>(() => start)
  const [slot,  setSlot]  = useState<Slot>(() => (editing ? 'qty' : initialSlot(start)))
  const [hint,  setHint]  = useState('')

  // Znaczniki dziedziczenia tylko przy NOWEJ pozycji — przy poprawianiu
  // wszystko „pochodzi" z tej samej pozycji i znaczniki nic nie znaczą.
  const inherit = useMemo(
    () => (editing ? new Set<Slot>() : inheritedSlots(draft, lastLine)),
    [editing, draft, lastLine],
  )

  const ptItems = useMemo(() => productTypes.map(p => ({ id: p.id, label: p.name })), [productTypes])
  // Receptury zawężone do wybranego rodzaju: receptura z innego produktu
  // na tej pozycji byłaby zapisem, którego backend i tak nie przyjmie.
  const rcItems = useMemo(
    () => recipes
      .filter(r => !draft.productTypeId || !r.productTypeId || r.productTypeId === draft.productTypeId)
      .map(r => ({ id: r.id, label: r.name })),
    [recipes, draft.productTypeId],
  )
  const pkItems = useMemo(() => packaging.map(p => ({ id: p.id, label: p.name })), [packaging])
  const clItems = useMemo(() => clients.map(c => ({ id: c.id, label: c.name })), [clients])

  const draftKg = lineKg(draft)

  function pickIdentity(s: Slot, value: string) {
    setHint('')
    setDraft(d => {
      const next = applyIdentity(d, s, value, recipes)
      // Klienta trzymamy też nazwą: plan jedzie na wydruk dla kierownika,
      // a tam samo id nikomu nic nie mówi.
      if (s === 'clientId') next.clientName = clients.find(c => c.id === value)?.name ?? ''
      return next
    })
    setSlot(nextSlot(s))
  }

  function commit() {
    if (!draft.productTypeId) { setSlot('productTypeId'); setHint('Wybierz rodzaj produktu'); return }
    if (!draft.recipeId)      { setSlot('recipeId');      setHint('Wybierz recepturę');       return }
    if (num(draft.qty) <= 0)  { setSlot('qty');           setHint('Podaj liczbę sztuk');      return }
    if (num(draft.kgPerUnit) <= 0) { setSlot('kgPerUnit'); setHint('Podaj wagę sztuki');      return }
    if (!draftComplete(draft)) return

    onCommit(draft)
    if (editing) return          // rodzic zamyka tryb poprawiania
    const next = carryOver(draft)
    setDraft(next)
    setSlot(initialSlot(next))
    setHint('')
  }

  /** ⏎ / ⇥ na ostatnim polu zatwierdza pozycję, wcześniej idzie dalej. */
  const goNext = (from: Slot) => (from === 'kgPerUnit' ? commit() : setSlot(nextSlot(from)))
  const goPrev = (from: Slot) => setSlot(prevSlot(from))

  return (
    <section className="border border-surface-4 bg-white shadow-card">
      <header className="flex items-center gap-2 border-b border-surface-3 bg-surface-2 px-4 py-1.5">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.14em] text-ink">
          {editing ? 'Poprawa pozycji' : 'Wsad'}
        </span>
        {editing && onCancelEdit && (
          <button onClick={onCancelEdit} data-testid="porzuc-poprawke"
            className="flex items-center gap-1 text-[10.5px] text-ink-3 hover:text-ink">
            porzuć poprawkę
          </button>
        )}
        <span className="ml-auto text-[10.5px] text-ink-4">
          <kbd className="oe-key">⏎</kbd> dalej / dodaj · <kbd className="oe-key">⇥</kbd> pole ·{' '}
          <kbd className="oe-key">⇧⇥</kbd> wstecz
        </span>
      </header>

      {/* Na wąskim ekranie pola zgniatały się i etykiety nachodziły na wartości
          (zrzut z telefonu, 24.08.2026). Przewijamy w poziomie zamiast zgniatać. */}
      <div className="flex items-start gap-2.5 overflow-x-auto px-4 pb-3 pt-2.5 [&>*]:shrink-0">
        <ComboField
          label="Rodzaj" width="w-[190px]" placeholder="Rodzaj produktu…"
          items={ptItems} value={draft.productTypeId}
          active={slot === 'productTypeId'} inherited={inherit.has('productTypeId')}
          onActivate={() => setSlot('productTypeId')}
          onPick={v => pickIdentity('productTypeId', v)}
          onNext={() => goNext('productTypeId')} onPrev={() => goPrev('productTypeId')}
        />
        <ComboField
          label="Receptura" width="min-w-[160px] flex-1" placeholder="Receptura…"
          items={rcItems} value={draft.recipeId}
          active={slot === 'recipeId'} inherited={inherit.has('recipeId')}
          emptyHint={draft.productTypeId ? 'Brak receptur dla tego rodzaju' : 'Najpierw wybierz rodzaj'}
          onActivate={() => setSlot('recipeId')}
          onPick={v => pickIdentity('recipeId', v)}
          onNext={() => goNext('recipeId')} onPrev={() => goPrev('recipeId')}
        />
        <ComboField
          label="Tuleja" width="w-[150px]" placeholder="— bez tulei —" noneLabel="— bez tulei —"
          items={pkItems} value={draft.packagingId}
          active={slot === 'packagingId'} inherited={inherit.has('packagingId')}
          onActivate={() => setSlot('packagingId')}
          onPick={v => pickIdentity('packagingId', v)}
          onNext={() => goNext('packagingId')} onPrev={() => goPrev('packagingId')}
        />
        {/* Klient jest OPCJONALNY — produkcja „na magazyn" go nie ma i to jest
            normalny przypadek, nie brak danych. */}
        <ComboField
          label="Klient" width="w-[170px]" placeholder="— na magazyn —" noneLabel="— na magazyn —"
          items={clItems} value={draft.clientId}
          active={slot === 'clientId'} inherited={inherit.has('clientId')}
          onActivate={() => setSlot('clientId')}
          onPick={v => pickIdentity('clientId', v)}
          onNext={() => goNext('clientId')} onPrev={() => goPrev('clientId')}
        />

        <NumberField
          label="Sztuk" width="w-[92px]" placeholder="0"
          value={draft.qty} onChange={v => { setDraft(d => ({ ...d, qty: v })); setHint('') }}
          active={slot === 'qty'} onActivate={() => setSlot('qty')}
          onNext={() => goNext('qty')} onPrev={() => goPrev('qty')}
        />
        <Glyph>×</Glyph>
        <NumberField
          label="Waga sztuki" width="w-[110px]" placeholder="0" suffix="kg"
          value={draft.kgPerUnit} onChange={v => { setDraft(d => ({ ...d, kgPerUnit: v })); setHint('') }}
          active={slot === 'kgPerUnit'} onActivate={() => setSlot('kgPerUnit')}
          onNext={() => goNext('kgPerUnit')} onPrev={() => goPrev('kgPerUnit')}
        />
        <Glyph>=</Glyph>

        <FieldShell label="Razem" active={false} className="w-[118px]">
          <div className={cn(
            'flex h-10 items-baseline justify-end gap-1 rounded-b-[3px] rounded-tr-[3px] border px-2.5',
            draftKg > 0 ? 'border-ink bg-white' : 'border-surface-4 bg-surface-2',
          )}>
            <span data-testid="plan-draft-kg"
              className="font-mono text-[19px] font-bold leading-none tabular-nums text-ink">
              {draftKg > 0 ? fmtKgTrim(draftKg) : '—'}
            </span>
            <span className="font-display text-[10px] font-bold uppercase text-ink-4">kg</span>
          </div>
        </FieldShell>
      </div>

      {hint && (
        <div className="border-t border-surface-3 bg-surface-2 px-4 py-1.5 text-[11.5px] font-semibold text-danger">
          {hint}
        </div>
      )}
    </section>
  )
}
