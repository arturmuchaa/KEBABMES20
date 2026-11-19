/**
 * Ustawienia druku na tym komputerze (`%APPDATA%\KebabMES\druk.json`, wspólne
 * dla MES i PROTRIMA): ustawienia na rodzaj dokumentu i kolory zasobników.
 */
import { natywny } from './natywny'
import type { RodzajDruku } from './rodzaje'
import type { UstawieniaDokumentu } from './typy'

export interface UstawieniaDruku {
  dokumenty: Partial<Record<RodzajDruku, UstawieniaDokumentu>>
  /** drukarka → id opcji zasobnika → kolor papieru */
  koloryZasobnikow: Record<string, Record<string, string>>
}

export async function czytajUstawienia(): Promise<UstawieniaDruku> {
  let surowe: any = {}
  try { surowe = JSON.parse(await natywny.czytajPlik()) ?? {} } catch { surowe = {} }
  return {
    dokumenty: surowe && typeof surowe.dokumenty === 'object' ? surowe.dokumenty : {},
    koloryZasobnikow: surowe && typeof surowe.koloryZasobnikow === 'object' ? surowe.koloryZasobnikow : {},
  }
}

async function zmien(f: (u: UstawieniaDruku) => void): Promise<void> {
  const u = await czytajUstawienia()
  f(u)
  await natywny.zapiszPlik(JSON.stringify(u))
}

export const zapiszDokument = (r: RodzajDruku, d: UstawieniaDokumentu) =>
  zmien(u => { u.dokumenty[r] = d })

export const zapiszKolor = (drukarka: string, opcjaId: string, kolor: string) =>
  zmien(u => {
    const m = { ...(u.koloryZasobnikow[drukarka] ?? {}) }
    if (kolor.trim()) m[opcjaId] = kolor.trim(); else delete m[opcjaId]
    u.koloryZasobnikow[drukarka] = m
  })
