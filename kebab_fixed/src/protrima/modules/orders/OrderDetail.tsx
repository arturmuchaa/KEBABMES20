import React from 'react'
import { RotateCcw, Trash2, X, ExternalLink, Maximize2, Minimize2, PanelRight, PanelBottom, FileText, Printer, Truck, Split, Copy, Ban, Boxes, CheckCheck, Pencil, List, ClipboardList, PackageCheck } from 'lucide-react'
import { useApp, type AppApi, type Cmd, type DetailTab } from '../../shell/context'
import { computeMetrics, kg, num, pct, dueText, type Order } from '../../data/model'
import { FAZA_ZAPISU } from '../../proba'
import { dozwolone } from './akcje'
import { OrderStatusLabel } from '../../ui/Glyphs'
import { OverviewTab } from './tabs/Overview'
import { LinesTab } from './tabs/Lines'
import { ProductionTab } from './tabs/Production'
import { CoverageTab } from './tabs/Coverage'
import { PalletsTab } from './tabs/Pallets'
import { ShippingTab } from './tabs/Shipping'
import { DocumentsTab } from './tabs/Documents'
import { HistoryTab } from './tabs/History'

/** Zakładki chowane w widoku prostym — dostępne po przełączeniu Widok → Widok prosty. */
const TABS_PELNE: DetailTab[] = ['production', 'history']

export const TAB_DEFS: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: 'Przegląd' },
  { key: 'lines', label: 'Pozycje' },
  { key: 'production', label: 'Produkcja' },
  { key: 'coverage', label: 'Pokrycie' },
  { key: 'pallets', label: 'Palety' },
  { key: 'shipping', label: 'Wysyłka' },
  { key: 'documents', label: 'Dokumenty' },
  { key: 'history', label: 'Historia' },
]

/**
 * Polecenia dla wybranego zamówienia — te same na pasku narzędzi listy,
 * w oknie zamówienia i w menu „Zamówienia". Bez wyboru są wyszarzone.
 */
export type AkcjaZam = 'confirm' | 'done' | 'undo' | 'cancel' | 'delete'
export function orderCommands(order: Order | null, app: AppApi, onTab: (t: DetailTab) => void, akcja: (r: AkcjaZam, o: Order) => void): Cmd[] {
  const none = !order
  const closed = !!order && (order.status === 'done' || order.status === 'cancelled')
  const can = order ? dozwolone(order) : null
  const demo = (t: string, d = FAZA_ZAPISU) => app.toast({ kind: 'info', title: t, detail: d })
  return [
    { id: 'edit', group: 2, label: 'Edytuj', icon: <Pencil size={17} />, kbd: 'F2', disabled: none || !can?.delete, tip: order && !can?.delete ? 'Edytować można szkic albo potwierdzone' : undefined, run: () => order && app.editOrder(order.id) },
    { id: 'duplicate', group: 2, label: 'Duplikuj', icon: <Copy size={17} />, kbd: 'Ctrl+D', opt: true, disabled: none, run: () => order && app.copyOrder(order.id) },
    { id: 'confirm', group: 2, label: 'Potwierdź', icon: <CheckCheck size={17} />, opt: true, disabled: !can?.confirm, tip: order && !can?.confirm ? 'Dotyczy tylko szkiców' : undefined, run: () => order && akcja('confirm', order) },
    { id: 'pallets', group: 3, label: 'Palety', icon: <Boxes size={17} />, disabled: none || order!.status === 'draft', run: () => onTab('pallets') },
    { id: 'shipping', group: 3, label: 'Wysyłka', icon: <Truck size={17} />, disabled: none || order!.status === 'draft', run: () => onTab('shipping') },
    { id: 'docs', group: 3, label: 'Dokumenty', icon: <FileText size={17} />, disabled: none, menu: [
      { label: 'Wystaw WZ…', icon: <Truck size={15} />, onSelect: () => order && app.issueWz(order.id), disabled: closed || order?.status === 'draft' },
      { label: 'Wystaw CMR…', icon: <FileText size={15} />, onSelect: () => order && app.openCmr(order.id), disabled: none || order?.status === 'draft' },
      { label: closed ? 'Podgląd HDI (zamrożone)' : 'Generuj HDI', icon: <FileText size={15} />, onSelect: () => order && app.genHdi(order.id), disabled: none || order?.status === 'draft' },
      { sep: true },
      { label: 'Podział wysyłki na fakturę i WZ', icon: <Split size={15} />, onSelect: () => order && app.splitOrder(order.id), disabled: closed || order?.status === 'draft' },
      { label: 'Wszystkie dokumenty zamówienia', icon: <List size={15} />, onSelect: () => onTab('documents') },
    ] },
    { id: 'print', group: 4, label: 'Drukuj', icon: <Printer size={17} />, kbd: 'Ctrl+P', menuOnly: true, disabled: none, menu: [
      { label: 'Zamówienie dla klienta (wydruk / PDF)', icon: <Printer size={15} />, onSelect: () => order && app.printOrder(order.id) },
      { label: 'Lista kompletacji (wewnętrzna)', icon: <ClipboardList size={15} />, onSelect: () => order && app.printPicking([order.id]) },
      { label: 'Kartki palet', icon: <Boxes size={15} />, onSelect: () => demo('Kartki palet', 'Wydruki zamówień przeniesiemy w fazie 3. Teraz: stary MES na tej samej kopii.'), disabled: !order?.pallets.length },
    ] },
    { id: 'stock', group: 4, label: 'Wyrób w magazynie', icon: <PackageCheck size={17} />, opt: true, disabled: none, tip: 'Pozycje magazynowe przydzielone do zamówienia', run: () => app.gotoStock(order?.id) },
    { id: 'done', group: 8, label: 'Oznacz jako zrealizowane…', icon: <PackageCheck size={15} />, menuOnly: true, disabled: !can?.done, run: () => order && akcja('done', order) },
    { id: 'undo', group: 8, label: 'Cofnij realizację…', icon: <RotateCcw size={15} />, menuOnly: true, disabled: !can?.undo, run: () => order && akcja('undo', order) },
    { id: 'cancel', group: 9, label: 'Anuluj zamówienie…', icon: <Ban size={15} />, menuOnly: true, danger: true, disabled: !can?.cancel, run: () => order && akcja('cancel', order) },
    { id: 'delete', group: 9, label: 'Usuń zamówienie…', icon: <Trash2 size={15} />, menuOnly: true, danger: true, disabled: !can?.delete, run: () => order && akcja('delete', order) },
  ]
}

/**
 * Szczegóły zamówienia — ten sam komponent w dolnym panelu listy
 * i w osobnym oknie. Panel jest miejscem pracy: w nagłówku tylko następny
 * krok, w zakładkach działania tej zakładki. Reszta poleceń jest na pasku narzędzi.
 */
export function OrderDetail({ order, tab, onTab, mode, maxed, onMax, onClose, onConfirm }: {
  order: Order; tab: DetailTab; onTab: (t: DetailTab) => void; mode: 'dock' | 'page'
  maxed?: boolean; onMax?: () => void; onClose?: () => void; onConfirm: (o: Order) => void
}) {
  const app = useApp()
  const m = computeMetrics(order)
  const closed = order.status === 'done' || order.status === 'cancelled'

  // Następny krok zależy od etapu zamówienia
  let primary: React.ReactNode = null
  if (order.status === 'draft') primary = <button className="btn primary" onClick={() => onConfirm(order)}><CheckCheck size={16} />Potwierdź zamówienie</button>
  else if (!closed && m.unassignedQty > 0) primary = <button className="btn primary" onClick={() => onTab('pallets')}><Boxes size={16} />Rozpisz palety</button>
  else if (!closed && m.missingKg === 0 && m.shipPct < 100) primary = <button className="btn primary" onClick={() => onTab('shipping')}><Truck size={16} />Przygotuj wysyłkę</button>
  else if (!closed && m.missingKg > 0) primary = <button className="btn" onClick={() => onTab('coverage')}><PackageCheck size={16} />Uzupełnij braki</button>

  const counts: Partial<Record<DetailTab, React.ReactNode>> = {
    lines: <span className="badge">{order.lines.length}</span>,
    pallets: m.palletsTotal ? <span className={`badge${m.unassignedQty ? ' warn' : ''}`}>{m.palletsTotal}</span> : (closed || order.status === 'draft' ? null : <span className="badge warn">0</span>),
    coverage: !closed && m.missingKg > 0 ? <span className="crit-ink" style={{ fontSize: 'var(--fs-xs)', fontWeight: 600 }}>−{num(m.missingKg)} kg</span> : null,
    documents: order.docs.some(d => d.state === 'todo' && (d.kind === 'WZ' || d.kind === 'CMR')) ? <span className="badge warn" data-tip="Dokumenty gotowe do wystawienia">{order.docs.filter(d => d.state === 'todo' && (d.kind === 'WZ' || d.kind === 'CMR')).length}</span> : null,
  }

  return (
    <>
      <div className="dock-head">
        <div className="dock-id">
          <div className="l1">
            <h2>{order.no}</h2>
            <OrderStatusLabel status={order.status} />
            {m.flags.filter(f => f.level !== 'info').slice(0, 2).map(f => <span key={f.code} className={`tag ${f.level}`} data-tip={f.detail}>{f.label}</span>)}
          </div>
          <div className="l2">
            <b style={{ color: 'var(--ink-1)', fontWeight: 600 }}>{order.client.name}</b>{order.client.city && <> · {order.client.city}</>}{order.client.country && order.client.country !== 'PL' && <>, {order.client.country}</>}
            {' · '}wyjazd <span className={m.dueDays !== null && m.dueDays < 0 && !closed ? 'crit-ink strong' : ''}>{dueText(order)}</span>
          </div>
        </div>
        <div className="dock-figs" aria-label="Kluczowe liczby">
          <div className="f"><span className="k">Zamówiono</span><span className="v">{kg(m.orderedKg)}<small className="hide-m">{num(m.orderedQty)} szt.</small></span></div>
          <div className="f" data-tip={'Zgłoszono z tabletów produkcyjnych.\nNie zwiększa pokrycia, dopóki wyrób nie trafi na magazyn.'}><span className="k"><i className="f-prod" />Produkcja</span><span className="v">{pct(m.prodPct)}<small className="hide-s">{kg(m.producedKg)}</small></span></div>
          <div className="f" data-tip="W magazynie (przydzielone) + wydano do klienta"><span className="k"><i className="f-stock" />Pokrycie</span><span className="v">{pct(m.coverPct)}{m.missingKg > 0 && !closed ? <small className="crit-ink" style={{ fontWeight: 600 }}>brak {kg(m.missingKg)}</small> : <small className="ok-ink">komplet</small>}</span></div>
          <div className="f"><span className="k"><i className="f-ship" />Wydano</span><span className="v">{pct(m.shipPct)}<small className="hide-s">{kg(m.deliveredKg)}</small></span></div>
        </div>
        <div className="dock-actions">
          {primary}
          {mode === 'dock' && <>
            <span style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
            <button className="btn ghost icon" onClick={() => app.setPanel(app.panel === 'bok' ? 'dol' : 'bok')} aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'} data-tip={app.panel === 'bok' ? 'Przenieś panel na dół' : 'Przenieś panel na bok'}>{app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
            <button className="btn ghost icon" onClick={() => app.openOrder(order.id)} aria-label="Otwórz w osobnym oknie" data-tip="Otwórz w osobnym oknie (Enter)"><ExternalLink size={16} /></button>
            <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'} data-tip={maxed ? 'Przywróć' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
            <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel (Esc)" data-tip="Zamknij panel (Esc)"><X size={17} /></button>
          </>}
        </div>
      </div>
      <div className="dock-tabs" role="tablist" aria-label="Zakładki zamówienia">
        {TAB_DEFS.filter(t => !app.prosty || !TABS_PELNE.includes(t.key) || t.key === tab).map((t, i) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className="dock-tab" onClick={() => onTab(t.key)} data-tip={`Alt+${i + 1}`}>
            {t.label}{counts[t.key]}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel">
        {tab === 'overview' && <OverviewTab order={order} onTab={onTab} />}
        {tab === 'lines' && <LinesTab order={order} />}
        {tab === 'production' && <ProductionTab order={order} />}
        {tab === 'coverage' && <CoverageTab order={order} />}
        {tab === 'pallets' && <PalletsTab order={order} />}
        {tab === 'shipping' && <ShippingTab order={order} />}
        {tab === 'documents' && <DocumentsTab order={order} />}
        {tab === 'history' && <HistoryTab order={order} />}
      </div>
    </>
  )
}
