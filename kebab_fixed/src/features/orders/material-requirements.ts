import { fmtKg } from '@/lib/utils'

export interface RawRequirementRow {
  rawTypeId: string
  rawName: string
  kgRaw: number
}

/** "Ćwiartka z kurczaka 140 kg · Filet z kurczaka 30 kg" */
export function fmtRawList(rows: RawRequirementRow[]): string {
  if (!rows || rows.length === 0) return '—'
  const txt = rows
    .filter(r => r.kgRaw > 0)
    .map(r => `${r.rawName} ${fmtKg(r.kgRaw, 0)} kg`)
    .join(' · ')
  return txt || '—'
}
