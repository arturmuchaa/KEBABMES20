/**
 * ReceptionTags — ile zawieszek wydrukować na przyjętą dostawę.
 *
 * Dostawa wjeżdża do chłodni PALETAMI, a każda paleta musi mieć własną
 * zawieszkę z numerem porządkowym — inaczej po dwóch dniach nikt nie odróżni,
 * z której dostawy jest stos w rogu.
 *
 * Ekran jest kalkulatorem, nie formularzem: nic nie zapisuje do księgi.
 * Zmiana kalibru i układu palety przelicza liczbę zawieszek na oczach, bo to
 * jedyny moment, w którym biuro może złapać pomyłkę przed wydrukiem stosu
 * etykiet. Jedyny zapis to opcjonalne zapamiętanie układu palety u dostawcy.
 *
 * Cała matematyka siedzi w `palletTags`; tu jest tylko ekran.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Bookmark, Crosshair, Printer, RotateCcw, SlidersHorizontal, Stethoscope, X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fmtKg, fmtDatePl } from '@/lib/utils'

import { DEFAULT_CONTAINERS_PER_PALLET, planPalletTags } from '../palletTags'
import type { ReceptionTagInput } from '../receptionTagZpl'
import {
  DEFAULT_CALIBRATION, LABEL_LENGTH_MAX_MM, LABEL_LENGTH_MIN_MM, OFFSET_MAX_MM,
  clampCalibration, fmtOffsetMm, isDefaultCalibration, tearOffMaxMm,
  type TagPrinterCalibration,
} from '../tagPrinterCalibration'
import type { Reception, ReceptionBatch } from '../types'

/** Układy, których używają dostawcy: 9 albo 8 pojemników na warstwę × 4 warstwy. */
const PRESETY = [
  { naWarstwe: 9, perPallet: 36 },
  { naWarstwe: 8, perPallet: 32 },
]

interface Ustawienie {
  containerKg: number | null
  perPallet: number
  /** Czy trzymamy się liczby pojemników przeliczonej ręcznie na rampie. */
  reczneLiczenie: boolean
}

export interface ReceptionTagsProps {
  reception: Reception
  /** Układ palety zapamiętany dla dostawcy (albo domyślny). */
  defaultContainersPerPallet: number
  onPrint: (tags: ReceptionTagInput[]) => void
  onRememberLayout?: (perPallet: number) => void
  onClose: () => void
  printing?: boolean
  /** Komunikat druku (błąd BrowserPrint albo potwierdzenie). */
  message?: { ok: boolean; text: string } | null
  /** Nastawa drukarki tego stanowiska; brak = ekran bez kalibracji. */
  calibration?: TagPrinterCalibration
  onCalibrationChange?: (cal: TagPrinterCalibration) => void
  /** `~JC` — drukarka sama mierzy etykietę i przerwę. */
  onCalibratePrinter?: () => void
  /** Wydruk testowy z ramką po krawędzi etykiety. */
  onTestPrint?: () => void
  /** Odczyt ustawień z drukarki (`^HH`) — długość etykiety, odrywanie, tryb. */
  onReadPrinter?: () => void
  /** Surowa odpowiedź drukarki; null = jeszcze nie pytaliśmy. */
  printerInfo?: string | null
}

export function ReceptionTags({
  reception, defaultContainersPerPallet, onPrint, onRememberLayout, onClose,
  printing = false, message = null,
  calibration, onCalibrationChange, onCalibratePrinter, onTestPrint,
  onReadPrinter, printerInfo = null,
}: ReceptionTagsProps) {
  const [kalibracjaOtwarta, setKalibracjaOtwarta] = useState(false)
  const kalibracja = calibration ?? DEFAULT_CALIBRATION
  // Anulowany numer porządkowy nie pojechał do chłodni — zawieszka na niego
  // to etykieta na paletę, której nie ma.
  const batches = useMemo(
    () => reception.batches.filter(b => b.status !== 'cancelled'),
    [reception.batches])

  const [ustawienia, setUstawienia] = useState<Record<string, Ustawienie>>(() =>
    Object.fromEntries(batches.map(b => [b.id, {
      containerKg: b.containerKg ?? null,
      perPallet: defaultContainersPerPallet || DEFAULT_CONTAINERS_PER_PALLET,
      reczneLiczenie: b.containersCount != null,
    }])))

  const ust = (b: ReceptionBatch): Ustawienie => ustawienia[b.id] ?? {
    containerKg: b.containerKg ?? null,
    perPallet: defaultContainersPerPallet || DEFAULT_CONTAINERS_PER_PALLET,
    reczneLiczenie: b.containersCount != null,
  }

  const zmien = (id: string, patch: Partial<Ustawienie>) =>
    setUstawienia(p => ({ ...p, [id]: { ...p[id], ...patch } }))

  const wiersze = batches.map(b => {
    const u = ust(b)
    return {
      batch: b,
      ustawienie: u,
      plan: planPalletTags({
        batchNo: b.internalBatchNo,
        kg: b.kgReceived,
        containerKg: u.containerKg,
        // Ręczne liczenie przestaje obowiązywać, gdy biuro zmieni kaliber:
        // wtedy pyta właśnie o przeliczenie na nowo.
        containersCount: u.reczneLiczenie ? b.containersCount : null,
        containersPerPallet: u.perPallet,
      }),
    }
  })

  const razem = wiersze.reduce((s, w) => s + w.plan.tags.length, 0)
  const brakKalibru = wiersze.some(w => w.plan.containers === null)
  const doZapamietania = wiersze[0]?.ustawienie.perPallet ?? DEFAULT_CONTAINERS_PER_PALLET

  /** Zawieszki jednego numeru porządkowego, gotowe do druku. */
  const zawieszki = (w: typeof wiersze[number]): ReceptionTagInput[] =>
    w.plan.tags.map(t => ({
      receptionNo:   reception.receptionNo,
      supplierName:  reception.supplierName,
      batchNo:       t.batchNo,
      netKg:         t.netKg,
      containers:    t.containers,
      containerKg:   w.ustawienie.containerKg,
      palletIndex:   t.palletIndex,
      palletCount:   t.palletCount,
      batchKg:       w.batch.kgReceived,
      // Sekcja identyfikacji z HDI, a gdy jej nie ma — numer wpisany na
      // przyjęciu. Zawieszka pokazuje WSZYSTKIE loty tego numeru porządkowego.
      supplierBatchNos: (w.batch.supplierBatches ?? []).length > 0
        ? w.batch.supplierBatches.map(sb => sb.supplierBatchNo)
        : [w.batch.supplierBatchNo],
      slaughterDate: w.batch.slaughterDate,
      expiryDate:    w.batch.expiryDate,
      receivedDate:  w.batch.receivedDate || reception.receivedDate,
      full:          t.full,
    }))

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-ink">Zawieszki na palety</h1>
          <p className="text-sm text-ink-3">
            Przyjęcie <code className="font-mono font-bold text-primary">{reception.receptionNo}</code>
            {' · '}{reception.supplierName || '—'}
            {' · '}{fmtDatePl(reception.receivedDate)}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} className="gap-2">
          <X size={14} /> Zamknij
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CardDescription>Układ palety u dostawcy:</CardDescription>
            {PRESETY.map(p => (
              <Button
                key={p.perPallet}
                variant={doZapamietania === p.perPallet ? 'default' : 'outline'}
                size="sm"
                aria-label={`Układ ${p.naWarstwe} na warstwę`}
                onClick={() => setUstawienia(prev => Object.fromEntries(
                  batches.map(b => [b.id, { ...ust(b), ...prev[b.id], perPallet: p.perPallet }])))}
              >
                {p.naWarstwe} na warstwę = {p.perPallet} poj.
              </Button>
            ))}
            {onRememberLayout && (
              <Button
                variant="ghost" size="sm" className="gap-2 ml-auto"
                aria-label="Zapamiętaj układ dla dostawcy"
                onClick={() => onRememberLayout(doZapamietania)}
              >
                <Bookmark size={14} />
                Zapamiętaj {doZapamietania} poj./paletę dla tego dostawcy
              </Button>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-4 text-left text-[11px] uppercase text-ink-4">
                <th className="py-2 pr-3 font-semibold">Nr porządkowy</th>
                <th className="py-2 pr-3 font-semibold text-right">Waga netto</th>
                <th className="py-2 pr-3 font-semibold">Kaliber [kg]</th>
                <th className="py-2 pr-3 font-semibold">Poj. na palecie</th>
                <th className="py-2 pr-3 font-semibold text-right">Pojemników</th>
                <th className="py-2 pr-3 font-semibold">Palety</th>
                <th className="py-2 pr-3 font-semibold text-right">Zawieszek</th>
                <th className="py-2 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {wiersze.map(w => (
                <tr key={w.batch.id}>
                  <td className="py-2 pr-3">
                    <code className="font-mono font-bold text-primary">{w.batch.internalBatchNo}</code>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                    {fmtKg(w.batch.kgReceived, 1)}
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number" min={1} step={1} className="h-8 w-20"
                      aria-label={`Kaliber ${w.batch.internalBatchNo}`}
                      value={w.ustawienie.containerKg ?? ''}
                      onChange={e => zmien(w.batch.id, {
                        containerKg: e.target.value === '' ? null : Number(e.target.value),
                        reczneLiczenie: false,
                      })}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number" min={1} step={1} className="h-8 w-20"
                      aria-label={`Pojemników na palecie ${w.batch.internalBatchNo}`}
                      value={w.ustawienie.perPallet}
                      onChange={e => zmien(w.batch.id, { perPallet: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-2"
                      aria-label={`Pojemników ${w.batch.internalBatchNo}`}>
                    {w.plan.containers ?? '—'}
                  </td>
                  <td className="py-2 pr-3 text-ink-2"
                      aria-label={`Palety ${w.batch.internalBatchNo}`}>
                    {w.plan.containers === null
                      ? '—'
                      : `${w.plan.fullPallets} pełnych`
                        + (w.plan.restContainers > 0 ? ` + ${w.plan.restContainers} poj.` : '')}
                  </td>
                  <td className="py-2 pr-3 text-right font-bold tabular-nums text-ink"
                      aria-label={`Zawieszek ${w.batch.internalBatchNo}`}>
                    {w.plan.containers === null ? '—' : w.plan.tags.length}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="outline" size="sm" className="gap-2"
                      aria-label={`Drukuj ${w.batch.internalBatchNo}`}
                      disabled={printing || w.plan.tags.length === 0}
                      onClick={() => onPrint(zawieszki(w))}
                    >
                      <Printer size={14} /> Drukuj
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {brakKalibru && (
            <p className="text-xs text-amber-700">
              Uzupełnij kaliber pojemnika — bez niego nie wiadomo, ile pojemników
              przyjechało, a zawieszki nie mogą zgadywać liczby palet.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-ink-2">
          <span>
            Razem do wydrukowania:{' '}
            <span className="font-bold text-ink tabular-nums" aria-label="Zawieszek razem">{razem}</span>
            {' '}zawieszek
          </span>
          {onCalibrationChange && (
            <Button
              variant="ghost" size="sm" className="gap-2"
              aria-label="Kalibracja drukarki"
              aria-expanded={kalibracjaOtwarta}
              onClick={() => setKalibracjaOtwarta(o => !o)}
            >
              <SlidersHorizontal size={14} />
              Kalibracja drukarki
              {!isDefaultCalibration(kalibracja) && (
                <span className="font-mono text-[11px] text-primary">
                  {fmtOffsetMm(kalibracja.offsetXMm)} / {fmtOffsetMm(kalibracja.offsetYMm)} mm
                </span>
              )}
            </Button>
          )}
        </div>
        <Button
          className="gap-2" disabled={printing || razem === 0}
          aria-label="Drukuj wszystkie"
          onClick={() => onPrint(wiersze.flatMap(zawieszki))}
        >
          <Printer size={14} />
          {printing ? 'Drukowanie…' : 'Drukuj wszystkie'}
        </Button>
      </div>

      {message && (
        <p className={message.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>
          {message.text}
        </p>
      )}

      {kalibracjaOtwarta && onCalibrationChange && (
        <PrinterCalibration
          calibration={kalibracja}
          onChange={onCalibrationChange}
          onCalibratePrinter={onCalibratePrinter}
          onTestPrint={onTestPrint}
          onReadPrinter={onReadPrinter}
          printerInfo={printerInfo}
          busy={printing}
        />
      )}
    </div>
  )
}

/**
 * Kalibracja drukarki zawieszek — regulacja STANOWISKA, nie układu etykiety.
 *
 * Kolejność ma znaczenie i dlatego ekran ją narzuca: najpierw „Kalibruj
 * etykiety" (drukarka mierzy taśmę czujnikiem), potem dopiero dosuwanie
 * milimetrami. Odwrotnie kończy się tak, że nastawa kompensuje źle zmierzoną
 * taśmę i po wymianie rolki wszystko trzeba ustawiać od nowa.
 */
function PrinterCalibration({
  calibration, onChange, onCalibratePrinter, onTestPrint, onReadPrinter, printerInfo, busy,
}: {
  calibration: TagPrinterCalibration
  onChange: (cal: TagPrinterCalibration) => void
  onCalibratePrinter?: () => void
  onTestPrint?: () => void
  onReadPrinter?: () => void
  printerInfo?: string | null
  busy: boolean
}) {
  const maxTear = tearOffMaxMm()
  const zmien = (patch: Partial<TagPrinterCalibration>) =>
    onChange(clampCalibration({ ...calibration, ...patch }))

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-sm">Kalibracja drukarki</CardTitle>
            <CardDescription className="max-w-2xl">
              Jeśli zawieszki schodzą przesunięte, zacznij od „Kalibruj etykiety" — drukarka
              wypuści kilka sztuk i sama zmierzy etykietę z przerwą. Przesunięcia poniżej
              dosuwają sam WYDRUK i pamięta je ten komputer. <strong>Punkt odrywania</strong> to
              nastawa samej drukarki: zapisuje się w niej i zostaje tam także po wyłączeniu —
              druk zawieszek już jej nie rusza.
            </CardDescription>
          </div>
          <Button
            variant="ghost" size="sm" className="gap-2 flex-shrink-0"
            aria-label="Wyzeruj kalibrację" disabled={busy}
            onClick={() => onChange({ ...DEFAULT_CALIBRATION })}
          >
            <RotateCcw size={14} /> Wyzeruj
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm" className="gap-2"
            aria-label="Kalibruj etykiety" disabled={busy || !onCalibratePrinter}
            onClick={() => onCalibratePrinter?.()}
          >
            <Crosshair size={14} /> Kalibruj etykiety
          </Button>
          <Button
            variant="outline" size="sm" className="gap-2"
            aria-label="Wydruk testowy" disabled={busy || !onTestPrint}
            onClick={() => onTestPrint?.()}
          >
            <Printer size={14} /> Wydruk testowy
          </Button>
          <Button
            variant="outline" size="sm" className="gap-2"
            aria-label="Odczytaj ustawienia drukarki" disabled={busy || !onReadPrinter}
            onClick={() => onReadPrinter?.()}
          >
            <Stethoscope size={14} /> Odczytaj ustawienia
          </Button>
        </div>

        {/* Odpowiedź drukarki na `^HH`: długość etykiety, punkt odrywania, tryb
            mediów. Bez tego ustawienia drukarki są czarną skrzynką, a szukanie
            przyczyny rozjechanego cięcia schodzi do zgadywania. */}
        {printerInfo && (
          <div className="space-y-1">
            <div className="text-[11px] uppercase font-semibold text-ink-4">
              Co mówi drukarka
            </div>
            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap
                            max-h-64 overflow-auto p-3 rounded bg-surface-2
                            border border-surface-4 text-ink-2">
              {printerInfo}
            </pre>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Nudge
            label="Przesunięcie w poprzek taśmy" hint="plus przesuwa w prawo"
            value={calibration.offsetXMm} step={0.5} min={-OFFSET_MAX_MM} max={OFFSET_MAX_MM}
            disabled={busy} onChange={v => zmien({ offsetXMm: v })}
          />
          <Nudge
            label="Przesunięcie wzdłuż taśmy" hint="plus przesuwa w dół"
            value={calibration.offsetYMm} step={0.5} min={-OFFSET_MAX_MM} max={OFFSET_MAX_MM}
            disabled={busy} onChange={v => zmien({ offsetYMm: v })}
          />
          <Nudge
            label="Punkt odrywania"
            hint="minus cofa taśmę — gdy odrywa się już w następnej etykiecie"
            value={calibration.tearOffMm} step={1} min={-maxTear} max={maxTear}
            disabled={busy} onChange={v => zmien({ tearOffMm: v })}
          />
          <MmField
            label="Skok taśmy" hint="etykieta razem z przerwą, zmierzona linijką (zawieszka: 80 mm)"
            value={calibration.labelLengthMm} min={LABEL_LENGTH_MIN_MM} max={LABEL_LENGTH_MAX_MM}
            disabled={busy} onCommit={v => zmien({ labelLengthMm: v })}
          />
        </div>
      </CardContent>
    </Card>
  )
}

/** Regulacja krokiem — po jednym milimetrze widać efekt na taśmie, a wpisywanie
 *  liczby z klawiatury kusi do „na oko o pięć". */
function Nudge({ label, hint, value, step, min, max, disabled, onChange }: {
  label: string
  hint: string
  value: number
  step: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const przesun = (krok: number) =>
    onChange(Math.round(Math.min(max, Math.max(min, value + krok)) * 10) / 10)

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase font-semibold text-ink-4">{label}</div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm" className="w-16 font-bold"
          aria-label={`${label} mniej`} disabled={disabled || value <= min}
          onClick={() => przesun(-step)}
        >
          − {step}
        </Button>
        <span className="w-20 text-center font-mono font-bold text-ink tabular-nums"
              aria-label={label}>
          {fmtOffsetMm(value)} mm
        </span>
        <Button
          variant="outline" size="sm" className="w-16 font-bold"
          aria-label={`${label} więcej`} disabled={disabled || value >= max}
          onClick={() => przesun(step)}
        >
          + {step}
        </Button>
      </div>
      <div className="text-[11px] text-ink-4">{hint}</div>
    </div>
  )
}

/** Wartość MIERZONA linijką, więc wpisywana z klawiatury. Bufor tekstowy, bo
 *  przycinanie do zakresu przy każdym znaku nie pozwoliłoby skasować cyfry. */
function MmField({ label, hint, value, min, max, disabled, onCommit }: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const [tekst, setTekst] = useState(String(value))
  useEffect(() => setTekst(String(value)), [value])

  const zatwierdz = () => {
    const n = Number(tekst.replace(',', '.'))
    onCommit(Number.isFinite(n) ? n : value)
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase font-semibold text-ink-4">{label}</div>
      <div className="flex items-center gap-2">
        <Input
          type="number" min={min} max={max} step={1} className="h-8 w-24"
          aria-label={label} disabled={disabled} value={tekst}
          onChange={e => setTekst(e.target.value)}
          onBlur={zatwierdz}
          onKeyDown={e => { if (e.key === 'Enter') zatwierdz() }}
        />
        <span className="text-sm text-ink-3">mm</span>
      </div>
      <div className="text-[11px] text-ink-4">{hint}</div>
    </div>
  )
}
