/** Bity (1 = czarny) → PNG data URL do podglądu w projektorze (czarno-biały, jak wydruk). */
export function obrazZBitow(bits: Uint8Array, w: number, h: number): string {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const v = bits[i] ? 0 : 255
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}
