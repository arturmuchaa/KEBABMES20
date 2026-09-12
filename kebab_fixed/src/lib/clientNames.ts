/**
 * Nazwy odbiorcy na papierze — nazwa handlowa firmy ORAZ własna nazwa
 * receptury tego odbiorcy.
 *
 * Właściciel (2026-09-12) o kartce na paletę: „klient i receptura, ale
 * zgodnie z nazwą zdefiniowaną w ustawieniach, czyli np. POLAT BEYAZ AFIYET,
 * a w ustawieniach ma BEYAZ, czyli na karton pokazuje POLAT BEYAZ".
 *
 * Źródło jest jedno: kartoteka odbiorcy (`client_recipe_names`, pole „Nazwa
 * pozycji na HDI"). Odbiorca ma znać swój wyrób pod JEDNĄ nazwą — tą samą na
 * HDI i na kartce naklejonej na paletę.
 */
import { useCallback, useEffect, useState } from 'react'
import { clientsApi } from '@/lib/api'

/** Wyszukiwarka nazw zbudowana raz z kartoteki odbiorców. */
export interface ClientNameIndex {
  /** pełna nazwa firmy → nazwa handlowa */
  display: Map<string, string>
  /** id odbiorcy → (id receptury → własna nazwa) */
  recipeNames: Map<string, Map<string, string>>
  /** pełna nazwa firmy → id odbiorcy; nazwy niejednoznaczne NIE trafiają tu */
  idByName: Map<string, string>
}

/** Odbiorca, dla którego pytamy o nazwę — id jest pewne, nazwa to ostatnia deska. */
export interface ClientRef { id?: string | null; name?: string | null }

let _cache: ClientNameIndex | null = null
let _loading: Promise<ClientNameIndex> | null = null

/** Zbuduj wyszukiwarkę z listy odbiorców (camelCase z `mapClient` albo surowy
 *  snake_case z backendu — kartoteka bywa czytana jednym i drugim). */
export function buildClientNameIndex(list: any[]): ClientNameIndex {
  const display = new Map<string, string>()
  const recipeNames = new Map<string, Map<string, string>>()
  const idByName = new Map<string, string>()
  const niejednoznaczne = new Set<string>()

  for (const c of list ?? []) {
    const name = (c?.name ?? '').trim()
    const disp = (c?.displayName ?? c?.display_name ?? '').trim()
    const id = (c?.id ?? '').trim()
    if (name) {
      display.set(name, disp || name)
      if (id) {
        const znany = idByName.get(name)
        if (znany && znany !== id) niejednoznaczne.add(name)
        else idByName.set(name, id)
      }
    }
    const wlasne = new Map<string, string>()
    for (const n of (c?.hdiRecipeNames ?? c?.hdi_recipe_names ?? [])) {
      const rid = (n?.recipeId ?? n?.recipe_id ?? '').trim()
      const nazwa = (n?.name ?? '').trim()
      if (rid && nazwa) wlasne.set(rid, nazwa)
    }
    if (id && wlasne.size) recipeNames.set(id, wlasne)
  }

  // Dwie karty o tej samej nazwie (YALCIN to dwie firmy) — bez id odbiorcy
  // nie ma jak zgadnąć, czyja nazwa receptury; wtedy zostaje nazwa z receptury.
  for (const n of niejednoznaczne) idByName.delete(n)

  return { display, recipeNames, idByName }
}

export async function loadClientNameIndex(): Promise<ClientNameIndex> {
  if (_cache) return _cache
  if (!_loading) {
    _loading = clientsApi.list()
      .then((list: any[]) => {
        _cache = buildClientNameIndex(list)
        return _cache
      })
      .catch(() => { _loading = null; return buildClientNameIndex([]) })
  }
  return _loading
}

export function resolveClientName(idx: ClientNameIndex | null, fullName: string): string {
  if (!fullName) return fullName
  return idx?.display.get(fullName.trim()) || fullName
}

/** Nazwa receptury tak, jak nazywa ją TEN odbiorca; bez ustawienia — nazwa
 *  z receptury. */
export function resolveRecipeName(
  idx: ClientNameIndex | null,
  client: ClientRef,
  recipeId: string | null | undefined,
  fallback: string,
): string {
  const rid = (recipeId ?? '').trim()
  if (!idx || !rid) return fallback
  const id = (client.id ?? '').trim() || idx.idByName.get((client.name ?? '').trim()) || ''
  if (!id) return fallback
  return idx.recipeNames.get(id)?.get(rid) || fallback
}

function useClientNameIndex(): ClientNameIndex | null {
  const [idx, setIdx] = useState<ClientNameIndex | null>(_cache)
  useEffect(() => {
    if (idx) return
    let alive = true
    loadClientNameIndex().then(i => { if (alive) setIdx(i) })
    return () => { alive = false }
  }, [idx])
  return idx
}

export function useClientNames(): (fullName: string) => string {
  const idx = useClientNameIndex()
  return useCallback((fullName: string) => resolveClientName(idx, fullName), [idx])
}

/** Funkcja nazywająca recepturę po odbiorcy. Tożsamość zmienia się dopiero
 *  z wczytaniem kartoteki, więc wolno jej stać w zależnościach `useMemo`. */
export function useClientRecipeNames():
  (client: ClientRef, recipeId: string | null | undefined, fallback: string) => string {
  const idx = useClientNameIndex()
  return useCallback(
    (client: ClientRef, recipeId: string | null | undefined, fallback: string) =>
      resolveRecipeName(idx, client, recipeId, fallback),
    [idx])
}
