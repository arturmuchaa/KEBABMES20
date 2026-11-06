import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Minus, Plus, Printer, X } from 'lucide-react'
import { byproductPalletChecksApi, type ByproductPalletCheckRecord } from '@/lib/api'
import { fmtKg } from '@/lib/utils'
import { getDevices, sendZpl, probeBrowserPrint } from '@/lib/zebra'
import { byproductLabelZpl } from './byproductLabelZpl'
import { byproductTareOptions, E2_TARE_KG } from './utils/weighing'
import type { ScaleState } from './useScale'
import type { RawBatch } from '@/types'

const KIND_LABEL = { backs: 'Grzbiety', bones: 'Kości' } as const
type Kind = keyof typeof KIND_LABEL
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

/** Containers to start from when a tare is picked (hall 2026-11-06): an H1 pallet usually
 * carries 36 E2, a cart 5; the operator adjusts with ± from there. "Bez" keeps the count. */
export function defaultContainers(tareKey: string, current: number) {
  return tareKey.startsWith('pallet:') ? 36 : tareKey.startsWith('cart:') ? 5 : current
}

/** Net of the pallet on the scale: gross − pallet/cart − E2 × 2 kg (0 when not ready). */
export function palletCheckNet(gross: number, tareKg: number | null, e2Count: number) {
  if (tareKg == null) return 0
  const net = Math.round((gross - tareKg - e2Count * E2_TARE_KG) * 100) / 100
  return net > 0 ? net : 0
}

/**
 * A whole pallet of backs or bones collected from many per-worker takes,
 * weighed FOR INFORMATION: the record and the pallet label are for the
 * warehouse; stock already got these kilograms per worker and stays unchanged.
 */
export function ByproductPalletCheckModal({ scale, cartTares, batches, defaultBatchId, productionDate, vars, onClose }: {
  scale: ScaleState
  cartTares: number[]
  batches: RawBatch[]
  defaultBatchId?: string
  productionDate: string
  vars?: CSSProperties
  onClose: () => void
}) {
  const [kind, setKind] = useState<Kind>('backs')
  const [picked, setPicked] = useState<string[]>(defaultBatchId ? [defaultBatchId] : [])
  const tares = useMemo(() => byproductTareOptions(cartTares), [cartTares])
  const [tareKey, setTareKey] = useState<string | null>(null)
  const [e2Count, setE2Count] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [last, setLast] = useState<ByproductPalletCheckRecord | null>(null)
  const [recent, setRecent] = useState<ByproductPalletCheckRecord[]>([])
  // One id per pallet: a retry after a lost response sends the same record, never a second one.
  const [requestId, setRequestId] = useState(newId)

  useEffect(() => { byproductPalletChecksApi.recent(1).then(setRecent).catch(() => {}) }, [last])

  const tare = tares.find(t => t.key === tareKey) ?? null
  const net = scale.connected && scale.stable && !scale.error ? palletCheckNet(scale.gross, tare?.kg ?? null, e2Count) : 0
  const chosen = batches.filter(b => picked.includes(b.id))
  const ready = net > 0 && chosen.length > 0 && !busy
  const hint = !chosen.length ? 'WYBIERZ PARTIĘ' : !tare ? 'WYBIERZ PALETĘ / WÓZEK' : !scale.connected ? 'WAGA NIEPODŁĄCZONA'
    : scale.gross <= 0 ? 'WJEDŹ PALETĄ NA WAGĘ' : !scale.stable ? 'CZEKAM NA STABILNĄ WAGĘ…' : net <= 0 ? 'SPRAWDŹ TARĘ' : ''

  async function save() {
    if (!ready || !tare) return
    setBusy(true); setMessage(null)
    try {
      const rec = await byproductPalletChecksApi.create({
        requestId, kind, rawBatchIds: chosen.map(b => b.id), kgNet: net, kgGross: scale.gross, tareKg: tare.kg,
        tareLabel: tare.tareLabel, tareE2Kg: e2Count * E2_TARE_KG, e2Count, weighMode: 'auto',
      })
      setLast(rec); setRequestId(newId())
      const expiry = rec.batches.map(b => b.expiryDate).filter(Boolean).sort()[0] ?? ''
      try {
        const { default: def, list } = await getDevices()
        const dev = def ?? list[0]
        if (!dev) throw new Error('Nie znaleziono drukarki etykiet')
        await sendZpl(dev, byproductLabelZpl({ kind, batchNo: rec.batches.map(b => b.rawBatchNo).join('+'), netKg: rec.kgNet,
          productionDate, expiryDate: expiry, subtitle: 'paleta zbiorcza' }))
        setMessage({ ok: true, text: `Zapisano i wydrukowano: ${KIND_LABEL[kind].toLowerCase()} ${fmtKg(rec.kgNet, 1)} kg` })
      } catch (e) {
        const probe = await probeBrowserPrint()
        setMessage({ ok: false, text: `Ważenie zapisane, etykieta nie wydrukowana: ${probe.ok ? (e instanceof Error ? e.message : 'błąd drukarki') : (probe.reason ?? 'brak połączenia z drukarką')}` })
      }
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Nie zapisano ważenia — ponów' })
    } finally { setBusy(false) }
  }

  const diff = last ? last.kgNet - last.workersKg : 0
  const chip = (on: boolean): CSSProperties => ({ borderRadius: 10, border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
    background: on ? 'var(--accent)' : 'var(--panel)', color: on ? '#fff' : 'var(--ink)' })

  return (
    <div className="fixed inset-0 z-[57] flex items-center justify-center bg-black/45" style={vars} role="dialog" aria-label="Paleta grzbietów lub kości">
      <div className="w-[900px] max-w-[96vw] max-h-[94vh] overflow-y-auto p-6 flex flex-col gap-4"
        style={{ borderRadius: 16, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)' }}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="font-extrabold text-2xl">Paleta grzbietów / kości</div>
            <div className="text-sm font-semibold" style={{ color: 'var(--mut)' }}>
              Ważenie informacyjne dla magazynu — stan magazynu się nie zmienia (kilogramy weszły już z pobrań pracowników).
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="w-11 h-11 flex items-center justify-center"
            style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(KIND_LABEL) as Kind[]).map(k => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
              className="h-14 text-xl font-extrabold" style={chip(kind === k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Partie na palecie (można kilka)</span>
          <div className="flex flex-wrap gap-2">
            {batches.map(b => {
              const on = picked.includes(b.id)
              return <button key={b.id} type="button" aria-pressed={on} onClick={() => setPicked(p => on ? p.filter(x => x !== b.id) : [...p, b.id])}
                className="h-12 px-4 hmi-v10-mono text-lg font-extrabold" style={chip(on)}>{b.internalBatchNo}</button>
            })}
            {!batches.length && <span className="text-sm" style={{ color: 'var(--mut)' }}>Brak partii do wyboru</span>}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Paleta / wózek</span>
          <div className="flex flex-wrap gap-2">
            {tares.map(t => (
              <button key={t.key} type="button" aria-pressed={tareKey === t.key} onClick={() => { setTareKey(t.key); setE2Count(defaultContainers(t.key, e2Count)) }}
                className="min-w-[96px] h-14 px-3 flex flex-col items-center justify-center" style={chip(tareKey === t.key)}>
                <span className="font-extrabold text-lg leading-none">{t.title}</span>
                <span className="text-[10px] font-bold uppercase opacity-80">{t.sub}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 p-2 w-[340px]" style={{ borderRadius: 10, background: 'var(--accentSoft)', border: '1.5px solid var(--accent)' }}>
            <button type="button" aria-label="Mniej pojemników" onClick={() => setE2Count(n => Math.max(0, n - 1))}
              className="w-14 h-12 flex items-center justify-center" style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}><Minus size={22} /></button>
            <div className="flex-1 text-center leading-none">
              <div className="text-[9px] font-bold uppercase" style={{ color: 'var(--accent)' }}>Pojemniki E2</div>
              <div className="hmi-v10-mono font-extrabold text-3xl">{e2Count}</div>
              <div className="text-[10px] font-bold" style={{ color: 'var(--mut)' }}>× {fmtKg(E2_TARE_KG, 1)} kg</div>
            </div>
            <button type="button" aria-label="Więcej pojemników" onClick={() => setE2Count(n => Math.min(60, n + 1))}
              className="w-14 h-12 flex items-center justify-center" style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}><Plus size={22} /></button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[['Brutto', scale.gross], ['Tara', tare ? tare.kg + e2Count * E2_TARE_KG : 0], ['Netto', net]].map(([l, v]) => (
            <div key={l as string} className="p-3" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)' }}>{l}</div>
              <div className="hmi-v10-mono font-extrabold text-3xl">{fmtKg(Number(v), 1)} <span className="text-base">kg</span></div>
            </div>
          ))}
        </div>

        <button type="button" onClick={() => { void save() }} disabled={!ready}
          className="h-16 text-lg font-extrabold flex items-center justify-center gap-3 disabled:opacity-60"
          style={{ borderRadius: 12, background: ready ? 'var(--accent)' : 'var(--panel)', color: ready ? '#fff' : 'var(--mut)', border: '1.5px solid var(--line)' }}>
          {busy ? 'Zapisuję…' : ready ? <><Printer size={22} /> ZAPISZ I DRUKUJ ETYKIETĘ — {KIND_LABEL[kind].toUpperCase()} {fmtKg(net, 1)} KG</> : hint}
        </button>

        {message && <div role={message.ok ? 'status' : 'alert'} className="px-4 py-3 text-[15px] font-bold"
          style={{ borderRadius: 10, background: message.ok ? '#F0FDF4' : 'var(--redSoft)', color: message.ok ? 'var(--success)' : 'var(--red)',
            border: `1px solid ${message.ok ? '#BBF0D3' : 'var(--redLine)'}` }}>{message.text}</div>}
        {last && (
          <div className="px-4 py-3 text-[14px] font-semibold" style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            Paleta {fmtKg(last.kgNet, 1)} kg · pracownicy zważyli z partii {last.batches.map(b => b.rawBatchNo).join(', ')}: {fmtKg(last.workersKg, 1)} kg
            {last.workersKg > 0 ? ` · różnica ${diff >= 0 ? '+' : '−'}${fmtKg(Math.abs(diff), 1)} kg (na paletach tej partii może być część z innych dni)` : ''}
          </div>
        )}
        {recent.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Dzisiaj zważone palety</span>
            {recent.map(r => (
              <div key={r.id} className="flex gap-3 text-[14px] font-semibold px-3 py-1.5" style={{ borderRadius: 8, background: 'var(--panel)' }}>
                <span className="hmi-v10-mono" style={{ color: 'var(--mut)' }}>{new Date(r.weighedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="font-bold">{KIND_LABEL[r.kind]}</span>
                <span className="hmi-v10-mono">{fmtKg(r.kgNet, 1)} kg</span>
                <span style={{ color: 'var(--mut)' }}>partie {r.batches.map(b => b.rawBatchNo).join(', ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
