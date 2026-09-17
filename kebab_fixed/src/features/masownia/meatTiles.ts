/**
 * Kafelki mięsa na panelu masowania.
 *
 * Jedno źródło prawdy to partie magazynu (`meat_stock`) — mięso z rozbioru
 * i mięso kupione z zewnątrz (z/s, filet z mostka, indyk) leżą tam tak samo,
 * więc zakup pokazuje się sam. Palety z ważenia zbiorczego są tylko warstwą
 * fizyczną: tam, gdzie hala zważyła mięso na paletę, operator dotyka palety;
 * gdzie nie zważyła, dotyka partii i wpisuje kg z paleciaka.
 */

export interface TilePallet {
  id: string
  palletNo: string
  kgNet: number
  expiryDate: string
  lots: { lotNo: string; kg: number }[]
}

export interface TileLot {
  meatStockId: string
  lotNo: string
  materialName: string
  /** Wolne kilogramy partii. To już `kg_free` z backendu (netto) — NIE
   *  odejmować rezerwacji drugi raz (pułapka powtórzona 3× w tym module). */
  kgFree: number
  expiryDate: string
}

export interface MeatTile {
  key: string
  kind: 'pallet' | 'lot'
  palletId: string
  palletNo: string
  lots: { lotNo: string; meatStockId: string; kg: number }[]
  kgFree: number
  expiryDate: string
  materialName: string
  mixed: boolean
}

export interface MeatTilesInput {
  pallets: TilePallet[]
  lots: TileLot[]
  /** Ile kg zdjęły z palety wsady już załadowane: palletId → kg. */
  taken: Record<string, number>
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildMeatTiles({ pallets, lots, taken }: MeatTilesInput): MeatTile[] {
  const byLotNo = new Map(lots.map(l => [l.lotNo, l]))
  const tiles: MeatTile[] = []
  /** Ile kg partii siedzi na paletach, które jeszcze stoją wolne. */
  const naPaletach = new Map<string, number>()

  for (const p of pallets) {
    const wolne = round1(p.kgNet - (taken[p.id] ?? 0))
    if (wolne <= 0) continue
    // Paleta pobrana częściowo oddaje resztę proporcjonalnie ze swoich partii —
    // operator zdejmuje z niej pojemniki, nie warstwy jednej partii.
    const udzial = p.kgNet > 0 ? wolne / p.kgNet : 0
    const skladniki = p.lots.map(l => ({
      lotNo: l.lotNo,
      meatStockId: byLotNo.get(l.lotNo)?.meatStockId ?? '',
      kg: round1(l.kg * udzial),
    }))
    for (const s of skladniki) {
      naPaletach.set(s.lotNo, (naPaletach.get(s.lotNo) ?? 0) + s.kg)
    }
    tiles.push({
      key: `pallet:${p.id}`,
      kind: 'pallet',
      palletId: p.id,
      palletNo: p.palletNo,
      lots: skladniki,
      kgFree: wolne,
      expiryDate: p.expiryDate,
      materialName: byLotNo.get(p.lots[0]?.lotNo ?? '')?.materialName ?? '',
      mixed: new Set(p.lots.map(l => l.lotNo)).size > 1,
    })
  }

  for (const l of lots) {
    // Kilogramy partii, których nie obejmuje żadna wolna paleta — tędy idzie
    // filet z mostka i indyk, których hala nie waży zbiorczo.
    const pozaPaletami = round1(l.kgFree - (naPaletach.get(l.lotNo) ?? 0))
    if (pozaPaletami <= 0) continue
    tiles.push({
      key: `lot:${l.meatStockId}`,
      kind: 'lot',
      palletId: '',
      palletNo: '',
      lots: [{ lotNo: l.lotNo, meatStockId: l.meatStockId, kg: pozaPaletami }],
      kgFree: pozaPaletami,
      expiryDate: l.expiryDate,
      materialName: l.materialName,
      mixed: false,
    })
  }

  return tiles
}
