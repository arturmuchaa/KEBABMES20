import { describe, expect, it } from 'vitest'
import { doBase64 } from './base64'

describe('doBase64', () => {
  it('koduje bajty jak btoa', () => {
    expect(doBase64(new Uint8Array([37, 80, 68, 70]))).toBe('JVBERg==')
  })
  it('duży PDF nie przepełnia stosu', () => {
    const duzy = new Uint8Array(3_000_000).fill(65)
    expect(doBase64(duzy).length).toBe(4_000_000)
  })
})
