import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtKg(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—'
  return `${Number(v).toFixed(3)} kg`
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  return String(v).substring(0, 10)
}

export function fmtDatetime(v: string | null | undefined): string {
  if (!v) return '—'
  return String(v).substring(0, 19).replace('T', ' ')
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${Number(v).toFixed(1)}%`
}

export function fmtCurrency(v: number | null | undefined, currency = 'PLN'): string {
  if (v == null) return '—'
  return `${Number(v).toFixed(2)} ${currency}`
}

export function expiryStatus(expiryDate: string): 'expired' | 'critical' | 'warning' | 'ok' {
  const now  = new Date()
  const exp  = new Date(expiryDate)
  const days = Math.floor((exp.getTime() - now.getTime()) / 86_400_000)
  if (days < 0)  return 'expired'
  if (days <= 1) return 'critical'
  if (days <= 3) return 'warning'
  return 'ok'
}

export function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}
