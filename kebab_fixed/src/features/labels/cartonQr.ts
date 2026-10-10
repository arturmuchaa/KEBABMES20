import type { QRCodeToDataURLOptions } from 'qrcode'

/** DS2278 / stretch: większy moduł QR, bez zmiany tożsamości kartonu.
 * Rozmiar obejmuje białą strefę ciszy (4 moduły z każdej strony).
 * Q zostaje: H zwiększa gęstość i nie usuwa odblasku folii.
 * Całkowita liczba pikseli na moduł zamiast rozciągania bitmapy do 480 px.
 */
export const CARTON_QR_SIZE_MM = 60
export const CARTON_QR_OPTIONS: QRCodeToDataURLOptions = {
  errorCorrectionLevel: 'Q', margin: 4, scale: 20,
  color: { dark: '#000000', light: '#FFFFFF' },
}

/** Format już rozpoznawany przez backend i skanery MES, także na telefonie.
 * Nie drukujemy hosta (np. tauri.localhost) ani indeksu palety w tablicy.
 * Stare etykiety z URL-em nadal obsługują te same parsery.
 */
export function palletQrPayload(orderId: string, palletNo: number): string {
  return `PAL|${orderId}|${palletNo}`
}
