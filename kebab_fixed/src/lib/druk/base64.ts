/** Bajty → base64 kawałkami (PDF z kilkunastu dokumentów przepełniał stos przy jednym String.fromCharCode). */
export function doBase64(bajty: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bajty.length; i += 0x8000) s += String.fromCharCode(...bajty.subarray(i, i + 0x8000))
  return btoa(s)
}

/** base64 → bajty (podgląd wydruku czyta ten sam PDF, który idzie do drukarki). */
export function zBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  return b
}
