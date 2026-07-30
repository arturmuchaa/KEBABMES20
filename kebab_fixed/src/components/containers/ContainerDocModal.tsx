/**
 * ContainerDocModal — wystawienie „WZ na POJEMNIKI".
 *
 * Jeden dokument obejmuje OBA kierunki: kierowca zwykle przywozi pełne
 * i zabiera puste w tym samym kursie. Podgląd salda pokazuje, gdzie
 * wyjdzie saldo po zapisie — celem zwykle jest zero.
 */
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { containersApi, type ContainerAsset, type ContainerDelivery } from '@/lib/api'
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
  const [deliveries, setDeliveries] = useState<ContainerDelivery[]>([])
  // Jedna dostawa bywa rozbita na kilka partii — zaznaczasz wszystkie,
  // druk obejmuje je razem (np. 667 poj. / 17 palet z dwóch partii).
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  // Druk z pustą kolumną zwrotu: kontrahent wpisuje ją długopisem, my
  // uzupełniamy po powrocie kierowcy. Domyślny dla WYDAŃ (WZ towaru).
  const [pending, setPending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const n = (s: string) => parseInt(s || '0') || 0

  useEffect(() => {
    containersApi.deliveries(partnerId).then(setDeliveries).catch(() => setDeliveries([]))
  }, [partnerId])

  const picked = deliveries.filter(d => linkedIds.includes(d.sourceId))
  const linked = picked[0] || null

  /** Zaznaczenie partii sumuje ich nośniki w kolumnie „Dostawa/odbiór"
   *  i podpowiada zwrot w tej samej wysokości — typowy kurs to oddanie
   *  tylu, ile przyjechało. */
  const toggleDelivery = (id: string) => {
    const next = linkedIds.includes(id)
      ? linkedIds.filter(x => x !== id)
      : [...linkedIds, id]
    setLinkedIds(next)
    const sel = deliveries.filter(d => next.includes(d.sourceId))
    if (!sel.length) { setInQ(emptyQty()); setOutQ(emptyQty()); setPending(false); return }
    const sum = Object.fromEntries(ASSET_TYPES.map(a =>
      [a, String(sel.reduce((s, d) => s + (d.assets[a] || 0), 0))])) as Qty
    setInQ(sum)
    // Wydanie (WZ) → kontrahent dopiero odda, więc domyślnie pusty zwrot.
    const isOut = sel[0].direction === 'out'
    setPending(isOut)
    setOutQ(isOut ? emptyQty() : sum)
  }

  // Dostawa i wydanie mają przeciwne znaki — jeden zwrot nie może mieć obu.
  const mixedDirections = new Set(picked.map(d => d.direction)).size > 1

  // Przy powiązanym źródle kolumna „Dostawa/odbiór" NIE księguje — te
  // nośniki wniosło już przyjęcie albo WZ. Znak zwrotu jest przeciwny do
  // kierunku źródła: wydanie oddają NAM (+), dostawę oddajemy MY (−).
  const retSign = linked?.direction === 'out' ? 1 : -1
  const preview = useMemo(
    () => Object.fromEntries(
      ASSET_TYPES.map(a => [
        a, (balance[a] ?? 0) + (linked ? 0 : n(inQ[a])) +
           (pending ? 0 : retSign * n(outQ[a])),
      ]),
    ) as Record<ContainerAsset, number>,
    [balance, inQ, outQ, linked, pending, retSign])

  const anyQty = ASSET_TYPES.some(a => n(inQ[a]) || n(outQ[a]))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await containersApi.createDoc({
        partnerId, docDate, driver, vehicle, notes, pendingReturn: pending,
        ...(picked.length
          ? { linkedSources: picked.map(d => ({ sourceType: d.sourceType, sourceId: d.sourceId })) }
          : {}),
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

          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase text-ink-4">
              Rozliczane dostawy / wydania
              <span className="ml-2 font-normal normal-case text-ink-4">
                zaznacz kilka, jeśli jedna dostawa poszła na kilka partii
              </span>
            </span>
            <div className="max-h-32 overflow-y-auto rounded border border-surface-4 divide-y divide-surface-3">
              {deliveries.length === 0 && (
                <div className="px-2 py-2 text-[12px] text-ink-4">
                  Brak dostaw i wydań do rozliczenia — możesz wystawić sam zwrot.
                </div>
              )}
              {deliveries.map(d => (
                <label key={`${d.sourceType}:${d.sourceId}`}
                       className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] hover:bg-surface-2 cursor-pointer">
                  <input type="checkbox" checked={linkedIds.includes(d.sourceId)}
                         onChange={() => toggleDelivery(d.sourceId)} />
                  <span className={`font-bold ${d.direction === 'out' ? 'text-red-600' : 'text-amber-600'}`}>
                    {d.direction === 'out' ? 'WYDANIE' : 'DOSTAWA'}
                  </span>
                  <span className="text-ink-3">{d.date}</span>
                  <span className="flex-1 truncate text-ink">{d.label}</span>
                  <span className="tabular-nums text-ink-2">
                    {d.assets.e2} poj. / {d.assets.pallet_h1} pal.
                  </span>
                  {d.settled && <span className="text-[10.5px] text-ink-4">ma druk</span>}
                </label>
              ))}
            </div>
            {mixedDirections && (
              <span className="block text-[11px] text-red-600">
                Nie mieszaj dostaw z wydaniami — zwrot miałby dwa przeciwne kierunki.
              </span>
            )}
            {linked && !mixedDirections && (
              <span className="block text-[11px] text-ink-4">
                Kolumna „Dostawa / odbiór" to suma z {picked.length === 1
                  ? (linked.direction === 'out' ? 'tego wydania' : 'tego przyjęcia')
                  : `${picked.length} zaznaczonych pozycji`} i jest tylko zapisem na
                druku — te nośniki są już na saldzie. Księgowany jest sam zwrot.
              </span>
            )}
          </div>

          {linked && (
            <label className="flex items-start gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={pending} className="mt-0.5"
                onChange={e => { setPending(e.target.checked); if (e.target.checked) setOutQ(emptyQty()) }} />
              <span>
                Druk z <b>pustą kolumną zwrotu</b> — kontrahent wpisze ją długopisem
                <span className="block text-[11px] text-ink-4">
                  Zwrot uzupełnisz w kartotece po powrocie kierowcy („Wpisz zwrot").
                </span>
              </span>
            </label>
          )}

          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-3">
                <th className="py-2 text-left text-[11px] font-bold uppercase text-ink-3">Nośnik</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">
                  Dostawa / odbiór{linked && <span className="font-normal normal-case"> (z dostawy)</span>}
                </th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Zwrot</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Saldo po</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {ASSET_TYPES.map(a => (
                <tr key={a}>
                  <td className="py-2 text-[13px] text-ink">{ASSET_SHORT[a]}</td>
                  <td className="py-1.5 text-right">
                    {linked ? (
                      <span className="inline-block w-24 pr-2 text-[13px] tabular-nums text-ink-3">
                        {n(inQ[a]) || '—'}
                      </span>
                    ) : qtyInput(inQ[a], v => setInQ(q => ({ ...q, [a]: v })))}
                  </td>
                  <td className="py-1.5 text-right">
                    {pending
                      ? <span className="inline-block w-24 pr-2 text-[12px] text-ink-4">do wpisania</span>
                      : qtyInput(outQ[a], v => setOutQ(q => ({ ...q, [a]: v })))}
                  </td>
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
          <button onClick={save} disabled={saving || !anyQty || mixedDirections}
            className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
            {saving ? 'Zapisywanie…' : 'Wystaw dokument'}
          </button>
        </footer>
      </div>
    </div>
  )
}
