import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ShoppingCart, Plus, Moon, PanelLeft, Keyboard, CornerDownLeft } from 'lucide-react'
import { ALL_MODULES } from './modules'
import type { Order } from '../data/model'
import { etapZamowienia, relDay, computeMetrics, kg } from '../data/model'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

interface Cmd { id: string; group: string; label: React.ReactNode; hint?: string; icon: React.ReactNode; run: () => void; text: string }

export function CommandPalette({ orders, onClose, openOrder, openModule, newOrder, toggleTheme, toggleNav, showShortcuts }: {
  orders: Order[]; onClose: () => void; openOrder: (id: string) => void; openModule: (k: string) => void
  newOrder: () => void; toggleTheme: () => void; toggleNav: () => void; showShortcuts: () => void
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  const all = useMemo<Cmd[]>(() => [
    ...orders.map(o => {
      const m = computeMetrics(o)
      return {
        id: o.id, group: 'Zamówienia', icon: <ShoppingCart size={16} />, run: () => openOrder(o.id),
        label: <span><b className="num">{o.no}</b> · {o.client.name}</span>,
        hint: `${(e => (e.szczegol ? `${e.tekst} ${e.szczegol}` : e.tekst))(etapZamowienia(o, m))} · ${relDay(o.delivery)} · ${kg(m.orderedKg)}`,
        text: norm(`${o.no} ${o.no.slice(-4)} ${o.client.name} ${o.client.city} ${o.lines.map(l => l.recipe).join(' ')}`),
      }
    }),
    ...ALL_MODULES.map(md => {
      const I = md.icon
      return { id: `m-${md.key}`, group: 'Moduły', icon: <I size={16} />, label: md.label, run: () => openModule(md.key), text: norm(md.label) }
    }),
    { id: 'a-new', group: 'Polecenia', icon: <Plus size={16} />, label: 'Nowe zamówienie', hint: 'Ctrl+N', run: newOrder, text: 'nowe zamowienie dodaj utworz' },
    { id: 'a-theme', group: 'Polecenia', icon: <Moon size={16} />, label: 'Przełącz motyw jasny / grafitowy', run: toggleTheme, text: 'motyw ciemny jasny grafitowy theme' },
    { id: 'a-nav', group: 'Polecenia', icon: <PanelLeft size={16} />, label: 'Zwiń / rozwiń nawigację', hint: 'Ctrl+B', run: toggleNav, text: 'nawigacja menu zwin rozwin' },
    { id: 'a-keys', group: 'Polecenia', icon: <Keyboard size={16} />, label: 'Skróty klawiszowe', hint: 'F1', run: showShortcuts, text: 'skroty klawiatura pomoc' },
  ], [orders, openOrder, openModule, newOrder, toggleTheme, toggleNav, showShortcuts])

  const results = useMemo(() => {
    const t = norm(q.trim())
    if (!t) return [...all.filter(c => c.group === 'Polecenia'), ...all.filter(c => c.group === 'Zamówienia').slice(0, 5), ...all.filter(c => c.group === 'Moduły').slice(0, 4)]
    const words = t.split(/\s+/)
    return all.filter(c => words.every(w => c.text.includes(w))).slice(0, 14)
  }, [q, all])

  useEffect(() => { setIdx(0) }, [q])
  const run = (c?: Cmd) => { if (!c) return; onClose(); c.run() }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Szukaj lub wykonaj polecenie">
        <div className="pin">
          <Search size={18} color="var(--ink-3)" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Numer zamówienia, klient, receptura, moduł…"
            aria-label="Szukaj" role="combobox" aria-expanded="true" aria-controls="pal-res"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(results.length - 1, i + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); run(results[idx]) }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }} />
        </div>
        <div className="res" id="pal-res" role="listbox">
          {results.length === 0 && <div className="empty"><h3>Nic nie znaleziono</h3>Sprawdź numer zamówienia albo wpisz fragment nazwy klienta.</div>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="grp">{c.group}</div> : null
            lastGroup = c.group
            return (
              <React.Fragment key={c.id}>
                {head}
                <button className="it" role="option" aria-selected={i === idx} onMouseMove={() => setIdx(i)} onClick={() => run(c)}>
                  {c.icon}<span>{c.label}</span>{c.hint && <span className="s">{c.hint}</span>}
                </button>
              </React.Fragment>
            )
          })}
        </div>
        <div className="foot"><span><span className="kbd">↑</span> <span className="kbd">↓</span> wybór</span><span><span className="kbd"><CornerDownLeft size={11} /></span> otwórz</span><span><span className="kbd">Esc</span> zamknij</span></div>
      </div>
    </div>
  )
}
