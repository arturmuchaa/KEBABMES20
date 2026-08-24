/**
 * DeboningWeighingsLog — dziennik ważeń rozbioru w trzech zakładkach:
 * Mięso (każda porcja pobrania od pracownika), Grzbiety i Kości (każda paleta
 * frakcji zważona przez operatora). Wszędzie JEDEN wiersz = JEDNO ważenie,
 * z pełnym audytem wagi — nie sumy po wpisie/partii.
 *
 * Współdzielony przez DeboningReportsPage (Statystyki rozbioru, z zakresem
 * dat) i DeboningControlPage (Panel rozbioru — powód: biuro patrzy na "Panel
 * rozbioru" na co dzień, dziennik musi być widoczny i tam, nie tylko w
 * statystykach).
 *
 * Uwaga na dni: paleta ubocznych należy do dnia SWOJEGO ważenia (backend
 * liczy po weighedAt palety), więc partia rozbierana przez kilka dni rozlicza
 * się w dzienniku dzień po dniu — tak samo jak statystyki i pasek HMI.
 */
import { useEffect, useState } from 'react'
import { deboningApi, byproductsApi, type ByproductWeighing } from '@/lib/apiClient'
import { DataTable } from '@/components/DataTable'
import { E2_TARE_KG } from '@/features/deboning/utils/weighing'
import { cn } from '@/lib/utils'
import { ListChecks, ChevronUp, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export interface TakeWeighing {
  id:             string
  entryId:        string
  kgMeat:         number
  kgGross:        number | null
  tareCartKg:     number | null
  tareE2Kg:       number | null
  e2Count:        number | null
  weighMode:      string | null
  weighedAtLocal: string   // naive local (Europe/Warsaw) datetime z backendu
  dayLocal:       string   // 'YYYY-MM-DD' lokalnie
  workerName:     string
  meatType:       'zs' | 'bs'
  rawBatchNo:     string
  kgQuarter:      number
  entryStatus:    string
}

type Tab = 'meat' | 'backs' | 'bones'

function fmtTimePl(iso: string): string {
  return iso.slice(11, 16) || '—'
}
function fmtDayShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

export function DeboningWeighingsLog({
  from, to, defaultOpen = true,
}: {
  from: string
  to: string
  defaultOpen?: boolean
}) {
  const [meat, setMeat] = useState<TakeWeighing[] | null>(null)
  const [byprod, setByprod] = useState<ByproductWeighing[] | null>(null)
  const [tab, setTab] = useState<Tab>('meat')
  // Korekta pojedynczego ważenia ubocznych — patrz komentarz przy kolumnie akcji.
  const [korekta, setKorekta] = useState<ByproductWeighing | null>(null)
  const [powod, setPowod] = useState('')
  const [netto, setNetto] = useState('')
  const [zapis, setZapis] = useState(false)
  const [blad, setBlad] = useState('')
  const [show, setShow] = useState(defaultOpen)
  const sameDay = from === to

  useEffect(() => {
    let alive = true
    setMeat(null)
    setByprod(null)
    deboningApi.weighings(from, to)
      .then(r => { if (alive) setMeat(r.data ?? []) })
      .catch(() => { if (alive) setMeat(null) })
    byproductsApi.weighings(from, to)
      .then(r => { if (alive) setByprod(r.data ?? []) })
      .catch(() => { if (alive) setByprod(null) })
    return () => { alive = false }
  }, [from, to])

  // Auto-odświeżanie tylko gdy zakres kończy się dziś (łapie nowe ważenia na żywo).
  useEffect(() => {
    const isTodayEnd = to === new Date().toISOString().slice(0, 10)
    if (!isTodayEnd) return
    const id = setInterval(() => {
      deboningApi.weighings(from, to).then(r => setMeat(r.data ?? [])).catch(() => {})
      byproductsApi.weighings(from, to).then(r => setByprod(r.data ?? [])).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [from, to])

  const backs = byprod?.filter(w => w.kind === 'backs') ?? null
  const bones = byprod?.filter(w => w.kind === 'bones') ?? null
  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: 'meat',  label: 'Mięso',    count: meat?.length ?? null },
    { key: 'backs', label: 'Grzbiety', count: backs?.length ?? null },
    { key: 'bones', label: 'Kości',    count: bones?.length ?? null },
  ]
  async function zapiszKorekte(usun: boolean) {
    if (!korekta || !powod.trim()) return
    setZapis(true)
    setBlad('')
    try {
      await byproductsApi.correctWeighing({
        rawBatchId: korekta.rawBatchId,
        kind:       korekta.kind,
        weighedAt:  korekta.weighedAt,
        reason:     powod.trim(),
        ...(usun ? { delete: true } : { netKg: parseFloat(netto.replace(',', '.')) }),
      })
      setKorekta(null)
      // Przeładuj dziennik — suma frakcji też się zmieniła.
      const r = await byproductsApi.weighings(from, to)
      setByprod(r.data ?? [])
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się poprawić ważenia')
    } finally {
      setZapis(false)
    }
  }

  const hint = tab === 'meat'
    ? 'każda porcja mięsa zważona — brutto / tara / netto'
    : `każda paleta ${tab === 'backs' ? 'grzbietów' : 'kości'} zważona — brutto / tara / netto`

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => setShow(v => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ListChecks size={15} className="text-ink-3" />
          <h2 className="text-sm font-bold text-ink">Dziennik ważeń</h2>
          <span className="text-[11px] text-ink-4 truncate">· {hint}</span>
          <span className="ml-auto text-ink-4">
            {show ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>
        {show && (
          <div className="inline-flex items-center rounded-lg border border-surface-4 bg-white p-0.5">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                  tab === t.key ? 'bg-brand text-white shadow-sm' : 'text-ink-3 hover:text-ink hover:bg-surface-2',
                )}>
                {t.label}
                <span className={cn('ml-1 tabular-nums', tab === t.key ? 'text-white/70' : 'text-ink-4')}>
                  {t.count ?? '…'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {show && (
        tab === 'meat'
          ? <MeatTable rows={meat} sameDay={sameDay} />
          : <ByproductTable rows={tab === 'backs' ? backs : bones} sameDay={sameDay} kind={tab}
              onCorrect={w => { setKorekta(w); setPowod(''); setNetto(String(w.netKg)); setBlad('') }} />
      )}

      {/* Korekta ważenia ubocznych. Powód OBOWIĄZKOWY — bez niego zniknięcie
          palety z dokumentu identyfikowalności jest nie do wytłumaczenia. */}
      <Dialog open={korekta !== null} onOpenChange={v => { if (!v) setKorekta(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Ważenie {korekta?.kind === 'backs' ? 'grzbietów' : 'kości'} · partia {korekta?.rawBatchNo}
            </DialogTitle>
            <DialogDescription>
              {korekta && `${fmtTimePl(korekta.weighedAtLocal)} · brutto ${nf1.format(korekta.kgGross)} kg`}
              {' · '}netto {korekta && nf1.format(korekta.netKg)} kg · {korekta?.containers} poj.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-4">Netto [kg]</label>
              <Input value={netto} inputMode="decimal" onChange={e => setNetto(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-ink-4">Powód korekty</label>
              <Input value={powod} placeholder="np. dubel — ta sama paleta co minutę wcześniej"
                onChange={e => setPowod(e.target.value)} />
            </div>
            {blad && (
              <div className="rounded-[3px] border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] font-semibold text-destructive">
                {blad}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setKorekta(null)} disabled={zapis}>Anuluj</Button>
            <Button variant="destructive" className="gap-1.5" disabled={zapis || !powod.trim()}
              data-testid="wazenie-usun"
              onClick={() => zapiszKorekte(true)}>
              <Trash2 size={14} /> Usuń ważenie
            </Button>
            <Button disabled={zapis || !powod.trim()} data-testid="wazenie-zapisz"
              onClick={() => zapiszKorekte(false)}>
              Zapisz wagę
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MeatTable({ rows, sameDay }: { rows: TakeWeighing[] | null; sameDay: boolean }) {
  if (rows == null) return <Loading />
  return (
    <DataTable
      rows={rows} rowKey={w => w.id}
      searchText={w => `${w.rawBatchNo} ${w.workerName}`}
      searchPlaceholder="Szukaj partii lub pracownika…"
      initialSort={{ key: 'weighedAtLocal', dir: 'desc' }}
      empty={<div className="py-8 text-center text-xs text-ink-4">Brak ważeń w tym zakresie</div>}
      footer={rows => {
        const gross = rows.reduce((a, w) => a + (w.kgGross ?? 0), 0)
        const net = rows.reduce((a, w) => a + w.kgMeat, 0)
        const carts = rows.filter(w => (w.tareCartKg ?? 0) > 0).length
        return (
          <>
            <span>Razem · {rows.length} ważeń</span>
            <span>Wózków: <b>{carts}</b></span>
            <span className="ml-auto">Brutto: <b>{nf1.format(gross)} kg</b></span>
            <span>Netto mięsa: <b className="text-brand">{nf1.format(net)} kg</b></span>
          </>
        )
      }}
      columns={[
        { key: 'weighedAtLocal', header: sameDay ? 'Godzina' : 'Dzień / godzina',
          sortable: true, sortValue: w => w.weighedAtLocal, width: 110,
          cell: w => (
            <span className="tabular-nums text-ink-2">
              {sameDay ? fmtTimePl(w.weighedAtLocal) : `${fmtDayShort(w.dayLocal)} ${fmtTimePl(w.weighedAtLocal)}`}
            </span>
          ) },
        { key: 'rawBatchNo', header: 'Partia', sortable: true, sortValue: w => w.rawBatchNo, width: 90,
          cell: w => <code className="font-mono font-bold text-brand">{w.rawBatchNo}</code> },
        { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: w => w.workerName,
          cell: w => (
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-ink">{w.workerName}</span>
              {w.meatType === 'bs' && (
                <span title="Mięso bez skóry — inna norma uzysku"
                  className="text-[10px] font-bold uppercase px-1 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">B/S</span>
              )}
            </span>
          ) },
        { key: 'kgGross', header: 'Brutto [kg]', align: 'right', sortable: true, sortValue: w => w.kgGross ?? -1,
          cell: w => w.kgGross != null
            ? <span className="tabular-nums text-ink-2">{nf1.format(w.kgGross)}</span>
            : <span className="text-ink-4">—</span> },
        { key: 'tareCartKg', header: 'Tara wózka [kg]', align: 'right', sortable: true, sortValue: w => w.tareCartKg ?? -1,
          cell: w => w.tareCartKg != null
            ? <span className="tabular-nums text-ink-3">{nf1.format(w.tareCartKg)}</span>
            : <span className="text-ink-4">—</span> },
        { key: 'e2', header: 'Pojemniki E2', align: 'right', sortable: true, sortValue: w => w.e2Count ?? -1,
          cell: w => w.e2Count != null && w.e2Count > 0
            ? (
              <span className="tabular-nums text-ink-3">
                {w.e2Count} szt<span className="text-ink-4 text-[11px]"> · {nf1.format(w.tareE2Kg ?? 0)} kg</span>
              </span>
            )
            : <span className="text-ink-4">—</span> },
        { key: 'kgMeat', header: 'Netto mięsa [kg]', align: 'right', sortable: true, sortValue: w => w.kgMeat,
          cell: w => <span className="font-black tabular-nums text-brand">{nf1.format(w.kgMeat)}</span> },
        { key: 'weighMode', header: 'Tryb', width: 90,
          cell: w => (
            <span className={cn(
              'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
              w.weighMode === 'auto'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-surface-2 text-ink-3 border-surface-4',
            )}>
              {w.weighMode === 'auto' ? 'Waga' : 'Ręcznie'}
            </span>
          ) },
        { key: 'entryStatus', header: 'Wpis', width: 90,
          cell: w => (
            <span className={cn(
              'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
              w.entryStatus === 'pending'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-surface-2 text-ink-3 border-surface-4',
            )}>
              {w.entryStatus === 'pending' ? 'Trwa' : 'Gotowe'}
            </span>
          ) },
      ]}
    />
  )
}

function ByproductTable({ rows, sameDay, kind, onCorrect }: {
  rows: ByproductWeighing[] | null
  sameDay: boolean
  kind: 'backs' | 'bones'
  onCorrect?: (w: ByproductWeighing) => void
}) {
  if (rows == null) return <Loading />
  const label = kind === 'backs' ? 'grzbietów' : 'kości'
  // Tara całkowita palety = tara nośnika + pojemniki E2. Kreator na HMI liczy
  // netto tak samo (gross − tareKg − containers × E2_TARE_KG).
  const tareTotal = (w: ByproductWeighing) => w.tareKg + w.containers * E2_TARE_KG
  return (
    <DataTable
      rows={rows} rowKey={w => w.id}
      searchText={w => `${w.rawBatchNo} ${w.tareLabel}`}
      searchPlaceholder="Szukaj partii, palety lub wózka…"
      initialSort={{ key: 'weighedAtLocal', dir: 'desc' }}
      empty={<div className="py-8 text-center text-xs text-ink-4">Brak ważeń {label} w tym zakresie</div>}
      footer={rows => {
        const gross = rows.reduce((a, w) => a + w.kgGross, 0)
        const net = rows.reduce((a, w) => a + w.netKg, 0)
        const cont = rows.reduce((a, w) => a + w.containers, 0)
        return (
          <>
            <span>Razem · {rows.length} palet</span>
            <span>Pojemniki: <b>{cont}</b></span>
            <span className="ml-auto">Brutto: <b>{nf1.format(gross)} kg</b></span>
            <span>Netto {label}: <b className="text-brand">{nf1.format(net)} kg</b></span>
          </>
        )
      }}
      columns={[
        { key: 'weighedAtLocal', header: sameDay ? 'Godzina' : 'Dzień / godzina',
          sortable: true, sortValue: w => w.weighedAtLocal, width: 110,
          cell: w => (
            <span className="tabular-nums text-ink-2">
              {sameDay ? fmtTimePl(w.weighedAtLocal) : `${fmtDayShort(w.dayLocal)} ${fmtTimePl(w.weighedAtLocal)}`}
            </span>
          ) },
        { key: 'rawBatchNo', header: 'Partia', sortable: true, sortValue: w => w.rawBatchNo, width: 90,
          cell: w => <code className="font-mono font-bold text-brand">{w.rawBatchNo}</code> },
        // Nośnik: paleta H1, wózek z systemu („wózek 6,5") albo bez tary —
        // operator wybiera go w kreatorze na HMI, tu widać, na czym ważono.
        { key: 'tareLabel', header: 'Paleta / wózek', sortable: true, sortValue: w => w.tareLabel,
          cell: w => w.tareLabel
            ? <span className="font-semibold text-ink">{w.tareLabel}</span>
            : <span className="text-ink-4">bez palety</span> },
        { key: 'kgGross', header: 'Brutto [kg]', align: 'right', sortable: true, sortValue: w => w.kgGross,
          cell: w => w.kgGross > 0
            ? <span className="tabular-nums text-ink-2">{nf1.format(w.kgGross)}</span>
            : <span className="text-ink-4">—</span> },
        { key: 'tareKg', header: 'Tara nośnika [kg]', align: 'right', sortable: true, sortValue: w => w.tareKg,
          cell: w => w.tareKg > 0
            ? <span className="tabular-nums text-ink-3">{nf1.format(w.tareKg)}</span>
            : <span className="text-ink-4">—</span> },
        { key: 'containers', header: 'Pojemniki E2', align: 'right', sortable: true, sortValue: w => w.containers,
          cell: w => w.containers > 0
            ? (
              <span className="tabular-nums text-ink-3">
                {w.containers} szt<span className="text-ink-4 text-[11px]"> · {nf1.format(w.containers * E2_TARE_KG)} kg</span>
              </span>
            )
            : <span className="text-ink-4">—</span> },
        { key: 'tareTotal', header: 'Tara razem [kg]', align: 'right', sortable: true, sortValue: tareTotal,
          cell: w => tareTotal(w) > 0
            ? <span className="tabular-nums text-ink-3">{nf1.format(tareTotal(w))}</span>
            : <span className="text-ink-4">—</span> },
        { key: 'netKg', header: `Netto ${kind === 'backs' ? 'grzbietów' : 'kości'} [kg]`,
          align: 'right', sortable: true, sortValue: w => w.netKg,
          cell: w => <span className="font-black tabular-nums text-brand">{nf1.format(w.netKg)}</span> },
        // Korekta pojedynczego ważenia. Istnieje, bo dubel na dokumencie
        // identyfikowalności nie może wymagać dostępu do bazy (partia 503,
        // 24.08.2026 — dwie te same palety grzbietów minutę po sobie).
        ...(onCorrect ? [{
          key: 'akcje', header: '', width: 44,
          cell: (w: ByproductWeighing) => (
            <button type="button" title="Popraw albo usuń to ważenie"
              data-testid="wazenie-popraw"
              onClick={() => onCorrect(w)}
              className="grid h-7 w-7 place-items-center text-ink-4 hover:bg-surface-3 hover:text-ink">
              <Pencil size={13} />
            </button>
          ),
        }] : []),
      ]}
    />
  )
}

function Loading() {
  return (
    <div className="rounded-lg border border-surface-4 bg-white py-6 text-center text-xs text-ink-4">Ładowanie…</div>
  )
}
