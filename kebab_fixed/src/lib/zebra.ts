// Cienki wrapper na Zebra BrowserPrint (globalny obiekt z vendored JS w /public/browserprint).
declare global { interface Window { BrowserPrint?: any } }

let loadPromise: Promise<any> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src; s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Nie udało się wczytać ${src}`))
    document.head.appendChild(s)
  })
}

export async function loadBrowserPrint(): Promise<any> {
  if (window.BrowserPrint) return window.BrowserPrint
  if (!loadPromise) {
    loadPromise = (async () => {
      // Rdzeń klienta (definiuje window.BrowserPrint: getLocalDevices/getDefaultDevice/Device.send).
      // Celuje zawsze w http://localhost:9100 (tam działa usługa). Drugiego pliku Zebra
      // NIE ładujemy — nie mamy go, a fallback SPA zwracał HTML → SyntaxError w konsoli.
      await loadScript('/browserprint/BrowserPrint-3.1.250.min.js')
      if (!window.BrowserPrint) throw new Error('BrowserPrint niedostępny')
      return window.BrowserPrint
    })().catch(e => { loadPromise = null; throw e })
  }
  return loadPromise
}

export interface ZebraDevice { name: string; uid: string; send: (d: string, ok: () => void, err: (e: any) => void) => void }

export async function getDevices(): Promise<{ default: ZebraDevice | null; list: ZebraDevice[] }> {
  const BP = await loadBrowserPrint()
  const def = await new Promise<ZebraDevice | null>((res) =>
    BP.getDefaultDevice('printer', (d: ZebraDevice) => res(d || null), () => res(null)))
  const list = await new Promise<ZebraDevice[]>((res) =>
    BP.getLocalDevices((ds: ZebraDevice[]) => res(ds || []), () => res(def ? [def] : []), 'printer'))
  return { default: def, list: list.length ? list : (def ? [def] : []) }
}

export function sendZpl(device: ZebraDevice, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => device.send(zpl, () => resolve(), (e: any) => reject(e)))
}

/** Usługa Zebra BrowserPrint słucha na http://localhost:9100 (loopback http).
 * Z bezpiecznej strony (https/localhost) Chrome pozwala sięgnąć po http://localhost. */
export function browserPrintBaseUrl(): string {
  return 'http://localhost:9100/'
}

/**
 * Sonda: czy przeglądarka może połączyć się z lokalną usługą Zebra BrowserPrint.
 * Rozróżnia najczęstsze przyczyny „MES nie widzi drukarki mimo działającego BrowserPrint":
 * usługa nieuruchomiona vs zablokowany certyfikat HTTPS (localhost:9101).
 */
export async function probeBrowserPrint(): Promise<{ ok: boolean; reason?: string }> {
  const base = browserPrintBaseUrl()
  // Chrome blokuje dostęp do localhost ze stron, które NIE są bezpiecznym kontekstem
  // (http po adresie IP). Bezpieczny kontekst = https albo localhost.
  const secure = typeof window !== 'undefined' && (window.isSecureContext === true)
  if (!secure) {
    return {
      ok: false,
      reason: 'MES otwarty jako „niezabezpieczony" (http po adresie IP) — Chrome blokuje dostęp do drukarki na localhost. '
        + 'Otwórz MES przez HTTPS: https://<adres>:8443 (zaakceptuj certyfikat). Wtedy druk Zebra zadziała.',
    }
  }
  try {
    // no-cors: interesuje nas OSIĄGALNOŚĆ usługi, nie odczyt odpowiedzi.
    await fetch(base + 'available', { method: 'GET', mode: 'no-cors' })
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'Nie można połączyć z usługą Zebra BrowserPrint (http://localhost:9100). '
        + 'Sprawdź, czy program Zebra BrowserPrint jest uruchomiony na tym komputerze.',
    }
  }
}
