/**
 * ContainerPartnerPage — kartoteka nośników jednego kontrahenta.
 *
 * Trzy warstwy, od najpilniejszej:
 *   1. salda per nośnik,
 *   2. „Do rozliczenia" — ruchy z przyjęć i WZ, których biuro jeszcze nie
 *      przejrzało. System policzył je automatem (kaliber, ważenia HMI),
 *      więc czasem różnią się od tego, co fizycznie zabrał kierowca.
 *      Korekta DOPISUJE różnicę — nie nadpisuje historii.
 *   3. pełna historia ruchów i wystawionych dokumentów.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Check, Printer, Plus, CornerDownLeft } from 'lucide-react'
import {
  containersApi, type ContainerAsset, type ContainerDoc,
  type ContainerPartnerCard, type ContainerPendingGroup,
} from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES, balanceTone } from '@/lib/containers'
import { ContainerDocModal } from '@/components/containers/ContainerDocModal'

const TONE_CLS = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
} as const

/** Wiersz „Do rozliczenia": edycja liczb + potwierdzenie jednym przyciskiem. */
function PendingRow({ g, onSaved }: { g: ContainerPendingGroup; onSaved: () => void }) {
  // Wartości bezwzględne w polach — znak wynika z kierunku ruchu i nie jest
  // rzeczą operatora. Przy zapisie odtwarzamy go z pierwotnej wartości.
  const [vals, setVals] = useState<Record<ContainerAsset, string>>(
    () => Object.fromEntries(
      ASSET_TYPES.map(a => [a, String(Math.abs(g.assets[a] ?? 0))]),
    ) as Record<ContainerAsset, string>)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const targets: Partial<Record<ContainerAsset, number>> = {}
      for (const a of ASSET_TYPES) {
        const qty = parseInt(vals[a] || '0') || 0
        // Kierunek bierzemy z oryginału; gdy oryginał był zerowy, zakładamy
        // ten sam kierunek co reszta grupy (WZ wydaje, przyjęcie przyjmuje).
        const sign = (g.assets[a] ?? 0) < 0 || g.sourceType === 'wz' ? -1 : 1
        targets[a] = qty * sign
      }
      await containersApi.correctGroup({
        partnerId: g.partnerId, sourceType: g.sourceType, sourceId: g.sourceId,
        targets, confirm: true,
      })
      onSaved()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="hover:bg-surface-2">
      <td className="px-3 py-2 text-[12.5px] text-ink-3 tabular-nums">{g.date}</td>
      <td className="px-3 py-2 text-[13px] text-ink">
        {g.sourceLabel}
        {g.note && <span className="ml-2 text-[11.5px] text-ink-4">{g.note}</span>}
      </td>
      {ASSET_TYPES.map(a => (
        <td key={a} className="px-2 py-1.5">
          <input
            type="number" min="0" step="1" value={vals[a]}
            onChange={e => setVals(v => ({ ...v, [a]: e.target.value }))}
            className="w-20 h-8 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums" />
        </td>
      ))}
      <td className="px-3 py-2 text-right">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-1 rounded bg-ink px-2.5 py-1.5 text-[12px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
          <Check size={12} /> Potwierdź
        </button>
        {err && <div className="mt-1 text-[11px] text-red-600">{err}</div>}
      </td>
    </tr>
  )
}

/** Zwrot po powrocie kierowcy. Dokument zamyka się przy KAŻDEJ wpisanej
 *  liczbie — także zerowej i częściowej; reszta zostaje na saldzie. */
function SettleModal({ doc, onClose, onSaved }: {
  doc: ContainerDoc; onClose: () => void; onSaved: () => void
}) {
  const [vals, setVals] = useState<Record<ContainerAsset, string>>(
    () => Object.fromEntries(ASSET_TYPES.map(a => [a, ''])) as Record<ContainerAsset, string>)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const wydane = Object.fromEntries(doc.lines.map(l => [l.assetType, l.inQty])) as
    Record<ContainerAsset, number>

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await containersApi.settleDoc(doc.id, Object.fromEntries(
        ASSET_TYPES.map(a => [a, parseInt(vals[a] || '0') || 0])) as Record<ContainerAsset, number>)
      onSaved()
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-surface-4 bg-surface shadow-xl">
        <header className="border-b border-surface-3 px-5 py-3">
          <h2 className="text-[15px] font-bold text-ink">Zwrot do dokumentu {doc.number}</h2>
          <p className="text-[11.5px] text-ink-4">
            Wpisz, ile faktycznie oddali. Dokument zamknie się także przy zwrocie
            częściowym — reszta zostanie na saldzie.
          </p>
        </header>
        <div className="p-5 space-y-3">
          {ASSET_TYPES.filter(a => wydane[a]).map(a => (
            <label key={a} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink">
                {ASSET_SHORT[a]}
                <span className="ml-2 text-[11.5px] text-ink-4">wydano {wydane[a]}</span>
              </span>
              <input type="number" min="0" step="1" value={vals[a]} placeholder="0"
                onChange={e => setVals(v => ({ ...v, [a]: e.target.value }))}
                className="w-28 h-9 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums" />
            </label>
          ))}
          {err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-surface-3 px-5 py-3">
          <button onClick={onClose} disabled={saving}
            className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">Anuluj</button>
          <button onClick={save} disabled={saving}
            className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
            {saving ? 'Zapisywanie…' : 'Zapisz zwrot'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export function ContainerPartnerPage() {
  const { partnerId = '' } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<ContainerPartnerCard | null>(null)
  const [err, setErr] = useState('')
  const [docOpen, setDocOpen] = useState(false)
  const [settling, setSettling] = useState<ContainerDoc | null>(null)

  const load = useCallback(() => {
    containersApi.partner(partnerId).then(setData).catch(e => setErr(String(e?.message || e)))
  }, [partnerId])

  useEffect(() => { load() }, [load])

  if (err) return <div className="p-6 text-[13px] text-red-700">{err}</div>
  if (!data) return <div className="p-6 text-[13px] text-ink-4">Ładowanie…</div>

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-start gap-3">
        <button onClick={() => nav('/office/saldo-pojemnikow')}
          className="mt-1 text-ink-4 hover:text-ink"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-ink">{data.partner.name}</h1>
          <div className="text-[12.5px] text-ink-3">
            {data.partner.nip ? `NIP ${data.partner.nip}` : 'bez NIP'}
            {data.partner.address ? ` · ${data.partner.address}` : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDocOpen(true)}
            className="inline-flex items-center gap-1.5 rounded bg-ink px-3 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2">
            <Plus size={13} /> Nowy dokument
          </button>
          <a href={`/office/pojemniki/raport/druk?partnerId=${partnerId}&from=${monthAgo}&to=${today}`}
             target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
            <Printer size={13} /> Potwierdzenie salda
          </a>
        </div>
      </header>

      {/* Salda */}
      <div className="grid grid-cols-3 gap-3">
        {ASSET_TYPES.map(a => {
          const v = data.balance[a] ?? 0
          return (
            <div key={a} className="rounded border border-surface-4 bg-surface p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-4">{ASSET_SHORT[a]}</div>
              <div className={`mt-1 text-3xl font-black tabular-nums ${TONE_CLS[balanceTone(v)]}`}>
                {v > 0 ? `+${v}` : v}
              </div>
              <div className="text-[11.5px] text-ink-4">
                {v > 0 ? 'mamy ich nośniki' : v < 0 ? 'mają nasze nośniki' : 'rozliczone'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Do rozliczenia */}
      {data.pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">
            Do rozliczenia — sprawdź liczby policzone przez system
          </h2>
          <div className="rounded border border-amber-200 bg-amber-50/40 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">Data</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">Źródło</th>
                  {ASSET_TYPES.map(a => (
                    <th key={a} className="px-2 py-2 text-right text-[11px] font-bold uppercase text-ink-3">
                      {ASSET_SHORT[a]}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {data.pending.map(g => (
                  <PendingRow key={`${g.sourceType}:${g.sourceId}`} g={g} onSaved={load} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Dokumenty */}
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Dokumenty pojemnikowe</h2>
        <div className="rounded border border-surface-4 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-3 border-b border-surface-4">
              <tr>
                {['Numer', 'Data', 'Kierowca', 'Pojazd', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {data.docs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-[13px] text-ink-4">Brak dokumentów.</td></tr>
              )}
              {data.docs.map(d => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 text-[13px] font-mono font-bold text-ink">{d.number}</td>
                  <td className="px-3 py-2 text-[12.5px] tabular-nums text-ink-3">{d.docDate}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-3">{d.driver || '—'}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-3">{d.vehicle || '—'}</td>
                  <td className="px-3 py-2 text-[12px]">
                    <span className={
                      d.status === 'anulowany' ? 'text-red-600'
                      : d.status === 'oczekuje' ? 'text-amber-600' : 'text-emerald-600'}>
                      {d.status === 'oczekuje' ? 'czeka na zwrot' : d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <a href={`/office/pojemniki/${d.id}/druk`} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink">
                      <FileText size={12} /> Druk
                    </a>
                    {d.status === 'oczekuje' && (
                      <button onClick={() => setSettling(d)}
                        className="ml-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink hover:underline">
                        <CornerDownLeft size={12} /> Wpisz zwrot
                      </button>
                    )}
                    {d.status !== 'anulowany' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Anulować dokument ${d.number}? Ruchy wrócą na saldo.`)) return
                          await containersApi.cancelDoc(d.id); load()
                        }}
                        className="ml-3 text-[12px] text-red-600 hover:text-red-700">Anuluj</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historia ruchów */}
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Historia ruchów</h2>
        <div className="rounded border border-surface-4 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-3 border-b border-surface-4">
              <tr>
                {['Data', 'Źródło', 'Dokument', 'Nośnik', 'Ilość', 'Status'].map((h, i) => (
                  <th key={i} className={`px-3 py-2 text-[11px] font-bold uppercase text-ink-3 ${i === 4 ? 'text-right' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {data.movements.map(m => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 text-[12.5px] tabular-nums text-ink-3">{m.movementDate}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-2">{m.sourceLabel}</td>
                  <td className="px-3 py-2 text-[12.5px] font-mono text-ink-3">{m.docNumber || '—'}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-2">{ASSET_SHORT[m.assetType]}</td>
                  <td className={`px-3 py-2 text-right text-[13px] font-bold tabular-nums ${m.qty > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-ink-4">
                    {m.confirmed ? 'potwierdzony' : 'do przejrzenia'}
                  </td>
                </tr>
              ))}
              {data.movements.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-[13px] text-ink-4">Brak ruchów.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {settling && (
        <SettleModal doc={settling} onClose={() => setSettling(null)}
          onSaved={() => { setSettling(null); load() }} />
      )}

      {docOpen && (
        <ContainerDocModal
          partnerId={partnerId}
          balance={data.balance}
          onClose={() => setDocOpen(false)}
          onSaved={() => { setDocOpen(false); load() }} />
      )}
    </div>
  )
}
