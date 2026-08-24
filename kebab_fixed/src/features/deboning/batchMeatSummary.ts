/**
 * batchMeatSummary — ile mięsa dała partia i gdzie ono pojechało.
 *
 * Po zakończeniu rozbioru kafel partii prowadził WYŁĄCZNIE do ubocznych: nie
 * dało się sprawdzić, ile mięsa z niej zważono, które palety z niej poszły ani
 * ile zostało do rozważenia. Z partii 503 została 24.08.2026 końcówka 422 kg
 * i nie było jej jak dokończyć ani nawet zobaczyć.
 *
 * Przy palecie ŁĄCZONEJ liczymy kilogramy z TEJ partii, nie całą paletę —
 * inaczej końcówka 60 kg wyglądałaby na 200 i bilans partii by skłamał.
 *
 * Czysta funkcja bez DOM.
 */
export interface MeatLotLite {
  lotNo:       string
  kgInitial?:  number
  /** Limit z backendu: wydajność minus to, co już na paletach. */
  kgBulkFree?: number
}

export interface PalletLite {
  palletNo:   string
  kgNet:      number
  containers: number
  lots:       { lotNo: string; kg: number }[]
}

export interface BatchPalletRow {
  palletNo:    string
  kgNet:       number
  containers:  number
  /** Ile Z TEJ partii poszło na tę paletę. */
  kgFromBatch: number
  /** Paleta złożona z kilku partii. */
  mixed:       boolean
}

export interface BatchMeatSummary {
  lotNo:       string
  weighedKg:   number
  onPalletsKg: number
  leftKg:      number
  pallets:     BatchPalletRow[]
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function buildBatchMeatSummary(
  lot: MeatLotLite | null | undefined,
  pallets: PalletLite[],
): BatchMeatSummary {
  if (!lot) {
    return { lotNo: '', weighedKg: 0, onPalletsKg: 0, leftKg: 0, pallets: [] }
  }

  const wiersze: BatchPalletRow[] = []
  let naPaletach = 0
  for (const p of pallets ?? []) {
    const zTej = (p.lots ?? [])
      .filter(l => l.lotNo === lot.lotNo)
      .reduce((s, l) => s + Number(l.kg ?? 0), 0)
    if (zTej <= 0) continue
    naPaletach += zTej
    wiersze.push({
      palletNo:    p.palletNo,
      kgNet:       Number(p.kgNet ?? 0),
      containers:  Number(p.containers ?? 0),
      kgFromBatch: r1(zTej),
      mixed:       (p.lots ?? []).length > 1,
    })
  }

  const weighed = r1(Number(lot.kgInitial ?? 0))
  // Limit z backendu ma pierwszeństwo; gdy go nie ma (starsza wersja),
  // liczymy z tego, co realnie zeszło na palety.
  const left = lot.kgBulkFree != null
    ? r1(Number(lot.kgBulkFree))
    : r1(Math.max(0, weighed - naPaletach))

  return { lotNo: lot.lotNo, weighedKg: weighed, onPalletsKg: r1(naPaletach), leftKg: left, pallets: wiersze }
}
