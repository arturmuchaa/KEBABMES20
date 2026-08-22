/**
 * ReceptionPreviewPage — arkusz dostawy do CZYTANIA, na pełnej stronie.
 *
 * Dotąd jedynym sposobem, żeby zobaczyć cały dokument (pozycje HDI, numery
 * porządkowe, daty, pojemniki), było otwarcie EDYCJI (biuro, 22.08.2026).
 * Otwarty formularz edycji to zaproszenie do przypadkowej zmiany w dokumencie,
 * który bywa już rozliczony — a przy pozycji zamrożonej edycja w ogóle się nie
 * otworzy. Podgląd nic nie zapisuje i działa też na dostawach z historii.
 *
 * Rachunek arkusza siedzi w `receptionPreview`; tutaj jest samo rysowanie.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileText, Paperclip, Pencil, Tags, X } from 'lucide-react'

import { useApi } from '@/hooks/useApi'
import { receptionsApi } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { fmtKg, fmtPln, fmtDatePl } from '@/lib/utils'

import { HdiScanViewer } from '../components/HdiScanViewer'
import { previewRows, receptionPreviewSummary } from '../receptionPreview'

const LIST_PATH = '/office/raw-batches'

export function ReceptionPreviewPage() {
  const { receptionId = '' } = useParams()
  const navigate = useNavigate()
  const [skanOtwarty, setSkanOtwarty] = useState(false)

  const reception = useApi(() => receptionsApi.byId(receptionId), [receptionId])
  const rec = reception.data

  if (!rec) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {reception.error ?? 'Wczytywanie dostawy…'}
      </div>
    )
  }

  const wiersze = previewRows(rec)
  const suma = receptionPreviewSummary(rec)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-ink">Przyjęcie surowca</h1>
          <p className="text-sm text-ink-3">
            <code className="font-mono font-bold text-primary">{rec.receptionNo}</code>
            {' · '}{rec.supplierName || '—'}
            {' · '}{fmtDatePl(rec.receivedDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="gap-2"
            aria-label="Zawieszki na palety"
            onClick={() => navigate(`${LIST_PATH}/${rec.id}/zawieszki`)}
          >
            <Tags size={14} /> Zawieszki
          </Button>
          <Button
            variant="outline" size="sm" className="gap-2"
            aria-label="Edytuj przyjęcie"
            onClick={() => navigate(`${LIST_PATH}/${rec.id}/edycja`)}
          >
            <Pencil size={14} /> Edycja
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate(LIST_PATH)}>
            <X size={14} /> Zamknij
          </Button>
        </div>
      </div>

      {/* Nagłówek dokumentu — to, co biuro przepisuje z papieru dostawcy. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <CardTitle className="text-sm">Dokument dostawy</CardTitle>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4 text-sm">
            <Pole label="Numer przyjęcia" value={rec.receptionNo} mono />
            <Pole label="Data przyjęcia" value={fmtDatePl(rec.receivedDate)} />
            <Pole label="Dostawca" value={rec.supplierName || '—'} />
            <Pole label="Dokument dostawcy" value={rec.documentNo || '—'} mono />
            <Pole label="Numer HDI" value={rec.hdiNo || '—'} mono />
            <div className="space-y-1">
              <dt className="text-[11px] uppercase font-semibold text-ink-4">Skan HDI</dt>
              <dd>
                {rec.hdiScan ? (
                  // Skan otwieramy KODEM, nie linkiem: dokumentów pilnuje RBAC,
                  // a `<a href>` nie niesie sesji (401).
                  <button
                    type="button"
                    onClick={() => setSkanOtwarty(true)}
                    className="inline-flex items-center gap-1 text-sm underline
                               decoration-dotted text-primary hover:text-primary/80"
                  >
                    <FileText size={13} /> Pokaż skan
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-ink-4">
                    <Paperclip size={13} /> brak skanu
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {rec.notes && (
            <div className="space-y-1 pt-1">
              <dt className="text-[11px] uppercase font-semibold text-ink-4">Uwagi</dt>
              <dd className="text-sm text-ink-2 whitespace-pre-wrap">{rec.notes}</dd>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rachunek dokumentu. Anulowane pozycje pokazujemy OSOBNO, a nie w sumie:
          zostają w dokumencie jako ślad, ale surowca z nich nie ma. */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5 text-sm">
            <Liczba label="Waga przyjęta" value={`${fmtKg(suma.kg, 1)} kg`} mocna />
            <Liczba label="Zeszło z magazynu" value={`${fmtKg(suma.kgUsed, 1)} kg`} />
            <Liczba label="Numery porządkowe" value={String(suma.batches)} />
            <Liczba label="Partie dostawcy" value={String(suma.supplierLots)} />
            <Liczba
              label="Pojemniki"
              value={suma.containers === null ? '—' : String(suma.containers)}
            />
          </div>
          {suma.cancelledBatches > 0 && (
            <p className="pt-3 text-xs text-amber-700">
              Anulowane pozycje: {suma.cancelledBatches} na {fmtKg(suma.kgCancelled, 1)} kg —
              zostają w dokumencie jako ślad, ale nie wchodzą do sumy.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Numery porządkowe — po jednym bloku, bo pod każdym siedzi jeszcze
          lista partii dostawcy z HDI. */}
      {wiersze.map(w => (
        <Card key={w.batch.id} className={w.cancelled ? 'opacity-60' : undefined}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardDescription>Numer porządkowy</CardDescription>
                <div className="flex items-center gap-3">
                  <code className="font-mono text-2xl font-bold text-primary">
                    {w.batch.internalBatchNo}
                  </code>
                  {w.cancelled && <StatusBadge status="cancelled" label="Anulowany" />}
                  {w.batch.frozenReason && !w.cancelled && (
                    <span className="text-xs text-ink-4">{w.batch.frozenReason}</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <CardDescription>Waga przyjęta</CardDescription>
                <div className="text-2xl font-bold text-ink tabular-nums">
                  {fmtKg(w.batch.kgReceived, 1)} kg
                </div>
              </div>
            </div>

            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6 text-sm">
              <Pole label="Rodzaj surowca" value={w.batch.materialName || '—'} />
              <Pole label="Ubój" value={fmtDatePl(w.batch.slaughterDate)} />
              <Pole label="Ważność" value={fmtDatePl(w.batch.expiryDate)} />
              <Pole label="Cena" value={fmtPln(w.batch.pricePerKg)} mono />
              <Pole
                label="Kaliber"
                value={w.batch.containerKg ? `${fmtKg(w.batch.containerKg, 1)} kg` : '—'}
              />
              <Pole label="Pojemniki" value={w.containers === null ? '—' : String(w.containers)} />
              <Pole label="Dostępne" value={`${fmtKg(w.batch.kgAvailable, 1)} kg`} />
              <Pole label="Zeszło" value={`${fmtKg(w.batch.kgUsed, 1)} kg`} />
              {w.batch.kgMeat > 0 && (
                <Pole label="Mięso z rozbioru" value={`${fmtKg(w.batch.kgMeat, 1)} kg`} />
              )}
              {(w.batch.palletsH1 || w.batch.palletsOther) && (
                <Pole
                  label="Palety"
                  value={[
                    w.batch.palletsH1 ? `H1: ${w.batch.palletsH1}` : '',
                    w.batch.palletsOther
                      ? `${w.batch.palletsOtherKind || 'inne'}: ${w.batch.palletsOther}`
                      : '',
                  ].filter(Boolean).join(' · ') || '—'}
                />
              )}
            </dl>

            {/* Sekcja identyfikacji z HDI — to ona wiąże nasz numer porządkowy
                z numerami, którymi posługuje się dostawca przy reklamacji. */}
            <div className="space-y-1">
              <div className="text-[11px] uppercase font-semibold text-ink-4">
                Partie dostawcy ({w.supplierLots.length})
              </div>
              {(w.batch.supplierBatches ?? []).length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-surface-4 text-left text-[11px] uppercase text-ink-4">
                      <th className="py-2 pr-3 font-semibold">Partia dostawcy</th>
                      <th className="py-2 pr-3 font-semibold text-right">Waga</th>
                      <th className="py-2 pr-3 font-semibold">Ubój</th>
                      <th className="py-2 font-semibold">Ważność</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {w.batch.supplierBatches.map((lot, i) => (
                      <tr key={`${lot.supplierBatchNo}-${i}`}>
                        <td className="py-2 pr-3">
                          <code className="font-mono text-ink">{lot.supplierBatchNo || '—'}</code>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-2">
                          {fmtKg(lot.kgReceived, 1)} kg
                        </td>
                        <td className="py-2 pr-3 text-ink-2">{fmtDatePl(lot.slaughterDate)}</td>
                        <td className="py-2 text-ink-2">{fmtDatePl(lot.expiryDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-ink-3">
                  <code className="font-mono">{w.batch.supplierBatchNo || '—'}</code>
                  {' — dostawa wpisana bez rozbicia na pozycje HDI.'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <HdiScanViewer
        receptionId={rec.id}
        receptionNo={rec.receptionNo}
        supplierName={rec.supplierName}
        open={skanOtwarty}
        onClose={() => setSkanOtwarty(false)}
      />
    </div>
  )
}

function Pole({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-[11px] uppercase font-semibold text-ink-4">{label}</dt>
      <dd className={mono ? 'font-mono text-sm text-ink' : 'text-sm text-ink'}>{value}</dd>
    </div>
  )
}

function Liczba({ label, value, mocna }: { label: string; value: string; mocna?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase font-semibold text-ink-4">{label}</div>
      <div className={`tabular-nums ${mocna ? 'text-xl font-bold text-ink' : 'text-lg font-semibold text-ink-2'}`}>
        {value}
      </div>
    </div>
  )
}
