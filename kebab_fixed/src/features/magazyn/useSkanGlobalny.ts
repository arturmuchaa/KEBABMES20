/**
 * Nasłuch skanera poza polem — mechanizm przeniesiony do `features/scan`
 * (03.10.2026), bo korzysta z niego także główny ekran produkcji. Ten moduł
 * zostaje dla zgodności importów magazynu i jego testów: zachowuje dawny
 * kontrakt `onBlad(komunikat)` — wspólny hook podaje też fragment odczytu,
 * którego magazyn nie używa.
 */
import { useSkanGlobalny as useSkanGlobalnyWspolny } from '@/features/scan/useSkanGlobalny'

export { KONTYNUACJA_MS } from '@/features/scan/useSkanGlobalny'

export function useSkanGlobalny(
  aktywny: boolean,
  onKod: (kod: string) => void,
  /** Nieczytelny / ucięty odczyt — nic nie wysłano, operator ma powtórzyć. */
  onBlad?: (komunikat: string) => void,
): { wyczysc: () => void } {
  // Wspólny hook trzyma callbacki w refach — nowa funkcja co render nie
  // restartuje nasłuchu.
  return useSkanGlobalnyWspolny(aktywny, onKod, onBlad && (komunikat => onBlad(komunikat)))
}
