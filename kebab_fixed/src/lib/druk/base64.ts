/** Bajty → base64 kawałkami (PDF z kilkunastu dokumentów przepełniał stos przy jednym String.fromCharCode). */
export function doBase64(bajty: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bajty.length; i += 0x8000) s += String.fromCharCode(...bajty.subarray(i, i + 0x8000))
  return btoa(s)
}
