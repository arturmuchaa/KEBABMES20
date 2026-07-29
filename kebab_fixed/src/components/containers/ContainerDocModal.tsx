/**
 * ContainerDocModal — wystawienie „WZ na POJEMNIKI".
 *
 * Jeden dokument obejmuje OBA kierunki: kierowca zwykle przywozi pełne
 * i zabiera puste w tym samym kursie. Podgląd salda pokazuje, gdzie
 * wyjdzie saldo po zapisie — celem zwykle jest zero.
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { containersApi, type ContainerAsset } from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES, balanceTone } from '@/lib/containers'

const TONE_CLS = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
} as const

type Qty = Record<ContainerAsset, string>
const emptyQty = (): Qty => Object.fromEntries(ASSET_TYPES.map(a => [a, ''])) as Qty

interface Props {
  partnerId: string
  balance: Record<ContainerAsset, number>
  onClose: () => void
  onSaved: () => void
}

export function ContainerDocModal({ partnerId, balance, onClose, onSaved }: Props) {
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [driver, setDriver] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [inQ, setInQ] = useState<Qty>(emptyQty)
  const [outQ, setOutQ] = useState<Qty>(emptyQty)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const n = (s: string) => parseInt(s || '0') || 0

  const preview = useMemo(
    () => Object.fromEntries(
      ASSET_TYPES.map(a => [a, (balance[a] ?? 0) + n(inQ[a]) - n(outQ[a])]),
    ) as Record<ContainerAsset, number>,
    [balance, inQ, outQ])

  const anyQty = ASSET_TYPES.some(a => n(inQ[a]) || n(outQ[a]))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await containersApi.createDoc({
        partnerId, docDate, driver, vehicle, notes,
        lines: ASSET_TYPES.map(a => ({ assetType: a, inQty: n(inQ[a]), outQty: n(outQ[a]) })),
      })
      onSaved()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const qtyInput = (v: string, set: (s: string) => void) => (
    <input type="number" min="0" step="1" value={v} onChange={e => set(e.target.value)}
      className="w-24 h-9 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums" />
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-surface-4 bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-surface-3 px-5 py-3">
          <h2 className="text-[15px] font-bold text-ink">Nowy dokument pojemnikowy</h2>
          <button onClick={onClose} className="text-ink-4 hover:text-ink"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1 block">
              <span className="text-[11px] font-bold uppercase text-ink-4">Data</span>
              <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[11px] font-bold uppercase text-ink-4">Kierowca</span>
              <input value={driver} onChange={e => setDriver(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[11px] font-bold uppercase text-ink-4">Środek transportu</span>
              <input value={vehicle} onChange={e => setVehicle(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-3">
                <th className="py-2 text-left text-[11px] font-bold uppercase text-ink-3">Nośnik</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Dostawa / odbiór</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Zwrot</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Saldo po</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {ASSET_TYPES.map(a => (
                <tr key={a}>
                  <td className="py-2 text-[13px] text-ink">{ASSET_SHORT[a]}</td>
                  <td className="py-1.5 text-right">{qtyInput(inQ[a], v => setInQ(q => ({ ...q, [a]: v })))}</td>
                  <td className="py-1.5 text-right">{qtyInput(outQ[a], v => setOutQ(q => ({ ...q, [a]: v })))}</td>
                  <td className={`py-2 text-right text-[15px] font-black tabular-nums ${TONE_CLS[balanceTone(preview[a])]}`}>
                    {preview[a] > 0 ? `+${preview[a]}` : preview[a]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase text-ink-4">Uwagi</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full rounded border border-surface-4 bg-surface px-2 py-1.5 text-[13px]" />
          </label>

          {err && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              {err}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-surface-3 px-5 py-3">
          <button onClick={onClose} disabled={saving}
            className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
            Anuluj
          </button>
          <button onClick={save} disabled={saving || !anyQty}
            className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
            {saving ? 'Zapisywanie…' : 'Wystaw dokument'}
          </button>
        </footer>
      </div>
    </div>
  )
}
