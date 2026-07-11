/**
 * RawStockBatchCard — Kartoteka partii Magazynu surowca (styl Subiekt).
 *
 * Klik wiersza magazynu otwiera pełną kartotekę zamiast prostego kafelka:
 *   • pasek nagłówka z numerem partii i rodzajem,
 *   • wiersz stanów (przychód / dostępne / zarezerwowane / wydano),
 *   • łańcuch śledzenia z REALNYMI danymi etapów (dostawca → przyjęcie →
 *     rozbiór → magazyn → wydania) z GET /wz/stock/raw/card,
 *   • gęsta siatka danych partii,
 *   • historia ruchów z rejestru stock_movements z saldem liczonym WSTECZ
 *     od bieżącego stanu (starsze partie mogą nie mieć pełnej historii —
 *     saldo świeżych ruchów pozostaje wtedy poprawne).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownToLine, ArrowUpFromLine, FileText, GitBranch, Loader2,
  Truck, Inbox, Scissors, Warehouse, FileOutput, ChevronRight,
} from 'lucide-react'
import { wzApi } from '@/lib/apiClient'
import { cn, fmtKg, fmtDatePl } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'

// ─── ExpiryBadge (wspólny z listą magazynu) ──────────────────
export function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  const cls =
    daysLeft <= 1   ? 'bg-red-50 text-red-700 border-red-200' :
    daysLeft <= 3   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200'
  const label =
    daysLeft < 0    ? 'wygasło' :
    daysLeft === 0  ? 'dziś' :
                      `${daysLeft}d`
  return <Badge variant="outline" className={cn('text-[10px] font-medium', cls)}>{label}</Badge>
}

// ─── Typy odpowiedzi /wz/stock/raw/card ──────────────────────
interface ChainStep {
  stage: 'supplier' | 'reception' | 'deboning' | 'stock' | 'issues'
  title: string
  batch_no?: string | null
  date?: string | null
  kg?: number | null
  note?: string | null
  current?: boolean
}
interface Movement {
  id: string
  date: string
  movement_type: 'IN' | 'OUT' | 'TRANSFORM' | 'ADJUST' | 'CANCEL'
  qty: number
  source_type: string
  label: string
  number?: string | null
  detail?: string | null
  ref_kind?: string | null
  ref_id?: string | null
}
interface StockCard {
  stock_type: 'raw' | 'meat' | 'byproduct'
  header: { batch_no: string | null; name: string; supplier_name?: string | null }
  identity: Record<string, string | null>
  stock: { kg_initial: number | null; kg_available: number; kg_reserved: number | null }
  chain: ChainStep[]
  movements: Movement[]
}

const STAGE_ICON: Record<ChainStep['stage'], React.ReactNode> = {
  supplier:  <Truck size={14} />,
  reception: <Inbox size={14} />,
  deboning:  <Scissors size={14} />,
  stock:     <Warehouse size={14} />,
  issues:    <FileOutput size={14} />,
}

const IDENTITY_LABELS: Record<string, string> = {
  raw_batch_no:      'Partia surowca (ćwiartka)',
  supplier_batch_no: 'Nr partii dostawcy',
  invoice_no:        'Faktura zakupowa',
  slaughter_date:    'Data uboju',
  received_date:     'Data przyjęcia',
  production_date:   'Data produkcji',
  weighed_at:        'Data ważenia',
  expiry_date:       'Data ważności',
  notes:             'Uwagi',
}
const DATE_KEYS = new Set(['slaughter_date', 'received_date', 'production_date', 'weighed_at', 'expiry_date'])

const TYPE_LABEL: Record<StockCard['stock_type'], string> = {
  raw: 'Surowiec — ćwiartka', meat: 'Mięso po rozbiorze', byproduct: 'Produkt uboczny',
}

// ─── Komórka etykieta/wartość (siatka Subiekt) ───────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2 border-b border-r border-surface-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4 whitespace-nowrap">{label}</span>
      <span className="text-[13px] font-semibold text-ink text-right">{children}</span>
    </div>
  )
}

// ─── Kartoteka ───────────────────────────────────────────────
export function RawStockBatchCard({ stockType, stockId, onClose }: {
  stockType: string; stockId: string; onClose: () => void
}) {
  const navigate = useNavigate()
  const [card, setCard] = useState<StockCard | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(wzApi as any).stockRawCard(stockType, stockId)
      .then((c: StockCard) => { if (alive) setCard(c) })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Błąd pobierania kartoteki') })
    return () => { alive = false }
  }, [stockType, stockId])

  // Saldo wstecz od bieżącego stanu: stan po ostatnim ruchu = kg_available.
  const movements = card?.movements ?? []
  const saldoAfter: number[] = []
  if (card) {
    let running = card.stock.kg_available
    for (let i = movements.length - 1; i >= 0; i--) {
      saldoAfter[i] = running
      running -= movements[i].qty
    }
  }

  const kgIn  = movements.filter(m => m.qty > 0).reduce((s, m) => s + m.qty, 0)
  const kgOut = movements.filter(m => m.qty < 0).reduce((s, m) => s - m.qty, 0)
  const initial = card?.stock.kg_initial ?? (kgIn > 0 ? kgIn : null)

  const batchNo = card?.header.batch_no ?? ''
  const expiry = card?.identity.expiry_date

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden max-h-[88vh] flex flex-col">
        {/* ── Pasek tytułu ── */}
        <div className="px-5 py-3.5 bg-surface-2 border-b border-surface-4 flex items-start justify-between gap-4 pr-12">
          <div className="min-w-0">
            <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-ink-4">
              Kartoteka partii · Magazyn surowca
            </DialogDescription>
            <DialogTitle className="flex items-baseline gap-3 flex-wrap mt-0.5">
              <span className="font-mono font-black text-2xl text-brand leading-none">{batchNo || '—'}</span>
              <span className="text-sm font-bold text-ink">{card?.header.name ?? ''}</span>
            </DialogTitle>
            <div className="text-xs text-ink-3 mt-1 truncate">
              {card?.header.supplier_name ?? (card ? '—' : 'Ładowanie…')}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            {card && (
              <Badge variant="outline" className="text-[10px] font-semibold bg-white text-ink-2 border-surface-5">
                {TYPE_LABEL[card.stock_type]}
              </Badge>
            )}
            {expiry && (
              <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                ważność {fmtDatePl(expiry)} <ExpiryBadge date={expiry} />
              </span>
            )}
          </div>
        </div>

        {!card && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-ink-3 text-sm">
            <Loader2 size={16} className="animate-spin" /> Ładowanie kartoteki…
          </div>
        )}
        {error && (
          <div className="px-5 py-10 text-sm text-destructive text-center">{error}</div>
        )}

        {card && (
          <div className="overflow-y-auto scrollbar-thin">
            {/* ── Wiersz stanów ── */}
            <div className="grid grid-cols-4 divide-x divide-surface-3 border-b border-surface-4 bg-white [font-variant-numeric:tabular-nums]">
              {[
                { label: 'Przychód',       val: initial,  cls: 'text-ink' },
                { label: 'Stan dostępny',  val: card.stock.kg_available, cls: 'text-emerald-700' },
                { label: 'Zarezerwowane',  val: card.stock.kg_reserved,  cls: 'text-amber-700' },
                { label: 'Wydano',         val: kgOut > 0 ? kgOut : null, cls: 'text-ink-2' },
              ].map(s => (
                <div key={s.label} className="px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-4">{s.label}</div>
                  <div className={cn('text-lg font-black leading-tight', s.val != null ? s.cls : 'text-ink-5')}>
                    {s.val != null ? <>{fmtKg(s.val, 1)} <span className="text-[11px] font-bold text-ink-4">kg</span></> : '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Łańcuch śledzenia ── */}
            <div className="px-5 py-4 border-b border-surface-4 bg-surface-2/50">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-ink-4">Łańcuch śledzenia</div>
                <button
                  onClick={() => navigate(`/office/sledzenie?batch=${encodeURIComponent(batchNo)}`)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-brand hover:underline">
                  <GitBranch size={12} /> Pełne drzewo śledzenia
                </button>
              </div>
              <div className="flex items-center gap-y-2 flex-wrap">
                {card.chain.map((s, i) => (
                  <div key={`${s.stage}-${i}`} className="flex items-center">
                    {i > 0 && <ChevronRight size={14} className="mx-1 text-ink-5 flex-shrink-0" />}
                    <div className={cn(
                      'rounded-lg border px-3 py-2 bg-white min-w-[120px]',
                      s.current ? 'border-brand ring-1 ring-brand/30 shadow-card' : 'border-surface-4',
                    )}>
                      <div className={cn(
                        'flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide',
                        s.current ? 'text-brand' : 'text-ink-3',
                      )}>
                        {STAGE_ICON[s.stage]}
                        <span className="truncate max-w-[150px]" title={s.title}>{s.title}</span>
                      </div>
                      <div className="mt-1 text-[12px] leading-snug [font-variant-numeric:tabular-nums]">
                        {s.batch_no && (
                          <div className="font-mono font-bold text-ink text-[12px] truncate max-w-[170px]" title={s.batch_no}>
                            {s.batch_no}
                          </div>
                        )}
                        {s.kg != null && <div className="font-black text-ink">{fmtKg(s.kg, 1)} kg</div>}
                        <div className="text-[11px] text-ink-3">
                          {[s.date ? fmtDatePl(s.date) : null, s.note].filter(Boolean).join(' · ') || ' '}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Dane partii ── */}
            <div className="border-b border-surface-4">
              <div className="px-5 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-4">Dane partii</div>
              <div className="grid grid-cols-2 border-t border-surface-3">
                {Object.entries(card.identity)
                  .filter(([, v]) => v != null && v !== '')
                  .map(([k, v]) => (
                    <Field key={k} label={IDENTITY_LABELS[k] ?? k}>
                      {k === 'expiry_date' && v ? (
                        <span className="inline-flex items-center gap-1.5">{fmtDatePl(v)} <ExpiryBadge date={v} /></span>
                      ) : DATE_KEYS.has(k) && v ? fmtDatePl(v)
                        : k.endsWith('_no') ? <code className="font-mono font-bold">{v}</code>
                        : v}
                    </Field>
                  ))}
              </div>
            </div>

            {/* ── Historia ruchów ── */}
            <div>
              <div className="px-5 pt-3 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-4">
                Historia ruchów magazynowych
              </div>
              {movements.length === 0 ? (
                <div className="px-5 pb-5 text-sm text-ink-4">
                  Brak zapisów w rejestrze ruchów dla tej partii (partia sprzed wprowadzenia rejestru).
                </div>
              ) : (
                <table className="w-full text-[13px] [font-variant-numeric:tabular-nums]">
                  <thead>
                    <tr>
                      {['Data', 'Operacja / dokument', 'Przychód [kg]', 'Rozchód [kg]', 'Stan po [kg]'].map((h, i) => (
                        <th key={h} className={cn(
                          'h-9 px-4 bg-surface-2 border-y border-surface-4 text-[11px] font-bold uppercase tracking-wide text-ink-3',
                          i >= 2 ? 'text-right' : 'text-left',
                        )}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => {
                      const isIn = m.qty > 0
                      // Numer WZ zaczyna się od „WZ/" — nie dublujemy etykiety.
                      const docLabel = m.number
                        ? (m.number.startsWith(m.label) ? m.number : `${m.label} ${m.number}`)
                        : m.label
                      return (
                        <tr key={m.id} className="border-b border-surface-3 last:border-b-0 hover:bg-surface-2/60">
                          <td className="px-4 py-2 whitespace-nowrap text-ink-2">
                            {m.date ? fmtDatePl(m.date.slice(0, 10)) : '—'}
                            <span className="text-ink-4 text-[11px] ml-1.5">{m.date?.slice(11, 16)}</span>
                          </td>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1.5">
                              {isIn
                                ? <ArrowDownToLine size={13} className="text-emerald-600 flex-shrink-0" />
                                : <ArrowUpFromLine size={13} className="text-red-600 flex-shrink-0" />}
                              {m.ref_kind === 'wz' && m.ref_id ? (
                                <button
                                  onClick={() => window.open(`/office/wz/${m.ref_id}/druk`, '_blank')}
                                  className="font-semibold text-brand hover:underline inline-flex items-center gap-1"
                                  title="Otwórz dokument WZ">
                                  <FileText size={12} />{docLabel}
                                </button>
                              ) : (
                                <span className="font-semibold text-ink">{docLabel}</span>
                              )}
                              {m.detail && <span className="text-ink-4 text-[11px] truncate max-w-[180px]" title={m.detail}>· {m.detail}</span>}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-emerald-700">
                            {isIn ? fmtKg(m.qty, 1) : ''}
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-red-700">
                            {!isIn ? fmtKg(-m.qty, 1) : ''}
                          </td>
                          <td className="px-4 py-2 text-right font-black text-ink">
                            {fmtKg(saldoAfter[i], 1)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Stopka akcji ── */}
        <div className="px-5 py-3 bg-surface-2 border-t border-surface-4 flex items-center justify-between gap-2 mt-auto">
          <div className="text-[11px] text-ink-4">
            Rejestr ruchów: stock_movements · saldo liczone od stanu bieżącego
          </div>
          <div className="flex items-center gap-2">
            {batchNo && (
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => window.open(`/office/partia/${encodeURIComponent(batchNo)}/raport`, '_blank')}>
                <FileText size={13} /> Raport partii
              </Button>
            )}
            <Button size="sm" className="gap-1.5"
              onClick={() => navigate(`/office/sledzenie?batch=${encodeURIComponent(batchNo)}`)}>
              <GitBranch size={13} /> Drzewo śledzenia
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
