/**
 * Baner starych okien etykiet MES (27.11.2026): nowe szablony etykiet kebabów
 * projektuje się w PROTRIMA (moduł Etykiety). Stare szablony zostają, bo
 * drukują etykiety planów sprzed wdrożenia.
 */
export const KOMUNIKAT_ETYKIETY_PROTRIMA =
  'Etykiety kebabów projektuje się teraz w PROTRIMA (moduł Etykiety): A4 z PDF i Zebra z ZebraDesigner. Te stare szablony służą tylko planom sprzed wdrożenia.'

export function EtykietyWProtrima() {
  return (
    <div role="note" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      {KOMUNIKAT_ETYKIETY_PROTRIMA}
    </div>
  )
}
