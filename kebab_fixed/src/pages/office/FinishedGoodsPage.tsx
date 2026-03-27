import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { Spinner, EmptyState } from '@/components/ui/Card'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { ShoppingBag, CheckCircle, ChevronUp, ChevronDown, Search, X } from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

// ─── Typ zgrupowany ───────────────────────────────────────────
interface GroupedItem extends FinishedGoodsItem {
  subEntries: any[]
  latestDate: string
}

// ─── Modal szczegółów ─────────────────────────────────────────
function DetailModal({ item, onClose }: { item: GroupedItem; onClose: () => void }) {
  const sub: any[] = item.subEntries ?? []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface border border-surface-4 rounded-2xl w-full max-w-lg shadow-modal overflow-hidden" onClick={e=>e.stopPropagation()}>
        {/* Nagłówek */}
        <div className="px-5 py-4 border-b border-surface-4 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold text-ink-4 uppercase mb-0.5">Wyrób gotowy</div>
            <div className="font-black text-ink text-base">{item.recipeName}</div>
            {item.packagingName && <div className="text-[12px] text-ink-3 mt-0.5">{item.packagingName}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-3 text-ink-3">
            <X size={16}/>
          </button>
        </div>

        {/* Podsumowanie */}
        <div className="grid grid-cols-3 divide-x divide-surface-4 border-b border-surface-4">
          {[
            { label: 'Dostępne',   val: `${item.qtyAvailable} szt` },
            { label: 'kg/szt',     val: fmtKg(item.kgPerUnit) },
            { label: 'Razem kg',   val: fmtKg(item.qtyAvailable * item.kgPerUnit) },
          ].map(c => (
            <div key={c.label} className="px-4 py-3 text-center">
              <div className="text-[10px] font-bold text-ink-4 uppercase">{c.label}</div>
              <div className="font-bold text-ink text-[13px] mt-0.5">{c.val}</div>
            </div>
          ))}
        </div>

        {/* Sesje produkcyjne */}
        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto">
          <div className="text-[10px] font-bold text-ink-4 uppercase mb-2">
            Historia produkcji ({sub.length} {sub.length === 1 ? 'sesja' : sub.length < 5 ? 'sesje' : 'sesji'})
          </div>
          {sub.length === 0 ? (
            <div className="text-[12px] text-ink-3 py-4 text-center">Brak szczegółów sesji</div>
          ) : (
            <div className="space-y-2">
              {sub.map((s: any, i: number) => (
                <div key={i} className="border border-surface-4 rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-black text-ink">{s.qty} szt</span>
                      <span className="text-[12px] font-semibold text-green-700">{fmtKg(s.qty * item.kgPerUnit)} kg</span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      {s.addedAt ? fmtDatePl(s.addedAt.slice(0,10)) : '—'}
                      {s.addedAt && <span className="ml-1 text-ink-4">{s.addedAt.slice(11,16)}</span>}
                    </div>
                  </div>
                  {(s.seasonedBatchNos ?? []).length > 0 && (
                    <div className="flex gap-1 flex-wrap mb-1.5">
                      {(s.seasonedBatchNos ?? []).map((n: string) => (
                        <span key={n} className="font-mono text-[10px] bg-brand-light text-brand border border-brand-border px-1.5 py-0.5 rounded font-bold">{n}</span>
                      ))}
                    </div>
                  )}
                  {(s.workerNames ?? []).length > 0 && (
                    <div className="text-[11px] text-ink-3">{(s.workerNames ?? []).join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Nagłówek z sortowaniem ───────────────────────────────────
type SortKey = 'qtyAvailable' | 'kgPerUnit' | 'totalKg' | 'clientName' | 'recipeName' | 'packagingName' | 'latestDate'
type SortDir = 'asc' | 'desc'

function SortHeader({ label, col, sort, onSort }: {
  label: string; col: SortKey
  sort: { key: SortKey; dir: SortDir }
  onSort: (k: SortKey) => void
}) {
  const active = sort.key === col
  return (
    <th className="px-3 py-2 text-left">
      <button onClick={() => onSort(col)}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4 hover:text-brand group">
        {label}
        <span className={active ? 'text-brand' : 'text-surface-4 group-hover:text-brand/40'}>
          {active && sort.dir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
        </span>
      </button>
    </th>
  )
}

// ─── Główna ───────────────────────────────────────────────────
export function FinishedGoodsPage() {
  const location = useLocation()
  const { data: items, loading } = useApi(() => finishedGoodsApi.list())
  const [detailItem,    setDetailItem]    = useState<GroupedItem | null>(null)
  const [successBanner, setSuccessBanner] = useState<{ count: number } | null>(null)
  const [searchClient,  setSearchClient]  = useState('')
  const [searchRecipe,  setSearchRecipe]  = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'latestDate', dir: 'desc' })

  useEffect(() => {
    const state = location.state as { justFinished?: boolean; count?: number } | null
    if (state?.justFinished) {
      setSuccessBanner({ count: state.count ?? 0 })
      const t = setTimeout(() => setSuccessBanner(null), 5000)
      return () => clearTimeout(t)
    }
  }, [location.state])

  function toggleSort(key: SortKey) {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' })
  }

  // Grupowanie: ta sama receptura + tuleja + klient + kg/szt → sumuj qtyAvailable
  const grouped = useMemo((): GroupedItem[] => {
    const raw = items ?? []
    const map = new Map<string, GroupedItem>()
    for (const item of raw) {
      const key = `${item.recipeName}|${item.packagingName ?? ''}|${item.clientName ?? ''}|${item.kgPerUnit}`
      if (!map.has(key)) {
        map.set(key, {
          ...item,
          subEntries: [...((item as any).subEntries ?? [])],
          latestDate: item.producedDate,
        })
      } else {
        const g = map.get(key)!
        g.qtyAvailable += item.qtyAvailable
        g.qty           += item.qty
        g.totalKg       += item.totalKg
        g.subEntries.push(...((item as any).subEntries ?? []))
        if (item.producedDate > g.latestDate) g.latestDate = item.producedDate
      }
    }
    return [...map.values()]
  }, [items])

  const filtered = useMemo(() => {
    let r = grouped
    if (searchClient.trim()) {
      const q = searchClient.toLowerCase()
      r = r.filter(i => (i.clientName ?? '').toLowerCase().includes(q))
    }
    if (searchRecipe.trim()) {
      const q = searchRecipe.toLowerCase()
      r = r.filter(i => i.recipeName.toLowerCase().includes(q))
    }
    return [...r].sort((a, b) => {
      const av = (a as any)[sort.key] ?? ''
      const bv = (b as any)[sort.key] ?? ''
      const cmp = typeof av === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'pl')
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [grouped, searchClient, searchRecipe, sort])

  const totalQty = grouped.reduce((s, i) => s + i.qtyAvailable, 0)
  const totalKg  = grouped.reduce((s, i) => s + i.qtyAvailable * i.kgPerUnit, 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {successBanner && (
        <div className="flex items-center gap-3 bg-success-light border border-success-border text-success px-4 py-3 rounded-xl font-semibold text-sm">
          <CheckCircle size={18}/>
          Produkcja zakończona — zapisano <strong>{successBanner.count} szt</strong> do magazynu wyrobów gotowych.
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Pozycje',        val: grouped.length,   cls: 'text-ink' },
          { label: 'Dostępne szt',   val: totalQty,         cls: 'text-ink' },
          { label: 'Łącznie kg',     val: fmtKg(totalKg),   cls: 'text-green-700' },
        ].map(c => (
          <div key={c.label} className="bg-surface border border-surface-4 rounded-xl p-3 shadow-card">
            <div className="text-[10px] font-semibold uppercase text-ink-4">{c.label}</div>
            <div className={`text-xl font-bold ${c.cls}`}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Wyszukiwanie */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"/>
          <input value={searchClient} onChange={e => setSearchClient(e.target.value)}
            placeholder="Szukaj klienta…"
            className="w-full pl-7 pr-3 py-2 text-[12px] border border-surface-4 rounded-lg focus:outline-none focus:border-brand bg-surface-3"/>
        </div>
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4"/>
          <input value={searchRecipe} onChange={e => setSearchRecipe(e.target.value)}
            placeholder="Szukaj receptury…"
            className="w-full pl-7 pr-3 py-2 text-[12px] border border-surface-4 rounded-lg focus:outline-none focus:border-brand bg-surface-3"/>
        </div>
        {(searchClient || searchRecipe) && (
          <button onClick={() => { setSearchClient(''); setSearchRecipe('') }}
            className="px-3 py-2 text-[12px] font-semibold text-ink-3 border border-surface-4 rounded-lg hover:border-brand hover:text-brand flex items-center gap-1">
            <X size={12}/>Wyczyść
          </button>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-surface border border-surface-4 rounded-xl rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-surface-4">
          <span className="text-[13px] font-semibold text-ink">
            {filtered.length} {filtered.length !== grouped.length ? `/ ${grouped.length} ` : ''}pozycji wyrobów gotowych
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={20}/></div>
        ) : grouped.length === 0 ? (
          <EmptyState icon={<ShoppingBag size={32}/>} title="Brak wyrobów"
            message="Wyroby pojawią się po zakończeniu dnia produkcji"/>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-ink-3">Brak wyników dla podanych filtrów</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-surface-3">
                <SortHeader label="Szt"      col="qtyAvailable"  sort={sort} onSort={toggleSort}/>
                <SortHeader label="kg/szt"   col="kgPerUnit"     sort={sort} onSort={toggleSort}/>
                <SortHeader label="Klient"   col="clientName"    sort={sort} onSort={toggleSort}/>
                <SortHeader label="Receptura" col="recipeName"   sort={sort} onSort={toggleSort}/>
                <SortHeader label="Tuleja"   col="packagingName" sort={sort} onSort={toggleSort}/>
                <SortHeader label="Razem kg" col="totalKg"       sort={sort} onSort={toggleSort}/>
                <SortHeader label="Data"     col="latestDate"    sort={sort} onSort={toggleSort}/>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {filtered.map(item => (
                <tr key={`${item.recipeName}|${item.packagingName}|${item.clientName}|${item.kgPerUnit}`}
                  onClick={() => setDetailItem(item)}
                  className="hover:bg-brand-light/30 cursor-pointer active:bg-brand-light/50 transition-colors">
                  <td className="px-3 py-3">
                    <span className="text-base font-black text-ink tabular-nums">{item.qtyAvailable}</span>
                    <span className="text-[10px] text-ink-3 ml-1">szt</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-bold text-ink tabular-nums">{fmtKg(item.kgPerUnit)}</span>
                    <span className="text-[10px] text-ink-3 ml-1">kg</span>
                  </td>
                  <td className="px-3 py-3 text-ink-3">{item.clientName || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{item.recipeName}</div>
                  </td>
                  <td className="px-3 py-3 text-ink-3">{item.packagingName || '—'}</td>
                  <td className="px-3 py-3">
                    <span className="font-bold text-green-700 tabular-nums">{fmtKg(item.qtyAvailable * item.kgPerUnit)}</span>
                    <span className="text-[10px] text-ink-3 ml-1">kg</span>
                  </td>
                  <td className="px-3 py-3 text-ink-3">{fmtDatePl(item.latestDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)}/>}
    </div>
  )
}
