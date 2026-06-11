/**
 * RozbiorRoute — przełącznik widoku rozbioru.
 * Renderuje klasyczny ekran, HMI v2 (Clinical Light), HMI v3 (Control Room),
 * HMI v4, lub HMI v5 zależnie od trybu (useHmiMode). Przełącznik trybu jest
 * w nagłówku TabletLayout (tylko na /tablet/rozbior). Wszystkie warianty
 * dostępne równolegle do testów.
 */
import { useHmiMode } from '@/features/deboning/useHmiMode'
import { DeboningTabletPage } from '@/pages/tablet/DeboningTabletPage'
import { DeboningHmiPage } from '@/pages/tablet/DeboningHmiPage'
import { DeboningHmiV3Page } from '@/pages/tablet/DeboningHmiV3Page'
import { DeboningHmiV4Page } from '@/pages/tablet/DeboningHmiV4Page'
import { DeboningHmiV5Page } from '@/pages/tablet/DeboningHmiV5Page'
import { DeboningHmiV6Page } from '@/pages/tablet/DeboningHmiV6Page'
import { DeboningHmiV7Page } from '@/pages/tablet/DeboningHmiV7Page'
import { DeboningHmiV8Page } from '@/pages/tablet/DeboningHmiV8Page'

export function RozbiorRoute() {
  const mode = useHmiMode()
  if (mode === 'v8') return <DeboningHmiV8Page />
  if (mode === 'v7') return <DeboningHmiV7Page />
  if (mode === 'v6') return <DeboningHmiV6Page />
  if (mode === 'v5') return <DeboningHmiV5Page />
  if (mode === 'v4') return <DeboningHmiV4Page />
  if (mode === 'v3') return <DeboningHmiV3Page />
  if (mode === 'v2') return <DeboningHmiPage />
  return <DeboningTabletPage />
}
