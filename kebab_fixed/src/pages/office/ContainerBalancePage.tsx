/**
 * ContainerBalancePage — saldo nośników zwrotnych per kontrahent.
 *
 * Saldo dodatnie = mamy u siebie JEGO pojemniki (my jesteśmy winni).
 * Saldo ujemne  = on ma NASZE pojemniki (on jest winien). Zero = rozliczone.
 * Jeden znakowany licznik obsługuje oba kierunki — patrz
 * container_ledger_service (konwencja znaku).
 *
 * Dostawca i odbiorca o tym samym NIP-ie to JEDEN wiersz (scalanie po NIP
 * w container_partners), więc firma kupująca i sprzedająca ma jedno saldo.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, Search, AlertTriangle } from 'lucide-react'
import { containersApi, type ContainerBalanceRow } from '@/lib/api'
import { ASSET_SHORT, balanceTone } from '@/lib/containers'

type SortKey = 'name' | 'e2' | 'pallet_h1' | 'pallet_other' | 'last_movement'

const TONE_CLS: Record<ReturnType<typeof balanceTone>, string> = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
}

function Saldo({ value }: { value: number }) {
  return (
    <span className={`tabular-nums font-bold ${TONE_CLS[balanceTone(value)]}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  )
}

const ROLE_LABEL: Record<string, string> = { supplier: 'dostawca', client: 'odbiorca' }

export function ContainerBalancePage() {
  const nav = useNavigate()
  const [rows, setRows] = useState<ContainerBalanceRow[]>([])
  const [q, setQ] = useState('')
  const [nonzero, setNonzero] = useState(true)
  const [sort, setSort] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    setLoading(true)
    containersApi.balances({ nonzero })
      .then(setRows)
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [nonzero])

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? rows.filter(r => `${r.name} ${r.nip}`.toLowerCase().includes(needle))
      : rows
    const dir = asc ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return dir * a.name.localeCompare(b.name, 'pl')
      if (sort === 'last_movement') {
        return dir * String(a.last_movement || '').localeCompare(String(b.last_movement || ''))
      }
      return dir * (a[sort] - b[sort])
    })
  }, [rows, q, sort, asc])

  const th = (key: SortKey, label: string, right = false) => (
    <th
      onClick={() => { setSort(key); setAsc(sort === key ? !asc : true) }}
      className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-3
                  cursor-pointer select-none hover:text-ink ${right ? 'text-right' : 'text-left'}`}>
      {label}{sort === key ? (asc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center gap-3">
        <Boxes size={20} className="text-ink-3" />
        <h1 className="text-lg font-bold text-ink">Saldo pojemników</h1>
        <span className="text-[12px] text-ink-4">
          dodatnie = mamy ich nośniki · ujemne = oni mają nasze
        </span>
      </header>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Szukaj po nazwie lub NIP…"
            className="w-full h-9 pl-8 pr-3 rounded border border-surface-4 bg-surface text-[13px]" />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={nonzero} onChange={e => setNonzero(e.target.checked)} />
          tylko niezerowe
        </label>
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {err}
        </div>
      )}

      <div className="rounded border border-surface-4 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-3 border-b border-surface-4">
            <tr>
              {th('name', 'Kontrahent')}
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-3">NIP</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-3">Rola</th>
              {th('e2', ASSET_SHORT.e2, true)}
              {th('pallet_h1', ASSET_SHORT.pallet_h1, true)}
              {th('pallet_other', ASSET_SHORT.pallet_other, true)}
              {th('last_movement', 'Ostatni ruch', true)}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px] text-ink-4">Ładowanie…</td></tr>
            )}
            {!loading && view.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px] text-ink-4">
                Brak kontrahentów z saldem nośników.
              </td></tr>
            )}
            {view.map(r => (
              <tr key={r.id}
                  onClick={() => nav(`/office/saldo-pojemnikow/${r.id}`)}
                  className="cursor-pointer hover:bg-surface-2">
                <td className="px-3 py-2 text-[13px] font-medium text-ink">
                  {r.name}
                  {r.unconfirmed > 0 && (
                    <span title={`${r.unconfirmed} ruchów do przejrzenia`}
                          className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-600">
                      <AlertTriangle size={11} /> {r.unconfirmed}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[12.5px] text-ink-3 tabular-nums">{r.nip || '—'}</td>
                <td className="px-3 py-2 text-[12px] text-ink-3">
                  {r.roles.map(x => ROLE_LABEL[x] || x).join(' + ') || '—'}
                </td>
                <td className="px-3 py-2 text-right"><Saldo value={r.e2} /></td>
                <td className="px-3 py-2 text-right"><Saldo value={r.pallet_h1} /></td>
                <td className="px-3 py-2 text-right"><Saldo value={r.pallet_other} /></td>
                <td className="px-3 py-2 text-right text-[12.5px] text-ink-3 tabular-nums">
                  {r.last_movement || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
