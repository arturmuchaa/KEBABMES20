import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ShoppingCart, Plus, Moon, PanelLeft, Keyboard, CornerDownLeft, Package, PackagePlus, Archive, FileText } from 'lucide-react'
import { ALL_MODULES } from './modules'
import { ZDARZENIE_ZAKLADKI } from '../modules/dokumenty/DokumentyModule'
import type { Order } from '../data/model'
import { etapZamowienia, relDay, computeMetrics, kg, isClosed, fmtDate } from '../data/model'
import { posKg, type StockPos } from '../data/stock'
import type { OrdersCmd } from './context'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')

/**
 * Wiersz wyniku. Zamówienia i wyrób mają kolumny (stan · termin · masa) — masy stoją w jednej linii,
 * a nie w szarym zdaniu o różnej długości. Polecenia i moduły mają po prawej skrót klawiszowy.
 */
interface Cmd {
  id: string; group: string; icon: React.ReactNode; run: () => void; text: string
  label: string; sub?: string
  kolumny?: [string, string, string]
  hint?: string
  zamkniete?: boolean
}

/** Wpisane słowa wyróżnione w tekście (jak na liście pola z listą). Dopasowanie bez polskich znaków i wielkości liter. */
function Podswietl({ t, words }: { t: string; words: string[] }) {
  const chars = [...t]
  const n = chars.map(c => norm(c)).join('')
  if (!words.length || n.length !== chars.length) return <>{t}</>
  const on = new Array<boolean>(chars.length).fill(false)
  for (const w of words) { const i = n.indexOf(w); if (i >= 0) for (let k = i; k < i + w.length; k++) on[k] = true }
  const out: React.ReactNode[] = []
  let i = 0
  while (i < chars.length) {
    let j = i
    while (j < chars.length && on[j] === on[i]) j++
    const s = chars.slice(i, j).join('')
    out.push(on[i] ? <mark key={i}>{s}</mark> : s)
    i = j
  }
  return <>{out}</>
}

const ZAMKNIETYCH = 3

export function CommandPalette({ orders, stock, modulDostepny = () => true, onClose, openOrder, openModule, newOrder, newReception, gotoStock, gotoOrders, toggleTheme, toggleNav, showShortcuts }: {
  orders: Order[]; stock: StockPos[]; modulDostepny?: (key: string) => boolean; onClose: () => void; openOrder: (id: string) => void; openModule: (k: string) => void
  newOrder: () => void; newReception: () => void; gotoStock: (id: string) => void; gotoOrders: (cmd: Omit<OrdersCmd, 'n'>) => void
  toggleTheme: () => void; toggleNav: () => void; showShortcuts: () => void
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])

  const all = useMemo<Cmd[]>(() => [
    { id: 'a-new', group: 'Polecenia', icon: <Plus size={16} />, label: 'Nowe zamówienie', hint: 'Ctrl+N', run: newOrder, text: 'nowe zamowienie dodaj utworz' },
    { id: 'a-rec', group: 'Polecenia', icon: <PackagePlus size={16} />, label: 'Nowe przyjęcie surowca', run: newReception, text: 'nowe przyjecie surowca dostawa auto cwiartka' },
    { id: 'a-theme', group: 'Polecenia', icon: <Moon size={16} />, label: 'Przełącz motyw jasny / grafitowy', run: toggleTheme, text: 'motyw ciemny jasny grafitowy theme' },
    { id: 'a-nav', group: 'Polecenia', icon: <PanelLeft size={16} />, label: 'Zwiń / rozwiń nawigację', hint: 'Ctrl+B', run: toggleNav, text: 'nawigacja menu zwin rozwin' },
    { id: 'a-keys', group: 'Polecenia', icon: <Keyboard size={16} />, label: 'Skróty klawiszowe', hint: 'F1', run: showShortcuts, text: 'skroty klawiatura pomoc' },
    ...orders.map((o): Cmd => {
      const m = computeMetrics(o)
      const e = etapZamowienia(o, m)
      const auto = o.zaladunek?.plate
      // Sam numer rejestracyjny („Zrealizowane KRA613FC”) wyglądał jak kod — podpisujemy go.
      const stan = e.szczegol ? (e.szczegol === auto ? `${e.tekst} · auto ${auto}` : `${e.tekst} ${e.szczegol}`) : e.tekst
      return {
        id: o.id, group: 'Zamówienia', icon: <ShoppingCart size={16} />, run: () => openOrder(o.id),
        label: o.no, sub: o.client.name, zamkniete: isClosed(o),
        kolumny: [stan, o.delivery ? relDay(o.delivery) : 'bez terminu', kg(m.orderedKg)],
        text: norm(`${o.no} ${o.no.slice(-4)} ${o.client.name} ${o.client.city} ${o.lines.map(l => l.recipe).join(' ')}`),
      }
    }),
    ...stock.map((p): Cmd => ({
      id: `fg-${p.id}`, group: 'Wyrób gotowy', icon: <Package size={16} />, run: () => gotoStock(p.id),
      label: p.batch, sub: `${p.recipe} ${p.kgPerUnit} kg`,
      kolumny: [p.status === 'blocked' ? 'zablokowane' : p.orderNo ? `przydzielone ${p.orderNo}` : 'wolne', p.prodDate ? fmtDate(p.prodDate) : '—', kg(posKg(p))],
      // Po partii i recepturze — nie po kliencie (to byłby drugi raz te same zamówienia).
      text: norm(`${p.batch} ${p.recipe} ${p.product}`),
    })),
    ...ALL_MODULES.filter(md => modulDostepny(md.key)).map((md): Cmd => {
      const I = md.icon
      return { id: `m-${md.key}`, group: 'Moduły', icon: <I size={16} />, label: md.label, run: () => openModule(md.key), text: norm(md.label) }
    }),
    // „WZ”, „CMR”, „HDI” w palecie otwierają Dokumenty od razu na właściwej zakładce.
    ...(modulDostepny('dokumenty') ? (['wz', 'cmr', 'hdi'] as const).map((r): Cmd => ({
      id: `dok-${r}`, group: 'Moduły', icon: <FileText size={16} />, label: `Dokumenty — ${r.toUpperCase()}`,
      run: () => { openModule('dokumenty'); setTimeout(() => window.dispatchEvent(new CustomEvent(ZDARZENIE_ZAKLADKI, { detail: r })), 0) },
      text: norm(`dokumenty ${r} ${r === 'wz' ? 'wydanie zewnetrzne wm' : r === 'hdi' ? 'handlowy dokument identyfikacyjny' : 'list przewozowy'}`),
    })) : []),
  ], [orders, stock, modulDostepny, openOrder, openModule, newOrder, newReception, gotoStock, toggleTheme, toggleNav, showShortcuts])

  const words = useMemo(() => norm(q.trim()).split(/\s+/).filter(Boolean), [q])
  const results = useMemo<Cmd[]>(() => {
    if (!words.length) return [...all.filter(c => c.group === 'Polecenia'), ...all.filter(c => c.group === 'Zamówienia' && !c.zamkniete).slice(0, 5), ...all.filter(c => c.group === 'Moduły').slice(0, 4)]
    const hit = all.filter(c => words.every(w => c.text.includes(w)))
    const z = hit.filter(c => c.group === 'Zamówienia')
    // Aktywne najpierw; zamknięte najwyżej trzy — reszta w liście Zamówień (widok Zamknięte z tym samym tekstem).
    const zamkniete = z.filter(c => c.zamkniete)
    const wiecej: Cmd[] = zamkniete.length > ZAMKNIETYCH ? [{
      id: 'z-wiecej', group: 'Zamówienia', icon: <Archive size={16} />, label: `Pokaż wszystkie zamknięte (${zamkniete.length})`, text: '',
      run: () => gotoOrders({ view: 'closed', q: q.trim() }),
    }] : []
    return [
      ...hit.filter(c => c.group === 'Polecenia'),
      ...z.filter(c => !c.zamkniete).slice(0, 8), ...zamkniete.slice(0, ZAMKNIETYCH), ...wiecej,
      ...hit.filter(c => c.group === 'Wyrób gotowy').slice(0, 6),
      ...hit.filter(c => c.group === 'Moduły').slice(0, 4),
    ]
  }, [words, all, q, gotoOrders])

  useEffect(() => { setIdx(0) }, [q])
  const run = (c?: Cmd) => { if (!c) return; onClose(); c.run() }

  let lastGroup = ''
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Szukaj lub wykonaj polecenie">
        <div className="pin">
          <Search size={18} color="var(--ink-3)" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Zamówienie, klient, receptura, partia wyrobu, polecenie…"
            aria-label="Szukaj" role="combobox" aria-expanded="true" aria-controls="pal-res"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(results.length - 1, i + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); run(results[idx]) }
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }} />
        </div>
        <div className="res" id="pal-res" role="listbox">
          {results.length === 0 && <div className="empty"><h3>Nic nie znaleziono</h3>Wpisz numer zamówienia, nazwę klienta, recepturę albo numer partii wyrobu.</div>}
          {results.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="grp">{c.group}</div> : null
            lastGroup = c.group
            return (
              <React.Fragment key={c.id}>
                {head}
                <button className={`it${c.kolumny ? ' wiersz' : ''}${c.zamkniete ? ' zamk' : ''}`} role="option" aria-selected={i === idx} onMouseMove={() => setIdx(i)} onClick={() => run(c)}>
                  {c.icon}
                  <span className="g"><b className="num"><Podswietl t={c.label} words={words} /></b>{c.sub && <span className="sb"> · <Podswietl t={c.sub} words={words} /></span>}</span>
                  {c.kolumny
                    ? <><span className="c">{c.kolumny[0]}</span><span className="c">{c.kolumny[1]}</span><span className="c num">{c.kolumny[2]}</span></>
                    : c.hint && <span className="s">{c.hint}</span>}
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
