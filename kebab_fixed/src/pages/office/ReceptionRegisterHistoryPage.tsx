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
  // Karta pusta = dotychczasowy druk do wypełnienia długopisem. Z danymi =
  // MES wpisuje to, co wie (numery przyjęcia i porządkowe, dostawca,
  // asortyment, daty, dokument); kolumny oceny i temperatur zostają puste,
  // bo to zapis z pomiaru przy aucie.
  const [withData, setWithData] = useState(false)
  const rows = useMemo(() => receptionCards(range), [range])

  const suffix = withData ? '?dane=1' : ''
  const pdf = (fn: (day: string) => string) =>
    (day: string) => `${fn(day)}${withData ? '&dane=1' : ''}`

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <RangePicker ranges={RANGES} value={range} onChange={setRange} unit="mies." />
        <div className="flex gap-1.5">
          {[
            { on: false, label: 'Karta pusta' },
            { on: true,  label: 'Wypełniona z systemu' },
          ].map(o => (
            <button key={o.label}
              onClick={() => setWithData(o.on)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                withData === o.on
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {withData && (
        <div className="mt-2 mb-3 text-[11px] text-ink-3 leading-snug space-y-1">
          {/* Obie karty zachowują się INACZEJ i operator musi to wiedzieć
              przed drukiem, inaczej wydrukuje 1.1.1, której nie da się już
              dokończyć: temperatury mierzy się przy aucie, a nie na koniec
              miesiąca nad gotowym wydrukiem. */}
          <div>
            <strong>Karta 1.1.1/2</strong> drukuje się kompletna — nie ma kolumn
            mierzonych przy dostawie. Ręcznie zostają tylko uwagi i podpis.
          </div>
          <div>
            <strong>Karta 1.1.1</strong> dostaje wyłącznie kolumny a–e (numer
            przyjęcia, dostawca, asortyment, data, dokument). Ocena wizualna,
            temperatury, zgodność i kwalifikacja powstają przy aucie, więc
            wydruku z danymi <strong>nie da się już uzupełnić</strong> — służy do
            sprawdzenia albo odtworzenia karty, a nie zamiast niej.
          </div>
        </div>
      )}

      <div className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Karta 1.1.1 — rejestr dostaw
      </div>
      <CardHistoryTable
        rows={rows}
        pdfUrl={pdf(haccpFormsApi.receptionPdfUrl)}
        printPath={`/office/rejestr-przyjecia/druk${suffix}`}
        dayParam="od"
        periodHeader="Miesiąc"
        searchPlaceholder="Filtruj: numer karty lub miesiąc…"
      />

      <div className="mt-5 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Karta 1.1.1/2 — rozbicie na numery porządkowe
      </div>
      <CardHistoryTable
        rows={rows}
        pdfUrl={pdf(haccpFormsApi.receptionDetailPdfUrl)}
        printPath={`/office/rejestr-przyjecia-szczegolowy/druk${suffix}`}
        dayParam="od"
        periodHeader="Miesiąc"
        searchPlaceholder="Filtruj: numer karty lub miesiąc…"
      />
    </div>
  )
}
