/**
 * ReceptionRegisterHistoryPage — karty rejestru przyjęcia (1.1.1 i 1.1.1/2)
 * do pobrania.
 *
 * Obie karty idą MIESIĄCAMI i zawsze w parze: 1.1.1 rejestruje dostawę,
 * 1.1.1/2 rozbija ją na numery porządkowe. Dlatego jedna strona z dwiema
 * listami, a nie dwie pozycje w menu — biuro drukuje je razem.
 *
 * Numery liczy `lib/haccpCardHistory`, ta sama funkcja co strona wydruku.
 */
import { useMemo, useState } from 'react'
import { haccpFormsApi } from '@/lib/api'
import { receptionCards } from '@/lib/haccpCardHistory'
import { CardHistoryTable, RangePicker } from '@/features/haccp/CardHistoryTable'

const RANGES = [6, 12, 24]

export function ReceptionRegisterHistoryPage() {
  const [range, setRange] = useState(RANGES[0])
  const rows = useMemo(() => receptionCards(range), [range])

  return (
    <div className="animate-fade-in">
      <RangePicker ranges={RANGES} value={range} onChange={setRange} unit="mies." />

      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Karta 1.1.1 — rejestr dostaw
      </div>
      <CardHistoryTable
        rows={rows}
        pdfUrl={haccpFormsApi.receptionPdfUrl}
        printPath="/office/rejestr-przyjecia/druk"
        dayParam="od"
        periodHeader="Miesiąc"
        searchPlaceholder="Filtruj: numer karty lub miesiąc…"
      />

      <div className="mt-5 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Karta 1.1.1/2 — rozbicie na numery porządkowe
      </div>
      <CardHistoryTable
        rows={rows}
        pdfUrl={haccpFormsApi.receptionDetailPdfUrl}
        printPath="/office/rejestr-przyjecia-szczegolowy/druk"
        dayParam="od"
        periodHeader="Miesiąc"
        searchPlaceholder="Filtruj: numer karty lub miesiąc…"
      />
    </div>
  )
}
