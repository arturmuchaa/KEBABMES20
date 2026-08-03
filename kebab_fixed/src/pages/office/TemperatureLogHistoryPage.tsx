/**
 * TemperatureLogHistoryPage — historia kart kontroli temperatury.
 *
 * Jedna karta = jeden tydzień (pon–ndz). Wiersze buduje `lib/haccpCardHistory`
 * na tej samej funkcji `cardPeriod`, której używa wydruk — lista i karta nie
 * mogą pokazywać różnych numerów tego samego dokumentu.
 */
import { useMemo, useState } from 'react'
import { haccpFormsApi } from '@/lib/api'
import { temperatureCards } from '@/lib/haccpCardHistory'
import { CardHistoryTable, RangePicker } from '@/features/haccp/CardHistoryTable'

const RANGES = [12, 26, 53]

export function TemperatureLogHistoryPage() {
  const [range, setRange] = useState(RANGES[0])
  const rows = useMemo(() => temperatureCards(range), [range])

  return (
    <div className="animate-fade-in">
      <RangePicker ranges={RANGES} value={range} onChange={setRange} unit="tyg." />
      <CardHistoryTable
        rows={rows}
        pdfUrl={haccpFormsApi.temperaturePdfUrl}
        printPath="/office/kontrola-temperatury/druk"
        dayParam="od"
        periodHeader="Tydzień"
        searchPlaceholder="Filtruj: numer karty lub data…"
      />
    </div>
  )
}
