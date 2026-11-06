import { describe, it, expect, vi, beforeEach } from 'vitest'

const kursy = vi.hoisted(() => ({ doWydruku: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), zaladunkiApi: kursy }))
import { autaKursow } from './store'

beforeEach(() => { kursy.doWydruku.mockReset(); kursy.get.mockReset() })

describe('auta z kursów czekających na papiery', () => {
  it('znacznik „czeka na biuro” z wz_status pozycji kursu (do_wystawienia/rozjazd tak, wystawiony nie)', async () => {
    kursy.doWydruku.mockResolvedValue([{ id: 'k1', plate: 'KR1', finishedAt: '2026-11-05T08:00:00Z' }])
    kursy.get.mockResolvedValue({ id: 'k1', plate: 'KR1', pozycje: [
      { order_id: 'a', wz_status: 'do_wystawienia' },
      { order_id: 'b', wz_status: 'rozjazd' },
      { order_id: 'c', wz_status: 'wystawiony' },
    ] })
    const auta = await autaKursow()
    expect(auta.a).toMatchObject({ plate: 'KR1', czekaNaBiuro: true })
    expect(auta.b).toMatchObject({ czekaNaBiuro: true })
    expect(auta.c).toMatchObject({ czekaNaBiuro: false })
  })

  it('zamówienie w dwóch kursach: wygrywa kurs, który czeka na biuro (nie starszy, już wystawiony)', async () => {
    // Lista kursów przychodzi od najnowszego.
    kursy.doWydruku.mockResolvedValue([{ id: 'k2', plate: 'KR2' }, { id: 'k1', plate: 'KR1' }])
    kursy.get.mockImplementation(async (id: string) => id === 'k2'
      ? { id: 'k2', plate: 'KR2', pozycje: [{ order_id: 'o1', wz_status: 'do_wystawienia' }] }
      : { id: 'k1', plate: 'KR1', pozycje: [{ order_id: 'o1', wz_status: 'wystawiony' }] })
    expect((await autaKursow()).o1).toMatchObject({ plate: 'KR2', czekaNaBiuro: true })
  })
})
