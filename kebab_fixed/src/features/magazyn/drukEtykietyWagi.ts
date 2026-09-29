/**
 * Druk etykiety ważenia na Zebrze przy panelu magazynu — ten sam most co
 * rozbiór i biuro (BrowserPrint na localhost:9100, CSP kiosku go dopuszcza).
 * Druk niczego nie zapisuje; dodruk = to samo ważenie jeszcze raz na papier.
 */
import type { WazenieMrozni } from '@/lib/api'
import { getDevices, probeBrowserPrint, sendZpl } from '@/lib/zebra'
import { etykietaWagiZpl } from './etykietaWagiZpl'

/** Zwraca null przy sukcesie albo zdanie dla operatora. */
export async function drukujEtykieteWagi(w: WazenieMrozni): Promise<string | null> {
  try {
    const { default: def, list } = await getDevices()
    const dev = def ?? list[0]
    if (!dev) return 'Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona.'
    await sendZpl(dev, etykietaWagiZpl(w, { kod: w.code }))
    return null
  } catch (e) {
    const probe = await probeBrowserPrint().catch(() => ({ ok: false, reason: undefined }))
    return probe.ok ? (e instanceof Error ? e.message : 'Nie udało się wydrukować etykiety')
      : (probe.reason ?? 'Brak połączenia z drukarką etykiet')
  }
}
