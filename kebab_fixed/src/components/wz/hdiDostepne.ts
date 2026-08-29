import { WzDoc } from '@/lib/api'

/**
 * Czy do tego WZ wolno wystawić handlowy dokument identyfikacyjny.
 *
 * Trzy warunki, wszystkie z realnej pracy biura:
 *  1. tylko WZ RĘCZNY — dokument z zamówienia ma własną ścieżkę HDI, liczoną
 *     z linii planu produkcji,
 *  2. tylko WZ anulowany ≠ dokument do wystawienia,
 *  3. tylko WZ, który wydaje WYRÓB GOTOWY (`has_fg`). Uboczne — grzbiety,
 *     kości, mięso z/s — niosą identyfikację partii w sekcji „Identyfikacja
 *     partii surowca (HDI)" drukowanej NA SAMYM WZ (`hdiRows.ts`), więc
 *     osobnego dokumentu nie potrzebują. Do 29.08.2026 przycisk stał przy
 *     każdym ręcznym WZ i klik na ubocznych kończył się komunikatem błędu
 *     z backendu („Ten WZ nie wydaje wyrobu gotowego").
 *
 * Backend bez pola `has_fg` (starszy serwer niż ekran) przycisku nie odbiera —
 * wtedy o wszystkim i tak rozstrzyga walidacja przy wystawieniu.
 */
export function mozliweHdiDoWz(doc: WzDoc): boolean {
  const source = (doc as any).source_type ?? doc.sourceType ?? ''
  if (source !== 'manual') return false
  if ((doc.status || '') === 'anulowany') return false
  return (doc as any).has_fg !== false
}
