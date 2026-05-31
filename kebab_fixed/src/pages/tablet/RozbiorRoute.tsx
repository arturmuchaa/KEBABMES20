/**
 * RozbiorRoute — przełącznik widoku rozbioru.
 * Renderuje klasyczny ekran albo HMI v2 zależnie od trybu (useHmiMode).
 * Przełącznik trybu znajduje się w nagłówku TabletLayout (tylko na /tablet/rozbior).
 */
import { useHmiMode } from '@/features/deboning/useHmiMode'
import { DeboningTabletPage } from '@/pages/tablet/DeboningTabletPage'
import { DeboningHmiPage } from '@/pages/tablet/DeboningHmiPage'

export function RozbiorRoute() {
  const mode = useHmiMode()
  return mode === 'v2' ? <DeboningHmiPage /> : <DeboningTabletPage />
}
