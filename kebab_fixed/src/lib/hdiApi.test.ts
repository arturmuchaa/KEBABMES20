// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { hdiApi } from './api'

afterEach(() => vi.unstubAllGlobals())

it('parametr preliminary jest wysyłany tylko po jawnym wyborze', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'h1' }) })
  vi.stubGlobal('fetch', fetch)
  await hdiApi.generate('VATAN/1')
  expect(fetch.mock.calls[0][0]).toBe('/api/hdi/generate?order_id=VATAN%2F1')
  await hdiApi.generate('VATAN/1', true)
  expect(fetch.mock.calls[1][0]).toBe('/api/hdi/generate?order_id=VATAN%2F1&preliminary=true')
  expect(fetch.mock.calls[1][1].method).toBe('POST')
})
