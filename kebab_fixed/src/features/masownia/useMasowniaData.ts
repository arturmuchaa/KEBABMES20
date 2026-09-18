/**
 * Żywe dane panelu masowania — cztery źródła w jednym miejscu.
 *
 * Wszystkie odświeżają się razem (`useLiveRefresh`): mięso bez wsadów kłamie
 * o wolnych paletach, a wsady bez zleceń nie mają czego pokazać. Dopisanie
 * piątego źródła wystarczy zrobić TUTAJ — reszta ekranu bierze je z jednego
 * zwrotu.
 */
import { useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { masowniaApi, mixingOrdersApi, recipesApi, type MasowniaMeat } from '@/lib/api'

/** Pojemnik z przyprawami, tak jak wraca z backendu (snake_case). */
export interface SpiceCart {
  id: string
  cart_no: number
  order_id: string
  order_no?: string
  recipe_id?: string
  kg_target: number
  /** W ilu workach leżą te przyprawy (200 kg → 1, 600 kg → 3). */
  bags?: number | null
  recipe_name?: string
  status: string
  ingredients: { seq: number; name: string; unit: string; qty: number; weighed: number; manual: boolean }[]
}

/** Wsad stojący w masownicy. */
export interface Charge {
  id: string
  machine_id: number
  order_id: string
  order_no?: string
  recipe_id?: string
  recipe_name?: string
  kg_meat: number
  water_l: number
  batch_no: string
  /** Minuty cyklu skopiowane z receptury przy załadunku (null = standard 50). */
  mix_minutes?: number | null
  status: string
  /** Pusty, dopóki operator nie puści maszyny — cykl liczy się od startu. */
  started_at: string | null
  loaded_at?: string | null
  meat: { pallet_id: string | null; lot_no: string; meat_stock_id: string | null; kg: number }[]
}

const PUSTE_MIESO: MasowniaMeat = { pallets: [], lots: [], taken: {} }

export function useMasowniaData() {
  // PLAN DNIA, nie wszystkie zlecenia: hala ma przed sobą dzisiejszą kolejkę
  // biura, a nie historię masowań z całego miesiąca. Plan jest też jedynym
  // miejscem, z którego bierze się kolejność (day_seq).
  const zlecenia  = useApi(() => mixingOrdersApi.dayPlan().then(p => p.items), [])
  const pojemniki = useApi(() => masowniaApi.carts(), [])
  const wsady     = useApi(() => masowniaApi.charges(), [])
  const mieso     = useApi(() => masowniaApi.meat(), [])
  // Receptury zmieniają się raz na kwartał — nie ma czego odświeżać co 10 s.
  const receptury = useApi(() => recipesApi.list(), [])
  // Podgląd kolejnego numeru partii łączonej. Odświeżany z resztą, bo licznik
  // PP jest wspólny z biurem — numer mógł w międzyczasie pójść do przodu.
  const nastepnePp = useApi(() => masowniaApi.nextPp(), [])
  // Historia dnia pod kafelkiem „Wymieszane" — także źródło dodruku etykiet.
  const dzisiaj = useApi(() => masowniaApi.chargesToday(), [])

  // 10 s: hala pracuje minutami, a nie sekundami — częstsze pytanie tylko
  // obciąża łącze panelu.
  useLiveRefresh({ zlecenia, pojemniki, wsady, mieso, nastepnePp, dzisiaj }, 10_000)

  const odswiez = useCallback(() => {
    zlecenia.refetch()
    pojemniki.refetch()
    wsady.refetch()
    mieso.refetch()
    nastepnePp.refetch()
    dzisiaj.refetch()
  }, [zlecenia.refetch, pojemniki.refetch, wsady.refetch, mieso.refetch, nastepnePp.refetch, dzisiaj.refetch]) // eslint-disable-line

  return {
    zlecenia: (zlecenia.data ?? []) as any[],
    pojemniki: (pojemniki.data ?? []) as SpiceCart[],
    wsady: (wsady.data ?? []) as Charge[],
    mieso: (mieso.data ?? PUSTE_MIESO) as MasowniaMeat,
    receptury: (receptury.data ?? []) as any[],
    nastepnePp: (nastepnePp.data ?? '') as string,
    dzisiaj: (dzisiaj.data ?? []) as Charge[],
    loading: zlecenia.loading && !zlecenia.data,
    error: zlecenia.error || pojemniki.error || wsady.error || mieso.error || '',
    odswiez,
  }
}
