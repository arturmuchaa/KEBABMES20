/**
 * Edytor zamówienia PROTRIMA — czysta logika (bez Reacta).
 *
 * Wysyła DOKŁADNIE ten sam CreateClientOrderDto co edytor starego MES
 * (features/orders/order-entry/OrderEntryPage.tsx): przy edycji przekazuje
 * `id` istniejących pozycji, żeby backend uzgodnił wiersze zamiast tworzyć
 * nowe — paleta wskazuje pozycję po id (02.09.2026: „znikają palety”).
 * Kolejność pozycji — ta sama reguła `sortOrderLines`.
 */
import type { ClientOrder, CreateClientOrderDto } from '@/lib/mockApi'
import { emptyLine, type LineForm } from '@/features/orders/order-form/types'
import { num } from '@/features/orders/order-entry/model'
import { sortOrderLines } from '@/features/orders/orderLineSort'

export interface FormZam {
  clientId: string
  orderDate: string
  deliveryDate: string
  notes: string
  lines: LineForm[]
}
export interface Slowniki {
  productTypes: Array<{ id: string; name: string }>
  recipes: Array<{ id: string; name: string; productTypeId?: string; productTypeName?: string }>
  packaging: Array<{ id: string; name: string }>
}

export const nowyFormularz = (dzis: string): FormZam => ({ clientId: '', orderDate: dzis, deliveryDate: '', notes: '', lines: [emptyLine()] })

/** Istniejące zamówienie → formularz (z id pozycji). */
export function zZamowienia(o: ClientOrder, nazwaTulei?: (id: string) => string | undefined): FormZam {
  return {
    clientId: o.clientId,
    orderDate: (o.orderDate || '').slice(0, 10),
    deliveryDate: (o.deliveryDate || '').slice(0, 10),
    notes: o.notes ?? '',
    lines: sortOrderLines(o.lines.map(l => ({
      id: l.id ?? '', qty: String(l.qty), kgPerUnit: String(l.kgPerUnit),
      productTypeId: l.productTypeId, recipeId: l.recipeId, packagingId: l.packagingId ?? '', notes: l.notes ?? '',
    })), nazwaTulei),
  }
}

/**
 * Nowy wiersz bez gramatury i ilości nie jest pozycją — rodzaj, recepturę i tuleję
 * dziedziczy po poprzedniej, więc samo to, że ma tożsamość, nic nie znaczy.
 * Wpisana gramatura już jest zamiarem: bez ilości walidacja to pokaże, a nie zgubi.
 * Istniejąca pozycja (z id) bez ilości to błąd.
 */
export const pustyWiersz = (l: LineForm) => !l.id && !l.qty.trim() && !l.kgPerUnit.trim()

/** Pola wiersza, po których skacze kursor: rodzaj, receptura, tuleja, gramatura, ilość. */
export type PoleWiersza = 'p' | 'r' | 't' | 'k' | 'q'

const ilosc = (l: LineForm) => /^\d+$/.test(l.qty.trim()) && Number(l.qty) > 0

/** Pierwsze pole do uzupełnienia (tuleja jest opcjonalna) — albo null, gdy pozycja kompletna. */
export function pierwszyBrak(l: LineForm): Exclude<PoleWiersza, 't'> | null {
  if (!l.productTypeId) return 'p'
  if (!l.recipeId) return 'r'
  if (!(num(l.kgPerUnit) > 0)) return 'k'
  if (!ilosc(l)) return 'q'
  return null
}

export type Bledy = Record<string, string>

export function walidacja(f: FormZam): Bledy {
  const e: Bledy = {}
  if (!f.clientId) e.client = 'Wybierz klienta.'
  if (!f.orderDate) e.orderDate = 'Podaj datę zamówienia.'
  if (f.deliveryDate && f.orderDate && f.deliveryDate < f.orderDate) e.deliveryDate = 'Termin wyjazdu nie może być wcześniejszy niż data zamówienia.'
  const pozycje = f.lines.filter(l => !pustyWiersz(l))
  if (!pozycje.length) e.lines = 'Dodaj przynajmniej jedną pozycję.'
  f.lines.forEach((l, i) => {
    if (pustyWiersz(l)) return
    if (!l.productTypeId) e[`p${i}`] = 'Wybierz rodzaj.'
    else if (!l.recipeId) e[`r${i}`] = 'Wybierz recepturę.'
    if (!ilosc(l)) e[`q${i}`] = 'Ilość: liczba całkowita sztuk większa od zera.'
    if (!(num(l.kgPerUnit) > 0)) e[`k${i}`] = 'Gramatura musi być większa od zera.'
  })
  return e
}

/** Formularz → DTO, nazwy z kartotek (jak w starym edytorze). */
export function doDto(f: FormZam, s: Slowniki): CreateClientOrderDto {
  return {
    clientId: f.clientId,
    orderDate: f.orderDate,
    deliveryDate: f.deliveryDate || undefined,
    notes: f.notes.trim() || undefined,
    lines: f.lines.filter(l => !pustyWiersz(l)).map(l => ({
      id: l.id || undefined,
      qty: num(l.qty),
      kgPerUnit: num(l.kgPerUnit),
      productTypeId: l.productTypeId,
      productTypeName: s.productTypes.find(p => p.id === l.productTypeId)?.name || s.recipes.find(r => r.id === l.recipeId)?.productTypeName || '',
      recipeId: l.recipeId,
      recipeName: s.recipes.find(r => r.id === l.recipeId)?.name || '',
      packagingId: l.packagingId || undefined,
      packagingName: l.packagingId ? (s.packaging.find(p => p.id === l.packagingId)?.name || '') : undefined,
      notes: l.notes.trim() || undefined,
    })),
  }
}

/**
 * Nowa pozycja dziedziczy rodzaj, recepturę i tuleję po ostatniej; gramaturę i ilość
 * wpisuje biuro — w serii pozycje różnią się zwykle wagą i liczbą sztuk (jak w starym MES).
 */
export function kolejnaPozycja(last?: LineForm): LineForm {
  const e = emptyLine()
  return last ? { ...e, productTypeId: last.productTypeId, recipeId: last.recipeId, packagingId: last.packagingId } : e
}

/**
 * Wiersz „następna pozycja” pod ostatnią KOMPLETNĄ — gotowy z rodzajem, recepturą
 * i tuleją, czeka na gramaturę i ilość. Nie jest w formularzu, dopóki biuro w nim
 * czegoś nie wpisze; dzięki temu Enter, Tab i mysz prowadzą tak samo.
 */
export function wierszNastepny(lines: LineForm[]): LineForm | null {
  const last = lines[lines.length - 1]
  return last && pierwszyBrak(last) === null ? kolejnaPozycja(last) : null
}

/** Usunięcie pozycji, która ma już coś w magazynie lub na paletach, zrywa ich powiązanie — ostrzegamy. */
export function ostrzezenieUsuniecia(o: ClientOrder | null, lineId?: string): string | null {
  if (!o || !lineId) return null
  const l = o.lines.find(x => x.id === lineId)
  if (!l) return null
  const czesci = [(l.qtyStock ?? 0) > 0 ? `${l.qtyStock} szt. w magazynie` : '', (l.qtyDelivered ?? 0) > 0 ? `${l.qtyDelivered} szt. wydane` : ''].filter(Boolean)
  return czesci.length ? `Ta pozycja ma już ${czesci.join(' i ')}. Serwer może odmówić usunięcia.` : null
}

export const sumy = (f: FormZam) => f.lines.filter(l => !pustyWiersz(l)).reduce((a, l) => ({ n: a.n + 1, szt: a.szt + num(l.qty), kg: a.kg + num(l.qty) * num(l.kgPerUnit) }), { n: 0, szt: 0, kg: 0 })
