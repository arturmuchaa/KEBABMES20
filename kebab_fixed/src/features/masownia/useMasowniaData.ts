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
import { masowniaApi, mixingOrdersApi, type MasowniaMeat } from '@/lib/api'

/** Pojemnik z przyprawami, tak jak wraca z backendu (snake_case). */
export interface SpiceCart {
  id: string
  cart_no: number
  order_id: string
  order_no?: string
  recipe_id?: string
  kg_target: number
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
  status: string
  started_at: string
  meat: { pallet_id: string | null; lot_no: string; meat_stock_id: string | null; kg: number }[]
}

const PUSTE_MIESO: MasowniaMeat = { pallets: [], lots: [], taken: {} }

export function useMasowniaData() {
  const zlecenia  = useApi(() => mixingOrdersApi.list(), [])
  const pojemniki = useApi(() => masowniaApi.carts(), [])
  const wsady     = useApi(() => masowniaApi.charges(), [])
  const mieso     = useApi(() => masowniaApi.meat(), [])

  // 10 s: hala pracuje minutami, a nie sekundami — częstsze pytanie tylko
  // obciąża łącze panelu.
  useLiveRefresh({ zlecenia, pojemniki, wsady, mieso }, 10_000)

  const odswiez = useCallback(() => {
    zlecenia.refetch()
    pojemniki.refetch()
    wsady.refetch()
    mieso.refetch()
  }, [zlecenia.refetch, pojemniki.refetch, wsady.refetch, mieso.refetch]) // eslint-disable-line

  return {
    zlecenia: (zlecenia.data ?? []) as any[],
    pojemniki: (pojemniki.data ?? []) as SpiceCart[],
    wsady: (wsady.data ?? []) as Charge[],
    mieso: (mieso.data ?? PUSTE_MIESO) as MasowniaMeat,
    loading: zlecenia.loading && !zlecenia.data,
    error: zlecenia.error || pojemniki.error || wsady.error || mieso.error || '',
    odswiez,
  }
}
