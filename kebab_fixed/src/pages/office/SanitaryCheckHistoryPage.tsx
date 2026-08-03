/**
 * SanitaryCheckHistoryPage — historia kart arkusza kontroli techniczno-sanitarnej.
 *
 * Jedna karta = jeden dzień roboczy. Wiersze buduje `lib/haccpCardHistory`,
 * żeby numer na liście i numer na wydruku liczyła jedna funkcja.
 */
import { useMemo, useState } from 'react'
import { haccpFormsApi } from '@/lib/api'
import { sanitaryCards } from '@/lib/haccpCardHistory'
import { CardHistoryTable, RangePicker } from '@/features/haccp/CardHistoryTable'

const RANGES = [30, 90, 365]

export function SanitaryCheckHistoryPage() {
  const [range, setRange] = useState(RANGES[0])
  const rows = useMemo(() => sanitaryCards(range), [range])

  return (
    <div className="animate-fade-in">
      <RangePicker ranges={RANGES} value={range} onChange={setRange} unit="dni" />
      <CardHistoryTable
        rows={rows}
        pdfUrl={haccpFormsApi.sanitaryPdfUrl}
        printPath="/office/arkusz-kontroli/druk"
        dayParam="data"
        periodHeader="Dzień kontroli"
        searchPlaceholder="Filtruj: numer karty lub data…"
      />
    </div>
  )
}
