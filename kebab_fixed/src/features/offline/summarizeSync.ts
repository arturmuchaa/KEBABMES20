/** Wynik dosłania jednego skanu z kolejki offline. */
export interface SyncResult {
  code: string
  ok: boolean
  reason?: string
}

export interface SyncSummary {
  sent: number
  rejected: number
  details: { code: string; reason: string }[]
}

/** Agreguje wyniki synchronizacji kolejki do raportu dla operatora. */
export function summarizeSync(results: SyncResult[]): SyncSummary {
  let sent = 0
  let rejected = 0
  const details: { code: string; reason: string }[] = []
  for (const r of results) {
    if (r.ok) {
      sent += 1
    } else {
      rejected += 1
      details.push({ code: r.code, reason: r.reason || 'odrzucono' })
    }
  }
  return { sent, rejected, details }
}
