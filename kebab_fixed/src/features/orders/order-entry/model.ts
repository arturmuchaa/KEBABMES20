/**
 * order-entry/model.ts — czysta logika terminala wprowadzania zamówień.
 *
 * Cała mechanika „kursora po slotach", dziedziczenia pozycji i liczenia sum
 * siedzi TUTAJ, bez Reacta i bez DOM-u — dzięki temu da się ją przetestować
 * jednostkowo (model.test.ts), a komponent zostaje głupi i szybki.
 *
 * Kluczowa zasada modułu: operator wbija SERIE pozycji, które różnią się
 * wyłącznie wagą i liczbą sztuk. Rodzaj / receptura / tuleja są DZIEDZICZONE
 * po ostatniej pozycji, a kursor po zatwierdzeniu ląduje od razu na „szt".
 * Backend i kontrakt /api/client-orders zostają nietknięte — to ten sam
 * CreateClientOrderDto co dotąd.
 */
import { emptyLine, type LineForm, type RecipeLite } from '../order-form/types'

export type { LineForm }

/** Sloty formularza pozycji w kolejności wypełniania. */
export type Slot = 'productTypeId' | 'recipeId' | 'packagingId' | 'qty' | 'kgPerUnit'

/** Tożsamość produktu najpierw, liczby na końcu — bo tylko liczby zmieniają się w serii. */
export const SLOT_ORDER: readonly Slot[] = ['productTypeId', 'recipeId', 'packagingId', 'qty', 'kgPerUnit'] as const

/** Pola przenoszone na kolejną pozycję („dziedziczone"). */
export const CARRIED: readonly Slot[] = ['productTypeId', 'recipeId', 'packagingId'] as const

/** Liczba z pola tekstowego — akceptuje przecinek dziesiętny (klawiatura numeryczna PL). */
export function num(s: string | number | undefined | null): number {
  if (s === null || s === undefined || s === '') return 0
  const v = parseFloat(String(s).replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

/** kg pozycji = ilość × kg/szt. */
export const lineKg = (l: LineForm): number => num(l.qty) * num(l.kgPerUnit)

/** Tożsamość kompletna = da się powiedzieć CO produkujemy (tuleja jest opcjonalna). */
export const identityComplete = (l: LineForm): boolean => !!l.productTypeId && !!l.recipeId

/** Pozycja gotowa do dopisania na paragon. */
export const draftComplete = (l: LineForm): boolean =>
  identityComplete(l) && num(l.qty) > 0 && num(l.kgPerUnit) > 0

/**
 * Nowa pozycja dziedzicząca tożsamość po ostatniej — czyścimy WYŁĄCZNIE
 * ilość i wagę. To jest sedno szybkości tego ekranu.
 */
export function carryOver(last?: LineForm | null): LineForm {
  const fresh = emptyLine()
  if (!last) return fresh
  return {
    ...fresh,
    productTypeId: last.productTypeId,
    recipeId:      last.recipeId,
    packagingId:   last.packagingId,
  }
}

/** Które sloty draftu przyszły z poprzedniej pozycji (do oznaczenia w UI). */
export function inheritedSlots(draft: LineForm, last?: LineForm | null): Set<Slot> {
  const out = new Set<Slot>()
  if (!last) return out
  for (const s of CARRIED) {
    const v = draft[s as keyof LineForm]
    if (v && v === last[s as keyof LineForm]) out.add(s)
  }
  return out
}

/** Slot, na którym staje kursor przy nowym drafcie (po commicie lub na wejściu). */
export function initialSlot(l: LineForm): Slot {
  if (!l.productTypeId) return 'productTypeId'
  if (!l.recipeId)      return 'recipeId'
  return 'qty'
}

/** Następny slot w kolejności — ostatni zostaje ostatnim. */
export function nextSlot(cur: Slot): Slot {
  const i = SLOT_ORDER.indexOf(cur)
  return SLOT_ORDER[Math.min(i + 1, SLOT_ORDER.length - 1)]
}

/** Poprzedni slot w kolejności — pierwszy zostaje pierwszym. */
export function prevSlot(cur: Slot): Slot {
  const i = SLOT_ORDER.indexOf(cur)
  return SLOT_ORDER[Math.max(i - 1, 0)]
}

/**
 * Ustawienie pola tożsamości. Zmiana rodzaju produktu unieważnia recepturę,
 * jeżeli dotychczasowa do niego nie należy (inaczej zapisalibyśmy pozycję
 * z recepturą z innego produktu).
 */
export function applyIdentity(
  line: LineForm, slot: Slot, value: string, recipes: RecipeLite[],
): LineForm {
  if (slot !== 'productTypeId') return { ...line, [slot]: value }
  const rec = recipes.find(r => r.id === line.recipeId)
  const keep = !!rec && (!rec.productTypeId || rec.productTypeId === value)
  return { ...line, productTypeId: value, recipeId: keep ? line.recipeId : '' }
}

/** Sumy paragonu. */
export function totals(lines: LineForm[]): { count: number; units: number; kg: number } {
  return lines.reduce(
    (a, l) => ({ count: a.count + 1, units: a.units + num(l.qty), kg: a.kg + lineKg(l) }),
    { count: 0, units: 0, kg: 0 },
  )
}

/** Czy dwie pozycje to ten sam produkt (tożsamość + waga) — do podpowiedzi „już taka jest". */
export function sameProduct(a: LineForm, b: LineForm): boolean {
  return a.productTypeId === b.productTypeId
    && a.recipeId === b.recipeId
    && (a.packagingId || '') === (b.packagingId || '')
    && num(a.kgPerUnit) === num(b.kgPerUnit)
}
