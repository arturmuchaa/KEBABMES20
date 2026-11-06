// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'
import { LinesTab } from './Lines'

/** Zamówienie w kształcie API (syntetyczne): pozycja z uwagą i pozycja bez uwagi. */
const order = () => mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'T/Z/1', client_name: 'T', status: 'confirmed', lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', notes: 'etykieta klienta' },
  { id: 'b', qty: 10, kg_per_unit: 25, recipe_id: 'b', recipe_name: 'BEYAZ', product_type_name: 'UDO' },
] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
afterEach(cleanup)

describe('zakładka Pozycje', () => {
  it('uwaga pozycji jest też pod wyrobem (podpis .so), bo w panelu z boku kolumna Uwagi jest ukryta', () => {
    // Przegląd 0.6.0: na laptopie (panel z boku) uwaga znikała bez śladu.
    render(<AppCtx.Provider value={{} as AppApi}><LinesTab order={order()} /></AppCtx.Provider>)
    const podpisy = screen.getAllByText(/etykieta klienta/).filter(el => el.closest('.so'))
    expect(podpisy).toHaveLength(1)
    expect(document.querySelectorAll('.so.uwaga')).toHaveLength(1)
  })
})
