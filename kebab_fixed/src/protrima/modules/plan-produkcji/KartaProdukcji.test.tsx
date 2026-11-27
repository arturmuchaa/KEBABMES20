// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { KartkaProdukcji } from './KartaProdukcji'
import type { SeasonedPallet } from '@/lib/api'

afterEach(cleanup)
const pal = (id: string, nr: number, kg: number, zm: Partial<SeasonedPallet> = {}): SeasonedPallet => ({
  id, qr: `SP|${id}`, palletNo: nr, batchNo: '724', recipeId: 'kir', recipeName: 'KIRMIZI', seasonedMeatId: 'sm', kgWeighed: kg, status: 'in_cold' as const,
  isRemainder: false, parentId: null, labelPrintedAt: null, takenAt: null, takenBy: '', takenPlanId: null, returnedAt: null, kgReturned: null, ...zm,
})

describe('karta produkcji dla kierownika', () => {
  it('pozycje z paletami w kolejności i miejscem na wagę końcówki', () => {
    render(<KartkaProdukcji firma="FHUP" plan={{
      id: 'pl1', planNo: 'PROD/28/11/26', planDate: '2026-11-28', lines: [
        { id: 'l2', position: 2, qty: 20, kgPerUnit: 40, recipeName: 'MIX KIRMIZI', productTypeName: 'KEBAB MIX 70/30', packagingName: 'METAL 65', clientName: 'TRUVA',
          pallets: [pal('u1', 70, 600, { batchNo: '355', materialName: 'UDO', materialTypeId: 'mat-udo' }), pal('f1', 71, 300, { batchNo: '356', materialName: 'FILET', materialTypeId: 'mat-filet' })],
          sklad: [{ materialTypeId: 'mat-udo', nazwa: 'UDO', pct: 70 }, { materialTypeId: 'mat-filet', nazwa: 'FILET', pct: 30 }] },
        { id: 'l1', position: 1, qty: 29, kgPerUnit: 40, recipeName: 'KIRMIZI', productTypeName: 'KEBAB UDO 100%', packagingName: '', clientName: 'YALCIN',
          pallets: [pal('p41', 41, 598), pal('p42', 42, 600, { position: 2 })], sklad: [] },
      ],
    }} />)
    const pozycje = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(pozycje[0]).toMatch(/^1\. 29 × 40 kg KIRMIZI/)
    expect(pozycje[1]).toMatch(/^2\. 20 × 40 kg MIX KIRMIZI/)
    expect(screen.getByText('Paleta 41 · 724 · 598 kg · 14 szt.')).toBeTruthy()
    expect(screen.getByText('Paleta 70 · 355 · UDO · 600 kg · 21 szt.')).toBeTruthy()
    expect(screen.getAllByText(/końcówka z wagi/).length).toBe(4)
    expect(screen.getByText(/przewidywana końcówka ~38 kg/)).toBeTruthy()
  })
})
