/**
 * Własne nazwy receptur odbiorcy na HDI.
 *
 * POLAT (31.08.2026, HDI 20/08) chce na dokumencie sam rodzaj i kilogramy,
 * a recepturę „BEYAZ AFIYET" widzieć jako samo „BEYAZ". Formularz kartoteki
 * przysyła na backend CAŁĄ listę, więc wyczyszczone pole musi ZNIKNĄĆ z listy
 * — inaczej stara nazwa dalej schodziłaby na dokument.
 */
import type { ClientRecipeName } from '@/lib/mockApi'

export function recipeNameOf(names: ClientRecipeName[] | undefined, recipeId: string): string {
  return (names ?? []).find(n => n.recipeId === recipeId)?.name ?? ''
}

export function setRecipeName(
  names: ClientRecipeName[] | undefined, recipeId: string, name: string,
): ClientRecipeName[] {
  const bez = (names ?? []).filter(n => n.recipeId !== recipeId)
  return name.trim() ? [...bez, { recipeId, name }] : bez
}
