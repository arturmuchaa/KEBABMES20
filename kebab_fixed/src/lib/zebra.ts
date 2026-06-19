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
      await loadScript('/browserprint/BrowserPrint-3.1.250.min.js')
      // Helper Zebra (status/konfiguracja) — opcjonalny; brak pliku nie blokuje druku ZPL.
      await loadScript('/browserprint/BrowserPrint-Zebra-1.0.5.min.js').catch(() => {})
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
