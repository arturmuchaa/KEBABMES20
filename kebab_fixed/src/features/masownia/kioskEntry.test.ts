/**
 * Kanał kiosku masowni: wejście, konfiguracja Tauri i wersja muszą istnieć
 * i trzymać się wzorca „produkcja" — inaczej instalator nie powstanie.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('kanał kiosku masowanie', () => {
  it('ma własne wejście HTML wskazujące na src/masowanie.tsx', () => {
    expect(read('masowanie.html')).toContain('/src/masowanie.tsx')
  })

  it('jest wpięty w build Vite', () => {
    expect(read('vite.config.ts')).toContain("'masowanie'")
  })

  it('ma konfigurację Tauri z własnym identyfikatorem', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    expect(conf.identifier).toContain('masowanie')
    expect(conf.productName).toMatch(/masowan/i)
  })

  it('kanał aktualizacji nie podszywa się pod inny kiosk', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    const endpoint = conf.plugins.updater.endpoints[0]
    expect(endpoint).toContain('masowanie')
  })

  it('CSP kiosku puszcza drukarkę etykiet na localhost:9100', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    expect(conf.app.security.csp).toContain('localhost:9100')
  })

  it('CSP puszcza serwer MES, bo kiosk nie ma lokalnego backendu', () => {
    const conf = JSON.parse(read('src-tauri/tauri.masowanie.conf.json'))
    expect(conf.app.security.csp).toContain('91.98.105.107:8080')
  })
})
