/**
 * Strażnik nieistniejących tokenów kolorów.
 *
 * 25.08.2026: okno „Dodaj wyrób gotowy" miało przycisk zapisu z tłem
 * `ink` w odcieniu 700. Taki odcień NIE ISTNIEJE w palecie biura
 * (jest `ink`, `ink-2`…`ink-5`), więc Tailwind nic nie wygenerował i przycisk
 * był BIAŁYM TEKSTEM NA BIAŁYM TLE — z ekranu zniknęła jedyna droga zapisu.
 *
 * Literówka w nazwie tokena nie wywala buildu ani typów; jedyne, co ją łapie,
 * to taki test. Skanuje cały `src`, bo pomylić się da wszędzie.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Odcienie, które paleta faktycznie definiuje (tailwind.config.js). */
const DOZWOLONE = new Set(['2', '3', '4', '5'])
const RODZINY = ['ink', 'surface']

function plikiTsx(dir: string, out: string[] = []): string[] {
  for (const wpis of readdirSync(dir)) {
    const p = join(dir, wpis)
    if (statSync(p).isDirectory()) plikiTsx(p, out)
    else if (/\.tsx?$/.test(wpis)) out.push(p)
  }
  return out
}

describe('paleta biura — tylko istniejące odcienie', () => {
  it('nikt nie używa odcieni spoza palety (widma nic nie generują)', () => {
    const wzor = new RegExp(`\\b(?:bg|text|border|from|to|via|ring|fill|stroke)-(${RODZINY.join('|')})-(\\d+)`, 'g')
    const grzechy: string[] = []

    for (const plik of plikiTsx('src')) {
      // Ten plik z natury zawiera przykłady złych klas w opisach testu.
      if (plik.endsWith('tokenyKolorow.test.ts')) continue
      const tresc = readFileSync(plik, 'utf-8')
      for (const m of tresc.matchAll(wzor)) {
        if (!DOZWOLONE.has(m[2])) grzechy.push(`${plik}: ${m[0]}`)
      }
    }

    expect(grzechy).toEqual([])
  })
})
