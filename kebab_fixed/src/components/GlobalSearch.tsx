/**
 * GlobalSearch — Ctrl+K: globalne szukanie w biurze.
 *
 * Jedno pole, wszystkie kluczowe byty: partie surowca, partie mięsa z/s,
 * zamówienia, klienci, dostawcy. Wynik prowadzi prosto do celu — partia
 * otwiera pełny raport traceability (/office/partia/:nr/raport), reszta
 * stronę listy z prefiltrem ?q=. Dane dociągane leniwie przy pierwszym
 * otwarciu (cache 60 s) i filtrowane lokalnie — zero nowego backendu.
 *
 * Obsługa: Ctrl+K / ⌘K otwiera, ↑↓ wybiera, Enter przechodzi, Esc zamyka.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  rawBatchesApi, meatStockApi, clientOrdersApi, clientsApi, suppliersApi,
} from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import {
  Search, Package, Boxes, ShoppingCart, Users, Truck, CornerDownLeft,
} from 'lucide-react'

const ORDER_STATUS: Record<string, string> = {
  draft: 'szkic', confirmed: 'potwierdzone', in_production: 'w produkcji',
  done: 'zrealizowane', cancelled: 'anulowane',
}

interface Hit {
  group: string
  icon: React.ReactNode
  title: React.ReactNode
  sub: string
  /** Tekst przeszukiwany (lowercase). */
  hay: string
  to: string
}

const CACHE_TTL_MS = 60_000

export function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const cacheRef = useRef<{ at: number; hits: Hit[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ── Ctrl+K / ⌘K ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Leniwe ładowanie indeksu przy otwarciu ──
  const loadIndex = useCallback(async () => {
    if (cacheRef.current && Date.now() - cacheRef.current.at < CACHE_TTL_MS) {
      setHits(cacheRef.current.hits)
      return
    }
    setLoading(true)
    try {
      const [batches, meat, orders, clients, suppliers] = await Promise.all([
        rawBatchesApi.all().then(r => r.data ?? []).catch(() => []),
        meatStockApi.list().then(r => r.data ?? []).catch(() => []),
        clientOrdersApi.list().catch(() => [] as any[]),
        clientsApi.list().catch(() => [] as any[]),
        suppliersApi.list().catch(() => [] as any[]),
      ])
      const out: Hit[] = []
      for (const b of batches as any[]) {
        const supplier = b.supplierDisplayName || b.supplierName || ''
        out.push({
          group: 'Partie surowca',
          icon: <Package size={14} className="text-blue-600" />,
          title: <code className="font-mono font-bold">{b.internalBatchNo}</code>,
          sub: `${supplier}${b.receivedDate ? ` · przyjęto ${fmtDatePl(b.receivedDate)}` : ''} · zostało ${fmtKg(Number(b.kgAvailable) || 0, 0)} kg`,
          hay: `${b.internalBatchNo} ${b.supplierBatchNo ?? ''} ${supplier}`.toLowerCase(),
          to: `/office/partia/${encodeURIComponent(b.internalBatchNo)}/raport`,
        })
      }
      for (const m of meat as any[]) {
        out.push({
          group: 'Partie mięsa z/s',
          icon: <Boxes size={14} className="text-emerald-600" />,
          title: <code className="font-mono font-bold">{m.lotNo || m.rawBatchNo}</code>,
          sub: `z partii ${m.rawBatchNo || '—'} · dostępne ${fmtKg(Number(m.kgAvailable) || 0, 0)} kg`,
          hay: `${m.lotNo ?? ''} ${m.rawBatchNo ?? ''}`.toLowerCase(),
          to: `/office/partia/${encodeURIComponent(m.rawBatchNo || m.lotNo)}/raport`,
        })
      }
      for (const o of orders as any[]) {
        out.push({
          group: 'Zamówienia',
          icon: <ShoppingCart size={14} className="text-amber-600" />,
          title: (
            <span>
              <code className="font-mono font-bold">{o.orderNo}</code>
              <span className="text-ink-3"> · {o.clientName}</span>
            </span>
          ),
          sub: `${o.deliveryDate ? `dostawa ${fmtDatePl(o.deliveryDate)} · ` : ''}${ORDER_STATUS[o.status] ?? o.status} · ${fmtKg(Number(o.totalKg) || 0, 0)} kg`,
          hay: `${o.orderNo} ${o.clientName ?? ''}`.toLowerCase(),
          to: `/office/zamowienia?q=${encodeURIComponent(o.orderNo)}`,
        })
      }
      for (const c of clients as any[]) {
        const name = c.displayName || c.name || ''
        out.push({
          group: 'Klienci',
          icon: <Users size={14} className="text-purple-600" />,
          title: <span className="font-semibold">{name}</span>,
          sub: c.nip ? `NIP ${c.nip}` : 'kontrahent',
          hay: `${name} ${c.nip ?? ''}`.toLowerCase(),
          to: `/office/kontrahenci?q=${encodeURIComponent(name)}`,
        })
      }
      for (const s of suppliers as any[]) {
        out.push({
          group: 'Dostawcy',
          icon: <Truck size={14} className="text-ink-3" />,
          title: <span className="font-semibold">{s.name}</span>,
          sub: s.nip ? `NIP ${s.nip}` : 'dostawca',
          hay: `${s.name ?? ''} ${s.nip ?? ''}`.toLowerCase(),
          to: `/office/dostawcy?q=${encodeURIComponent(s.name ?? '')}`,
        })
      }
      cacheRef.current = { at: Date.now(), hits: out }
      setHits(out)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQ(''); setSel(0)
    void loadIndex()
    // Fokus po wyrenderowaniu overlaya.
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open, loadIndex])

  // ── Filtrowanie: każdy token musi wystąpić ──
  const results = useMemo(() => {
    const tokens = q.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return []
    const matched = hits.filter(h => tokens.every(t => h.hay.includes(t)))
    // Max 6 na grupę, żeby jedna grupa nie zalała listy.
    const perGroup = new Map<string, number>()
    const out: Hit[] = []
    for (const h of matched) {
      const n = perGroup.get(h.group) ?? 0
      if (n >= 6) continue
      perGroup.set(h.group, n + 1)
      out.push(h)
      if (out.length >= 24) break
    }
    return out
  }, [q, hits])

  useEffect(() => { setSel(0) }, [q])

  const go = useCallback((h: Hit) => {
    setOpen(false)
    navigate(h.to)
  }, [navigate])

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  // Zaznaczony wynik zawsze widoczny przy nawigacji strzałkami.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  // ── Przycisk w nagłówku (wygląda jak pole) ──
  const trigger = (
    <button type="button" onClick={() => setOpen(true)}
      className="hidden md:flex items-center gap-2 h-8 w-56 px-2.5 rounded-md border border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors text-[12px]"
      title="Globalne szukanie (Ctrl+K)">
      <Search size={13} />
      <span className="flex-1 text-left">Szukaj…</span>
      <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-white text-[10px] font-mono font-semibold text-gray-500">Ctrl K</kbd>
    </button>
  )

  if (!open) return trigger

  let lastGroup = ''
  return (
    <>
      {trigger}
      <div className="fixed inset-0 z-[70] bg-black/40 flex items-start justify-center pt-[12vh] px-4"
        onClick={() => setOpen(false)}>
        <div className="w-[640px] max-w-full rounded-xl border border-surface-4 bg-white shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-2.5 px-4 border-b border-surface-4">
            <Search size={16} className="text-ink-4 flex-shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Partia, zamówienie, klient, dostawca…"
              className="h-12 flex-1 text-[15px] outline-none placeholder:text-ink-4 bg-transparent"
            />
            <kbd className="px-1.5 py-0.5 rounded border border-surface-4 bg-surface-2 text-[10px] font-mono font-semibold text-ink-4">Esc</kbd>
          </div>

          <div ref={listRef} className="max-h-[52vh] overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-center text-[13px] text-ink-4">Ładuję indeks…</div>
            )}
            {!loading && q.trim() === '' && (
              <div className="px-4 py-5 text-[12px] text-ink-4 leading-relaxed">
                Wpisz numer partii (np. <code className="font-mono font-semibold text-ink-2">407</code>),
                numer zamówienia, nazwę klienta lub dostawcy.
                <span className="block mt-1">Partia otwiera pełny raport traceability.</span>
              </div>
            )}
            {!loading && q.trim() !== '' && results.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-ink-4">Brak wyników dla „{q}"</div>
            )}
            {!loading && results.map((h, i) => {
              const showGroup = h.group !== lastGroup
              lastGroup = h.group
              return (
                <div key={`${h.group}-${h.to}-${i}`}>
                  {showGroup && (
                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-ink-4">
                      {h.group}
                    </div>
                  )}
                  <button type="button" data-idx={i}
                    onClick={() => go(h)}
                    onMouseMove={() => setSel(i)}
                    className={cn('w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                      i === sel ? 'bg-brand-light' : 'hover:bg-surface-2')}>
                    <span className="w-7 h-7 rounded-md bg-surface-2 border border-surface-4 flex items-center justify-center flex-shrink-0">
                      {h.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-tight truncate">{h.title}</span>
                      <span className="block text-[11px] text-ink-3 truncate">{h.sub}</span>
                    </span>
                    {i === sel && <CornerDownLeft size={13} className="text-ink-4 flex-shrink-0" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
