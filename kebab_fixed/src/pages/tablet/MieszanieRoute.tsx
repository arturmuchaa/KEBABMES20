/**
 * MieszanieRoute — przełącznik widoku masowania (Masownia).
 * Renderuje klasyczny ekran, HMI v1 lub HMI v2 zależnie od trybu
 * (useMixHmiMode). Przełącznik trybu jest w nagłówku TabletLayout
 * (tylko na /tablet/mieszanie). Wszystkie warianty dostępne równolegle
 * do testów, dopóki nie wybierzemy jednego.
 */
import { useMixHmiMode } from '@/features/mixing/useMixHmiMode'
import { MixingTabletPage } from '@/pages/tablet/MixingTabletPage'
import { MixingHmiV1Page } from '@/pages/tablet/MixingHmiV1Page'
import { MixingHmiV2Page } from '@/pages/tablet/MixingHmiV2Page'

export function MieszanieRoute() {
  const mode = useMixHmiMode()
  if (mode === 'v2') return <MixingHmiV2Page />
  if (mode === 'v1') return <MixingHmiV1Page />
  return <MixingTabletPage />
}
