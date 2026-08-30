/**
 * Nazwa wyrobu na liście magazynu i na dokumencie WZ.
 *
 * Rodzaj MUSI stać przed recepturą: „KIRMIZI 25kg" to i KEBAB MIX 95/5,
 * i KEBAB UDO 100%, a po wydaniu nie da się ich odróżnić (biuro, 26.08.2026).
 *
 * Ale gdy receptura NIC nie dodaje, powtarza się na dokumencie: WZ/74/08/26
 * dla VATANA drukowało „KEBAB YAPRAK YAPRAK 20kg", bo rodzaj nazywa się
 * KEBAB YAPRAK, a receptura YAPRAK. Recepturę pomijamy WYŁĄCZNIE wtedy, gdy
 * jej słowa już siedzą w nazwie rodzaju — nigdy „dla skrócenia".
 */

function slowa(tekst: string): string[] {
  return tekst.toUpperCase().split(/[^A-Z0-9%/]+/).filter(Boolean)
}

/** Czy receptura nie wnosi do nazwy nic ponad to, co mówi rodzaj. */
export function recepturaJestPowtorzeniem(
  productTypeName: string | undefined | null,
  recipeName: string | undefined | null,
): boolean {
  const rec = slowa(String(recipeName ?? '').trim())
  if (rec.length === 0) return true
  const rodzaj = new Set(slowa(String(productTypeName ?? '').trim()))
  return rec.every(w => rodzaj.has(w))
}

export function zlozNazweWyrobu(
  productTypeName: string | undefined | null,
  recipeName: string | undefined | null,
): string {
  const rodzaj = String(productTypeName ?? '').trim()
  const receptura = String(recipeName ?? '').trim()
  if (!rodzaj) return receptura || 'Wyrób'
  if (recepturaJestPowtorzeniem(rodzaj, receptura)) return rodzaj
  return `${rodzaj} ${receptura}`
}

/**
 * Zwija powtórzone SĄSIEDNIE słowa w gotowej nazwie pozycji.
 *
 * Dokumenty wystawione przed poprawką mają zdublowaną nazwę już zapisaną
 * w `wz_documents.lines` („KEBAB YAPRAK YAPRAK 20kg"). Nie ruszamy zapisu —
 * dokument w bazie ma zostać taki, jaki wyszedł — tylko wydruk pokazuje
 * nazwę bez powtórzenia.
 *
 * Zwijamy WYŁĄCZNIE sąsiedztwa: „KEBAB MIX 95/5 KIRMIZI" zostaje w całości,
 * a nazwa, w której to samo słowo wraca w innym miejscu, też.
 */
export function bezPowtorzonychSlow(name: string | undefined | null): string {
  const tekst = String(name ?? '')
  const czesci = tekst.split(/(\s+)/)
  const out: string[] = []
  let poprzednie = ''
  for (const cz of czesci) {
    if (/^\s+$/.test(cz)) {
      if (out.length) out.push(cz)
      continue
    }
    if (cz.toUpperCase() === poprzednie) {
      // Zdejmij też odstęp, który już trafił do wyniku przed tym słowem.
      if (out.length && /^\s+$/.test(out[out.length - 1])) out.pop()
      continue
    }
    out.push(cz)
    poprzednie = cz.toUpperCase()
  }
  return out.join('')
}
