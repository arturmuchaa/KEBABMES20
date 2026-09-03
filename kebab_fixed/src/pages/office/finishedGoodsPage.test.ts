/**
 * Grupowanie magazynu wyrobu gotowego po SKU.
 *
 * Wiersz magazynu to JEDEN towar, a rodzaj komponentowy jest jego częścią:
 * KEBAB UDO 100% i KEBAB MIX 95/5 to inny skład mięsa, inna cena i inna
 * deklaracja dla klienta — zlanie ich w jedną pozycję pokazuje stan, którego
 * nie ma na regale. Zgłoszone 28.08.2026 z produkcji: „Truva 25 kg udo 100%"
 * i „mix 95/5" schodziły się w jeden wiersz (98 szt.), bo klucz grupowania
 * brał recepturę, tuleję, klienta i wagę, ale NIE brał rodzaju.
 */
import { describe, it, expect } from 'vitest'
import { groupBySku } from './FinishedGoodsPage'
import type { FinishedGoodsItem } from '@/lib/mockApi'

const g = (over: Partial<FinishedGoodsItem> = {}): FinishedGoodsItem => ({
  id: 'g1', batchNo: '270826 507', planId: 'p1', planNo: 'PL-1', planLineId: 'l1',
  productTypeId: 'pt-udo', productTypeName: 'KEBAB UDO 100%',
  recipeId: 'rec-kirmizi', recipeName: 'KIRMIZI',
  packagingId: 'pkg-1', packagingName: 'METAL 65',
  clientName: 'Truva gastro s.r.o.',
  qty: 30, kgPerUnit: 25, totalKg: 750,
  seasonedBatchNos: [], rawBatchNos: [],
  qtyAvailable: 30, qtyShipped: 0,
  producedDate: '2026-08-27', producedBy: [], createdAt: '',
  ...over,
})

describe('groupBySku', () => {
  it('trzyma rodzaje osobno, gdy reszta SKU jest identyczna', () => {
    const out = groupBySku([
      g({ id: 'a', productTypeId: 'pt-udo', productTypeName: 'KEBAB UDO 100%', qtyAvailable: 30 }),
      g({ id: 'b', productTypeId: 'pt-mix', productTypeName: 'KEBAB MIX 95/5', qtyAvailable: 68,
          batchNo: '270826 505/510' }),
    ])
    expect(out).toHaveLength(2)
    expect(out.map(x => x.productTypeName).sort())
      .toEqual(['KEBAB MIX 95/5', 'KEBAB UDO 100%'])
    expect(out.find(x => x.productTypeName === 'KEBAB UDO 100%')!.qty).toBe(30)
    expect(out.find(x => x.productTypeName === 'KEBAB MIX 95/5')!.qty).toBe(68)
  })

  it('nadal skleja partie tego samego rodzaju z różnych dni', () => {
    const out = groupBySku([
      g({ id: 'a', batchNo: '270826 507', producedDate: '2026-08-26', qtyAvailable: 12 }),
      g({ id: 'b', batchNo: '280826 511', producedDate: '2026-08-27', qtyAvailable: 18 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(30)
    expect(out[0].batches).toHaveLength(2)
    // FEFO: najstarsza partia pierwsza
    expect(out[0].batches[0].producedDate).toBe('2026-08-26')
  })

  it('rozdziela rodzaje także wtedy, gdy brakuje id i zostaje sama nazwa', () => {
    const out = groupBySku([
      g({ id: 'a', productTypeId: '', productTypeName: 'KEBAB UDO 100%' }),
      g({ id: 'b', productTypeId: '', productTypeName: 'kebab mix 95/5' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('nie dubluje pozycji przez wielkość liter i spacje w nazwie rodzaju', () => {
    const out = groupBySku([
      g({ id: 'a', productTypeId: '', productTypeName: 'KEBAB UDO 100%' }),
      g({ id: 'b', productTypeId: '', productTypeName: ' kebab udo 100% ' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(60)
  })

  it('scala ten sam widoczny towar mimo różnych ID (plan kontra wpis ręczny)', () => {
    const out = groupBySku([
      g({ id: 'a', productTypeId: 'pt-1', recipeId: 'rec-1', packagingId: 'pkg-1', qtyAvailable: 20 }),
      g({ id: 'b', productTypeId: '', recipeId: 'rec-2', packagingId: '', qtyAvailable: 10 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(30)
    expect(out[0].batches).toHaveLength(2)
  })

  it('scala różne pełne nazwy klienta ze wspólnym skrótem', () => {
    const skrot = (s: string) => (s.startsWith('YALCIN') ? 'YALCIN' : s)
    const out = groupBySku([
      g({ id: 'a', clientName: 'YALCIN FOOD', qtyAvailable: 20 }),
      g({ id: 'b', clientName: 'YALCIN LOGISTICS', qtyAvailable: 10 }),
    ], skrot)
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(30)
  })

  it('bez mapy skrótów różne pełne nazwy to osobne pozycje', () => {
    const out = groupBySku([
      g({ id: 'a', clientName: 'YALCIN FOOD', qtyAvailable: 20 }),
      g({ id: 'b', clientName: 'YALCIN LOGISTICS', qtyAvailable: 10 }),
    ])
    expect(out).toHaveLength(2)
  })
})
