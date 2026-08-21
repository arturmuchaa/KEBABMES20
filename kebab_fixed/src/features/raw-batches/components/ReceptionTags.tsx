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
import { useMemo, useState } from 'react'
import { Bookmark, Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fmtKg, fmtDatePl } from '@/lib/utils'

import { LABEL_H_MM, LABEL_W_MM } from '@/features/deboning/byproductLabelZpl'

import { DEFAULT_CONTAINERS_PER_PALLET, planPalletTags } from '../palletTags'
import { receptionTagZpl, type ReceptionTagInput } from '../receptionTagZpl'
import { zplPreviewBoxes } from '../zplPreview'
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
}

export function ReceptionTags({
  reception, defaultContainersPerPallet, onPrint, onRememberLayout, onClose,
  printing = false, message = null,
}: ReceptionTagsProps) {
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
      slaughterDate: w.batch.slaughterDate,
      expiryDate:    w.batch.expiryDate,
      receivedDate:  w.batch.receivedDate || reception.receivedDate,
      full:          t.full,
    }))

  const podglad = wiersze.flatMap(zawieszki)[0] ?? null

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
        <div className="text-sm text-ink-2">
          Razem do wydrukowania:{' '}
          <span className="font-bold text-ink tabular-nums" aria-label="Zawieszek razem">{razem}</span>
          {' '}zawieszek
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

      {podglad && <TagPreview tag={podglad} />}
    </div>
  )
}

/** Podgląd pierwszej zawieszki — rysowany Z SAMEGO ZPL, który pojedzie na
 *  drukarkę. Podgląd odwzorowany osobno rozjeżdżał się z wydrukiem przy
 *  pierwszej zmianie fontu, a biuro decyduje z niego o stosie etykiet. */
function TagPreview({ tag }: { tag: ReceptionTagInput }) {
  // px na mm — na tyle duże, żeby najmniejszy tekst (2,8 mm) dało się czytać.
  const SKALA = 7
  const pola = zplPreviewBoxes(receptionTagZpl(tag))

  return (
    <Card className="w-fit">
      <CardContent className="p-4 space-y-2">
        <CardTitle className="text-xs uppercase text-ink-4">
          Podgląd zawieszki — {LABEL_W_MM} × {LABEL_H_MM} mm
        </CardTitle>
        <div
          className="relative bg-white text-black border border-ink-4 overflow-hidden"
          style={{ width: LABEL_W_MM * SKALA, height: LABEL_H_MM * SKALA,
                   fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {pola.map((p, i) => p.kind === 'text' ? (
            <div
              key={i}
              className="absolute whitespace-pre"
              style={{
                left: p.xMm * SKALA, top: p.yMm * SKALA,
                fontSize: (p.fontMm ?? 3) * SKALA,
                lineHeight: `${(p.fontMm ?? 3) * SKALA}px`,
              }}
            >
              {p.text}
            </div>
          ) : (
            <div
              key={i}
              className="absolute bg-black"
              style={{
                left: p.xMm * SKALA, top: p.yMm * SKALA,
                width: (p.widthMm ?? 0) * SKALA,
                height: Math.max(1, (p.heightMm ?? 0) * SKALA),
              }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
