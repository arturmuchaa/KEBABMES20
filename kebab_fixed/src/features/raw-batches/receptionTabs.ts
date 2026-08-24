/**
 * receptionTabs — przełącznik rodzaju surowca na stronie „Przyjęcie surowca".
 *
 * Numery porządkowe są WSPÓLNE dla całego zakładu: 501 może być ćwiartką,
 * a 502 filetem. Przełącznik rozbijał je na listy per rodzaj, więc szukany
 * numer „ginął" — biuro patrzyło na Ćwiartkę, a numer leżał pod Filetem.
 * Zakładka „Wszystko" zbiera je z powrotem w jeden ciąg.
 *
 * Zero importów z React/UI — czysta logika, testowana w node.
 */

/** Identyfikator zakładki zbiorczej. Nie jest rodzajem surowca — stąd sentinel. */
export const ALL_MATERIALS = '__all__'

/** Dostawy sprzed wprowadzenia rodzajów surowca to ćwiartka. */
export const DEFAULT_MATERIAL = 'mat-cwiartka'

/** Rodzaj surowca z GET /raw-batches/material-types. */
export interface MaterialTypeLike {
  id:                string
  name:              string
  /** Ćwiartka idzie na rozbiór; filet i mięso z/s prosto na magazyn mięsa. */
  requiresDeboning?: boolean
  /** Czy rodzaj wolno przyjąć od dostawcy (uboczne z rozbioru — nie). */
  receivable?:       boolean
}

export interface ReceptionTab {
  id:               string
  name:             string
  requiresDeboning: boolean
}

/** Zakładka „Wszystko" + rodzaje, które faktycznie się przyjmuje. */
export function receptionTabs(types: MaterialTypeLike[]): ReceptionTab[] {
  return [
    // requiresDeboning zakładki zbiorczej nikogo nie obowiązuje — w niej każdy
    // wiersz rozstrzyga to sam (patrz materialLookup).
    { id: ALL_MATERIALS, name: 'Wszystko', requiresDeboning: true },
    ...types
      .filter(m => m.receivable !== false)
      .map(m => ({ id: m.id, name: m.name, requiresDeboning: m.requiresDeboning !== false })),
  ]
}

/** Dostawy widoczne w wybranej zakładce. */
export function batchesForTab<T extends { materialTypeId?: string }>(
  batches: T[], tabId: string,
): T[] {
  if (tabId === ALL_MATERIALS) return batches
  return batches.filter(b => (b.materialTypeId || DEFAULT_MATERIAL) === tabId)
}

/**
 * materialLookup — rodzaj surowca odczytany z DOSTAWY, nie z zakładki.
 *
 * W zakładce „Wszystko" jedna tabela miesza ćwiartkę z filetem, więc nazwa
 * rodzaju i „czy idzie na rozbiór" muszą się rozstrzygać per wiersz: od tego
 * drugiego zależy, czy stan czytamy z dostawy, czy z lotu magazynu mięsa.
 */
export function materialLookup(types: MaterialTypeLike[]): {
  label:            (b: { materialTypeId?: string }) => string
  requiresDeboning: (b: { materialTypeId?: string }) => boolean
} {
  const byId = new Map(types.map(m => [m.id, m]))
  const of = (b: { materialTypeId?: string }) => byId.get(b.materialTypeId || DEFAULT_MATERIAL)
  return {
    // Nieznanego rodzaju nie podmieniamy na „Ćwiartkę" — surowy identyfikator
    // jest brzydki, ale mówi prawdę i daje się wyszukać w bazie.
    label: b => of(b)?.name ?? b.materialTypeId ?? DEFAULT_MATERIAL,
    // Nieznany rodzaj czyta stan z dostawy — tak zachowywały się wszystkie
    // partie, zanim rodzaje w ogóle powstały.
    requiresDeboning: b => of(b)?.requiresDeboning !== false,
  }
}
