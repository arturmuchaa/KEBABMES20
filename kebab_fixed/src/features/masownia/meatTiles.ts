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
  /** Rodzaj surowca — decyduje, SKĄD biorą się kilogramy poza słupkiem. */
  materialTypeId?: string
  /** Wolne kilogramy partii. To już `kg_free` z backendu (netto) — NIE
   *  odejmować rezerwacji drugi raz (pułapka powtórzona 3× w tym module). */
  kgFree: number
  /** Ile kg tej partii trzyma KTÓRE zlecenie: orderId → kg.
   *
   *  Biuro planując masowanie rezerwuje partie, a `kgFree` jest już o te
   *  rezerwacje pomniejszone. Bez oddania własnej rezerwacji operator nie
   *  mógłby wziąć mięsa, które biuro przypisało WŁAŚNIE temu zleceniu —
   *  partia 563 pokazywała 0 kg przy 858 kg na stanie i 1200 kg rezerwacji. */
  reservedByOrder?: Record<string, number>
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
  materialTypeId: string
  mixed: boolean
}

/** Surowiec, który hala waży zbiorczo na słupki (100/200/600/800 kg). */
const NA_SLUPKI = 'mat-mieso-zs'

/**
 * Skąd operator weźmie kilogramy partii, których nie obejmuje żaden słupek.
 *
 * Mięso z/s po rozbiorze idzie NA SŁUPKI — luźne kilogramy znaczą, że ważenie
 * zbiorcze tej partii jeszcze się nie odbyło, i panel ma to powiedzieć wprost
 * zamiast udawać gotowy wsad.
 *
 * Mostek przychodzi w kartonach bez kalibru: hala tnie go na maszynie na płaty
 * i waży tyle, ile trzeba na wsad — tu wpisanie kilogramów jest NORMĄ, nie
 * sygnałem braku.
 */
export function zrodloKg(materialTypeId?: string): 'nie na słupku' | 'utnij i zważ' {
  return (materialTypeId || NA_SLUPKI) === NA_SLUPKI ? 'nie na słupku' : 'utnij i zważ'
}

/**
 * Plakietka rodzaju surowca na kafelku — albo `null`, gdy to codzienne z/s.
 *
 * Masownia miesza głównie mięso z/s, więc podpisywanie go nic nie wnosi, a
 * zaszumia ekran. Za to filet z kurczaka, indyk czy filet z mostka MUSZĄ być
 * widoczne z drugiego końca hali: na palecie i w kartonie wyglądają podobnie,
 * a do maszyny idzie co innego (właściciel, 18.09.2026).
 */
export function plakietkaSurowca(materialName: string, materialTypeId?: string): string | null {
  if ((materialTypeId || NA_SLUPKI) === NA_SLUPKI) return null
  return (materialName || '').trim().toUpperCase() || null
}

export interface MeatTilesInput {
  pallets: TilePallet[]
  lots: TileLot[]
  /** Ile kg zdjęły z palety wsady już załadowane: palletId → kg. */
  taken: Record<string, number>
  /** Zlecenie, które operator właśnie ładuje — jego własne rezerwacje wracają
   *  do puli. Bez tego biuro przypisuje partię, a panel jej nie pokazuje. */
  orderId?: string
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function buildMeatTiles({ pallets, lots, taken, orderId }: MeatTilesInput): MeatTile[] {
  const byLotNo = new Map(lots.map(l => [l.lotNo, l]))
  const tiles: MeatTile[] = []

  /**
   * Ile kilogramów każdej partii JESZCZE ISTNIEJE — magazyn, nie papier.
   *
   * Paleta z ważenia zbiorczego to opis ułożenia, nie stan: zapis zostaje
   * w bazie na zawsze, także gdy mięso dawno zeszło. Na produkcji 524 z 693
   * palet należało do partii z zerowym stanem i zaśmiecało ekran masowni.
   * Dlatego palety wydajemy Z BUDŻETU PARTII: kiedy partia się kończy,
   * kolejne palety po prostu nie mają czego nieść.
   */
  const budzet = new Map(lots.map(l => [
    l.lotNo,
    round1(l.kgFree + (orderId ? (l.reservedByOrder?.[orderId] ?? 0) : 0)),
  ]))

  // Palety w kolejności, w jakiej przychodzą z backendu (dzień produkcji,
  // potem numer) — czyli najstarsza pierwsza, zgodnie z FEFO.
  for (const p of pallets) {
    const wolne = round1(p.kgNet - (taken[p.id] ?? 0))
    if (wolne <= 0) continue
    // Paleta pobrana częściowo oddaje resztę proporcjonalnie ze swoich partii —
    // operator zdejmuje z niej pojemniki, nie warstwy jednej partii.
    const udzial = p.kgNet > 0 ? wolne / p.kgNet : 0

    const skladniki: { lotNo: string; meatStockId: string; kg: number }[] = []
    for (const l of p.lots) {
      const chciane = round1(l.kg * udzial)
      const dostepne = budzet.get(l.lotNo) ?? 0
      const kg = round1(Math.min(chciane, dostepne))
      if (kg <= 0) continue
      budzet.set(l.lotNo, round1(dostepne - kg))
      skladniki.push({
        lotNo: l.lotNo,
        meatStockId: byLotNo.get(l.lotNo)?.meatStockId ?? '',
        kg,
      })
    }

    const suma = round1(skladniki.reduce((s, x) => s + x.kg, 0))
    if (suma <= 0) continue

    tiles.push({
      key: `pallet:${p.id}`,
      kind: 'pallet',
      palletId: p.id,
      palletNo: p.palletNo,
      lots: skladniki,
      kgFree: suma,
      expiryDate: p.expiryDate,
      materialName: byLotNo.get(skladniki[0].lotNo)?.materialName ?? '',
      materialTypeId: byLotNo.get(skladniki[0].lotNo)?.materialTypeId ?? '',
      mixed: new Set(skladniki.map(l => l.lotNo)).size > 1,
    })
  }

  for (const l of lots) {
    // Co zostało po rozdaniu palet — tędy idzie filet z mostka i indyk,
    // których hala nie waży zbiorczo, oraz reszta partii poza słupkami.
    const pozaPaletami = round1(budzet.get(l.lotNo) ?? 0)
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
      materialTypeId: l.materialTypeId ?? '',
      mixed: false,
    })
  }

  return tiles
}
