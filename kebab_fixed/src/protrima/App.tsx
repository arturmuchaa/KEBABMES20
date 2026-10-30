import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LayoutGrid, ShoppingCart, FilePlus2, Palette, Package, Printer, LogOut, XSquare, Search, Pencil, Copy, Keyboard, Info, RefreshCw, FileBarChart, Users, Clock, Car, UserCog, SlidersHorizontal, Wallet, BarChart3, Calculator, Thermometer, Layers, Archive, Tags, Plus, PackageOpen, ClipboardList, MoreHorizontal, FileText, type LucideIcon } from 'lucide-react'
import { AppCtx, type AppApi, type Cmd, type MenuItem, type OrdersCmd, type PanelWybor, type Toast, Toasts, TooltipLayer, Dialog } from './shell/context'
import { TitleBar, MenuBar, MainToolbar, TabStrip, Nav, StatusBar, type MenuDef, type ToolItem, type WTab } from './shell/Chrome'
import { CommandPalette } from './shell/CommandPalette'
import { moduleDef } from './shell/modules'
import { useOrders } from './data/store'
import { computeMetrics } from './data/model'
import { Dashboard } from './modules/dashboard/Dashboard'
import { OrdersModule } from './modules/orders/OrdersModule'
import { OrderTab } from './modules/orders/OrderTab'
import { FinishedGoods } from './modules/stock/FinishedGoods'
import { PrzyjeciaModule } from './modules/przyjecia/PrzyjeciaModule'
import { OrderEditor } from './modules/orders/edytor/OrderEditor'
import { ZamowienieDrukDialog } from './modules/orders/druk/ZamowienieDruk'
import { KartkiPaletDialog } from './modules/orders/druk/KartkiPalet'
import { WzZamowienia } from './modules/orders/wz/WzZamowienia'
import { ListaKompletacjiDialog } from './modules/orders/druk/ListaKompletacji'
import { CmrDialog, generujHdi } from './modules/orders/dokumenty/Cmr'
import { PodzialWysylki } from './modules/orders/podzial/PodzialWysylki'
import { PrzyjecieEditor } from './modules/przyjecia/formularz/PrzyjecieEditor'
import { computeMetrics as metryki } from './data/model'
import { Placeholder } from './modules/misc/Placeholder'
import { DesignSystem } from './modules/misc/DesignSystem'
import { Logo } from './brand/Logo'
import { useAuth } from '@/features/auth/AuthContext'
import { W_STARYM_MES } from './proba'
import { ProbaZnacznik } from './kopia'

// Poniżej ~1180 px (telefon, wąski panel podglądu) pokazujemy cały pulpit pomniejszony
// zamiast łamać układ biurowy — PROTRIMA jest aplikacją na komputer.
const LOGICAL_W = 1280

function measure() {
  const w = window.innerWidth, h = window.innerHeight
  const scaled = w < 1180
  const scale = scaled ? w / LOGICAL_W : 1
  return { scaled, scale, lw: scaled ? LOGICAL_W : w, lh: scaled ? Math.round(Math.min(1000, Math.max(720, h / scale))) : h }
}
const systemDark = () => {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
const store = {
  get(k: string) { try { return window.localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { window.localStorage.setItem(k, v) } catch { /* bez pamięci przeglądarki */ } },
}

/** Powłoka PROTRIMA. Stan danych (OrdersProvider) zakłada Root — po zalogowaniu. */
export function App() {
  return <Shell />
}

function Shell() {
  const appRef = useRef<HTMLDivElement>(null)
  const { orders, refresh } = useOrders()
  const { logout } = useAuth()
  const [vp, setVp] = useState(measure)
  useEffect(() => {
    const on = () => setVp(measure())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // ─── Układ: widok prosty i położenie panelu szczegółów (pamiętane na tym komputerze) ──
  const [prosty, setProsty] = useState(() => store.get('protrima.uklad') !== 'pelny')
  const toggleProsty = useCallback(() => setProsty(v => { store.set('protrima.uklad', v ? 'pelny' : 'prosty'); return !v }), [])
  const [panelWybor, setPanelWybor] = useState<PanelWybor>(() => (store.get('protrima.panel') as PanelWybor | null) ?? 'auto')
  const setPanel = useCallback((p: PanelWybor) => { store.set('protrima.panel', p); setPanelWybor(p) }, [])
  // Automatycznie: niski ekran (laptop, 1366×768, 1920×1080 przy 125%) — panel z boku, duży monitor — na dole.
  const panel: 'dol' | 'bok' = panelWybor === 'auto' ? (vp.lh < 950 ? 'bok' : 'dol') : panelWybor

  // ─── Gęstość, nawigacja, motyw ──────────────────────────────────────────
  const [densityOverride, setDensityOverride] = useState<null | 'comfortable' | 'compact'>(null)
  // Widok prosty trzyma czytelne, większe litery także na małym ekranie.
  const density = densityOverride ?? (prosty ? 'comfortable' : vp.lw < 1500 || vp.lh < 900 ? 'compact' : 'comfortable')
  const [navOverride, setNavOverride] = useState<null | boolean>(null)
  const navCollapsed = navOverride ?? vp.lw < 1500
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (store.get('protrima.theme') as 'light' | 'dark' | null) ?? systemDark())
  const [themeExplicit, setThemeExplicit] = useState(() => !!store.get('protrima.theme'))

  useLayoutEffect(() => {
    const r = document.documentElement
    r.dataset.density = density
    r.dataset.nav = navCollapsed ? 'collapsed' : 'expanded'
    r.dataset.w = vp.lw >= 1700 ? 'l' : vp.lw >= 1280 ? 'm' : 's'
    r.classList.toggle('is-scaled', vp.scaled)
    if (themeExplicit) r.dataset.theme = theme
  }, [density, navCollapsed, vp, theme, themeExplicit])
  useEffect(() => {
    if (themeExplicit) return
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const on = () => setTheme(systemDark())
    mq?.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [themeExplicit])
  const toggleTheme = useCallback(() => {
    setTheme(t => { const n = t === 'dark' ? 'light' : 'dark'; store.set('protrima.theme', n); return n })
    setThemeExplicit(true)
  }, [])
  const toggleNav = useCallback(() => setNavOverride(v => !(v ?? vp.lw < 1500)), [vp.lw])
  // Klasyczne „Widok → Paski narzędzi”: pasek można ukryć, a etykiety przycisków wyłączyć
  const [toolbarOn, setToolbarOn] = useState(() => store.get('protrima.toolbar') !== 'off')
  const [toolLabels, setToolLabels] = useState(() => store.get('protrima.tlabels') !== 'off')
  useLayoutEffect(() => {
    document.documentElement.dataset.uklad = prosty ? 'prosty' : 'pelny'
    document.documentElement.dataset.panel = panel
  }, [prosty, panel])
  useLayoutEffect(() => {
    // Widok prosty chowa duży pasek narzędzi — te same polecenia są w menu i na pasku modułu.
    document.documentElement.dataset.toolbar = toolbarOn && !prosty ? 'on' : 'off'
    document.documentElement.dataset.tlabels = toolLabels ? 'on' : 'off'
  }, [toolbarOn, toolLabels, prosty])
  const toggleToolbar = useCallback(() => setToolbarOn(v => { store.set('protrima.toolbar', v ? 'off' : 'on'); return !v }), [])
  const toggleLabels = useCallback(() => setToolLabels(v => { store.set('protrima.tlabels', v ? 'off' : 'on'); return !v }), [])

  // ─── Okna robocze (karty) ───────────────────────────────────────────────
  const [tabs, setTabs] = useState<WTab[]>([
    { id: 'pulpit', kind: 'module', key: 'pulpit', title: 'Pulpit zakładu', icon: LayoutGrid },
    { id: 'zamowienia', kind: 'module', key: 'zamowienia', title: 'Zamówienia', icon: ShoppingCart },
    { id: 'magazyn-wg', kind: 'module', key: 'magazyn-wg', title: 'Wyrób gotowy', icon: Package },
    { id: 'przyjecia', kind: 'module', key: 'przyjecia', title: 'Przyjęcia surowca', icon: PackageOpen },
  ])
  const [active, setActive] = useState('pulpit')
  const [ordersCmd, setOrdersCmd] = useState<OrdersCmd>({ n: 0 })
  const [stockCmd, setStockCmd] = useState<{ n: number; select?: string }>({ n: 0 })
  const [recCmd, setRecCmd] = useState<{ n: number; select?: string }>({ n: 0 })
  const [ctx, setCtx] = useState<Record<string, React.ReactNode>>({})
  const [cmdMap, setCmdMap] = useState<Record<string, Cmd[]>>({})
  const toastRef = useRef<((t: Omit<Toast, 'id'>) => void) | null>(null)

  const openTab = useCallback((t: WTab) => {
    setTabs(ts => ts.some(x => x.id === t.id) ? ts : [...ts, t])
    setActive(t.id)
  }, [])
  const closeTab = useCallback((id: string) => {
    if (id === 'pulpit') return
    setTabs(ts => {
      const i = ts.findIndex(t => t.id === id)
      const next = ts.filter(t => t.id !== id)
      setActive(a => a === id ? (next[Math.max(0, i - 1)]?.id ?? 'pulpit') : a)
      return next
    })
  }, [])
  const openModule = useCallback((key: string) => {
    if (key === 'pulpit') { setActive('pulpit'); return }
    const m = moduleDef(key)
    openTab({ id: key, kind: 'module', key, title: m?.label ?? key, icon: key === 'system' ? Palette : m?.icon })
  }, [openTab])
  const openOrder = useCallback((id: string) => {
    const o = orders.find(x => x.id === id)
    if (!o) return
    openTab({ id: `order:${id}`, kind: 'order', key: id, title: o.no, icon: ShoppingCart })
  }, [orders, openTab])
  // Edytor zamówienia w karcie roboczej: nowe (new:N), kopia (new:N z copy), edycja (edit:<id>).
  const newSeq = useRef(0)
  const newOrder = useCallback((copyFrom?: string) => {
    newSeq.current += 1
    openTab({ id: `new:${newSeq.current}`, kind: 'new-order', key: copyFrom ?? '', title: copyFrom ? 'Kopia zamówienia' : 'Nowe zamówienie', icon: FilePlus2 })
  }, [openTab])
  const editOrder = useCallback((id: string) => {
    const o = orders.find(x => x.id === id)
    openTab({ id: `edit:${id}`, kind: 'edit-order', key: id, title: `Edycja ${o?.no ?? ''}`, icon: FilePlus2 })
  }, [orders, openTab])
  const copyOrder = useCallback((id: string) => newOrder(id), [newOrder])
  const [drukId, setDrukId] = useState<string | null>(null)
  const [kartki, setKartki] = useState<{ orderId: string; nos?: number[] } | null>(null)
  const printPallets = useCallback((orderId: string, nos?: number[]) => setKartki({ orderId, nos }), [])
  const printOrder = useCallback((id: string) => setDrukId(id), [])
  const [kompIds, setKompIds] = useState<string[] | null>(null)
  const printPicking = useCallback((ids: string[]) => setKompIds(ids.length ? ids : null), [])
  const [cmrId, setCmrId] = useState<string | null>(null)
  const openCmr = useCallback((id: string) => setCmrId(id), [])
  const genHdi = useCallback((id: string) => { void generujHdi(id, t => toastRef.current?.(t)) }, [])
  const splitOrder = useCallback((id: string) => {
    const o = orders.find(x => x.id === id)
    openTab({ id: `split:${id}`, kind: 'split', key: id, title: `Podział ${o?.no ?? ''}`, icon: FileText })
  }, [orders, openTab])
  const issueWz = useCallback((id: string) => {
    const o = orders.find(x => x.id === id)
    openTab({ id: `wz:${id}`, kind: 'wz', key: id, title: `WZ ${o?.no ?? ''}`, icon: FileText })
  }, [orders, openTab])
  const wzSeq = useRef(0)
  const wzWybor = useRef<Record<string, Array<{ id: string; qty: number }>>>({})
  const issueWzFromStock = useCallback((wybor: Array<{ id: string; qty: number }>) => {
    if (!wybor.length) return
    wzSeq.current += 1
    const id = `wz-stock:${wzSeq.current}`
    wzWybor.current[id] = wybor
    openTab({ id, kind: 'wz-stock', key: id, title: 'WZ z magazynu', icon: FileText })
  }, [openTab])
  const gotoOrders = useCallback((cmd: Omit<OrdersCmd, 'n'> = {}) => {
    openModule('zamowienia')
    setOrdersCmd({ ...cmd, n: Date.now() })
  }, [openModule])
  const recSeq = useRef(0)
  const newReception = useCallback(() => {
    recSeq.current += 1
    openTab({ id: `new-rec:${recSeq.current}`, kind: 'new-reception', key: '', title: 'Nowe przyjęcie', icon: PackageOpen })
  }, [openTab])
  const editReception = useCallback((id: string, no?: string) => {
    openTab({ id: `edit-rec:${id}`, kind: 'edit-reception', key: id, title: `Edycja przyjęcia ${no ?? ''}`.trim(), icon: PackageOpen })
  }, [openTab])
  const gotoReceptions = useCallback((select?: string) => {
    openModule('przyjecia')
    setRecCmd({ n: Date.now(), select })
  }, [openModule])
  const gotoStock = useCallback((select?: string) => {
    openModule('magazyn-wg')
    setStockCmd({ n: Date.now(), select })
  }, [openModule])

  // ─── Powiadomienia ──────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([])
  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts(ts => [...ts.slice(-2), { ...t, id }])
    window.setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 6500)
  }, [])
  toastRef.current = toast
  const reload = useCallback(() => {
    refresh().then(() => toast({ kind: 'ok', title: 'Odświeżono', detail: 'Dane pobrane z serwera próby.' }))
  }, [refresh, toast])

  // ─── Warstwy ────────────────────────────────────────────────────────────
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [about, setAbout] = useState(false)
  const demo = useCallback((title: string, detail = W_STARYM_MES) => toast({ kind: 'info', title, detail }), [toast])

  const modCmds = cmdMap[active] ?? []
  const runCmd = useCallback((id: string) => { const c = modCmds.find(x => x.id === id); if (c && !c.disabled) { c.run?.(); return true } return false }, [modCmds])

  // Prawy przycisk: menu przeglądarki tylko w polach tekstowych; na listach moduły pokazują własne menu akcji.
  useEffect(() => {
    const ctx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', ctx)
    return () => document.removeEventListener('contextmenu', ctx)
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '')
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleNav() }
      else if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); if (/^(przyjecia|new-rec:|edit-rec:)/.test(active)) newReception(); else newOrder() }
      else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(active) }
      else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); const pc = modCmds.find(c => c.id === 'print'); const first = pc?.menu?.find(m => m.onSelect && !m.disabled); if (first?.onSelect) first.onSelect(); else if (!runCmd('print')) demo('Drukowanie') }
      else if (mod && e.key.toLowerCase() === 'd' && !inField) { e.preventDefault(); runCmd('duplicate') }
      else if (mod && /^[1-9]$/.test(e.key)) { const t = tabs[Number(e.key) - 1]; if (t) { e.preventDefault(); setActive(t.id) } }
      else if (e.key === 'F1') { e.preventDefault(); setShortcuts(true) }
      else if (e.key === 'F5') { e.preventDefault(); reload() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, tabs, toggleNav, newOrder, newReception, closeTab, runCmd, demo, reload, modCmds])

  const setStatusCtx = useCallback((tabId: string, node: React.ReactNode) => setCtx(c => ({ ...c, [tabId]: node })), [])
  const setTabCmds = useCallback((tabId: string, cmds: Cmd[]) => setCmdMap(m => ({ ...m, [tabId]: cmds })), [])
  // Stałe funkcje na okno — moduły mogą je trzymać w zależnościach efektów bez pętli renderowania.
  const ctxSetters = useRef<Record<string, (n: React.ReactNode) => void>>({})
  const cmdSetters = useRef<Record<string, (c: Cmd[]) => void>>({})
  const ctxFor = (id: string) => (ctxSetters.current[id] ??= (n: React.ReactNode) => setStatusCtx(id, n))
  const cmdsFor = (id: string) => (cmdSetters.current[id] ??= (c: Cmd[]) => setTabCmds(id, c))

  const api = useMemo<AppApi>(() => ({
    openOrder, gotoOrders, gotoStock, openModule, newOrder: () => newOrder(), editOrder, copyOrder, printOrder, issueWz, printPicking, openCmr, genHdi, splitOrder, printPallets, issueWzFromStock, newReception, editReception, gotoReceptions, toast,
    setStatusCtx: () => undefined,
    appRef, scale: vp.scale, prosty, panel, panelWybor, setPanel,
  }), [openOrder, gotoOrders, gotoStock, openModule, newOrder, editOrder, copyOrder, printOrder, issueWz, printPicking, openCmr, genHdi, splitOrder, printPallets, issueWzFromStock, newReception, editReception, gotoReceptions, toast, vp.scale, prosty, panel, panelWybor, setPanel])

  const badges = useMemo(() => {
    const problem = orders.filter(o => { const m = computeMetrics(o); return m.level === 'crit' || m.level === 'warn' }).length
    return { zamowienia: { n: problem, level: 'crit' as const } }
  }, [orders])

  // ─── Menu główne ────────────────────────────────────────────────────────
  const activeTab = tabs.find(t => t.id === active)!
  const modLabel = activeTab.kind === 'new-reception' || activeTab.kind === 'edit-reception' ? 'Przyjęcie' : activeTab.kind === 'wz-stock' ? 'Wydanie' : activeTab.kind !== 'module' ? 'Zamówienie' : activeTab.key === 'pulpit' ? 'Pulpit' : (moduleDef(activeTab.key)?.label ?? 'Moduł')
  const fixed = ['p', 'e', 'w', 'r', 'n', 'o', 'c']
  const modAccess = [...modLabel.toLowerCase()].find(ch => /[a-z]/.test(ch) && !fixed.includes(ch)) ?? 'm'
  const findOnList = () => document.querySelector<HTMLInputElement>('.tabpane:not([hidden]) .toolbar .field')?.focus()
  const byGroup = (list: Cmd[]): MenuItem[] => {
    const cmds = [...list].sort((a, b) => a.group - b.group)
    return cmds.flatMap((c, i) => [
      ...(i > 0 && cmds[i - 1].group !== c.group ? [{ sep: true } as MenuItem] : []),
      ...(c.menu ? [{ header: c.label } as MenuItem, ...c.menu.map(m => ({ ...m, disabled: m.disabled || c.disabled }))] : [{ label: c.label, icon: c.icon, kbd: c.kbd, disabled: c.disabled, danger: c.danger, onSelect: c.run } as MenuItem]),
    ])
  }
  const goMod = (k: string, label: string, Icon: LucideIcon): MenuItem => ({ label, icon: <Icon size={15} />, onSelect: () => openModule(k) })

  const menus: MenuDef[] = [
    { key: 'plik', label: 'Plik', access: 'p', items: [
      { label: 'Nowe zamówienie', icon: <FilePlus2 size={15} />, kbd: 'Ctrl+N', onSelect: newOrder },
      { label: 'Nowe przyjęcie surowca', icon: <PackageOpen size={15} />, onSelect: newReception },
      { sep: true },
      { label: 'Otwórz… (szukaj wszędzie)', icon: <Search size={15} />, kbd: 'Ctrl+K', onSelect: () => setPalette(true) },
      { label: 'Drukuj…', icon: <Printer size={15} />, kbd: 'Ctrl+P', onSelect: () => { if (!runCmd('print')) demo('Drukowanie') } },
      { sep: true },
      { label: 'Zamknij okno', icon: <XSquare size={15} />, kbd: 'Ctrl+W', disabled: active === 'pulpit', onSelect: () => closeTab(active) },
      { label: 'Wyloguj', icon: <LogOut size={15} />, onSelect: () => { logout() } },
    ] },
    { key: 'edycja', label: 'Edycja', access: 'e', items: [
      { label: 'Edytuj', icon: <Pencil size={15} />, kbd: 'F2', disabled: !modCmds.some(c => c.id === 'edit' && !c.disabled), onSelect: () => runCmd('edit') },
      { label: 'Duplikuj', icon: <Copy size={15} />, kbd: 'Ctrl+D', disabled: !modCmds.some(c => c.id === 'duplicate' && !c.disabled), onSelect: () => runCmd('duplicate') },
      { sep: true },
      { label: 'Znajdź na liście', icon: <Search size={15} />, kbd: 'Ctrl+F', onSelect: findOnList },
      { label: 'Szukaj wszędzie', icon: <Search size={15} />, kbd: 'Ctrl+K', onSelect: () => setPalette(true) },
    ] },
    { key: 'widok', label: 'Widok', access: 'w', items: [
      { label: 'Pulpit zakładu', icon: <LayoutGrid size={15} />, onSelect: () => openModule('pulpit') },
      { sep: true },
      { label: 'Widok prosty (mniej przycisków i kolumn)', checked: prosty, onSelect: toggleProsty },
      { header: 'Panel szczegółów' },
      { label: 'Automatycznie (wg wysokości ekranu)', checked: panelWybor === 'auto', onSelect: () => setPanel('auto') },
      { label: 'Na dole', checked: panelWybor === 'dol', onSelect: () => setPanel('dol') },
      { label: 'Z boku', checked: panelWybor === 'bok', onSelect: () => setPanel('bok') },
      { sep: true },
      { label: 'Pasek narzędzi', checked: toolbarOn && !prosty, disabled: prosty, onSelect: toggleToolbar },
      { label: 'Etykiety na pasku narzędzi', checked: toolLabels, onSelect: toggleLabels },
      { label: 'Nawigacja boczna', checked: !navCollapsed, kbd: 'Ctrl+B', onSelect: toggleNav },
      { label: 'Gęstość kompaktowa', checked: density === 'compact', onSelect: () => setDensityOverride(density === 'compact' ? 'comfortable' : 'compact') },
      { label: 'Motyw grafitowy', checked: theme === 'dark', onSelect: toggleTheme },
      { sep: true },
      { label: 'Odśwież', icon: <RefreshCw size={15} />, kbd: 'F5', onSelect: reload },
    ] },
    { key: 'modul', label: modLabel, access: modAccess, items: modCmds.length ? byGroup(modCmds) : [{ label: 'Brak poleceń dla tego okna', disabled: true }] },
    { key: 'raporty', label: 'Raporty', access: 'r', items: [
      ...['Raport dzienny produkcji', 'Realizacja zamówień wg klienta', 'Terminowość dostaw', 'Stany magazynowe na dzień', 'Wydajność rozbioru'].map(l => ({ label: l, icon: <FileBarChart size={15} />, onSelect: () => openModule('raporty') })),
    ] },
    { key: 'narzedzia', label: 'Narzędzia', access: 'n', items: [
      { header: 'Pozostałe moduły' },
      goMod('plan-masowania', 'Plan masowania', Layers), goMod('opakowania', 'Opakowania i dodatki', Archive), goMod('katalog', 'Katalog wyrobów i etykiety', Tags),
      goMod('rozrachunki', 'Rozrachunki', Wallet), goMod('temperatury', 'Rejestr temperatur', Thermometer), goMod('analityka', 'Analityka', BarChart3), goMod('koszty', 'Kalkulacja kosztów', Calculator),
      { sep: true }, { header: 'Administracja' },
      goMod('pracownicy', 'Pracownicy', Users), goMod('czas-pracy', 'Czas pracy i rozliczenia', Clock), goMod('pojazdy', 'Pojazdy i przewoźnicy', Car), goMod('uzytkownicy', 'Użytkownicy i uprawnienia', UserCog), goMod('ustawienia', 'Ustawienia zakładu', SlidersHorizontal),
    ] },
    { key: 'okno', label: 'Okno', access: 'o', items: [
      ...tabs.map((t, i) => ({ label: t.title, checked: t.id === active, kbd: i < 9 ? `Ctrl+${i + 1}` : undefined, onSelect: () => setActive(t.id) } as MenuItem)),
      { sep: true },
      { label: 'Zamknij wszystkie okna oprócz Pulpitu', onSelect: () => { setTabs(ts => ts.filter(t => t.id === 'pulpit')); setActive('pulpit') } },
    ] },
    { key: 'pomoc', label: 'Pomoc', access: 'c', items: [
      { label: 'Skróty klawiszowe', icon: <Keyboard size={15} />, kbd: 'F1', onSelect: () => setShortcuts(true) },
      { label: 'System projektowy', icon: <Palette size={15} />, onSelect: () => openModule('system') },
      { sep: true },
      { label: 'O programie PROTRIMA', icon: <Info size={15} />, onSelect: () => setAbout(true) },
    ] },
  ]

  // ─── Pasek narzędzi (pas 3): sprawy programu, nie zaznaczonego rekordu ──
  const modPrint = modCmds.find(c => c.id === 'print')
  const printItems: MenuItem[] = modPrint
    ? (modPrint.menu ? modPrint.menu.map(m => ({ ...m, disabled: m.disabled || modPrint.disabled })) : [{ label: modPrint.label, icon: <Printer size={15} />, disabled: modPrint.disabled, onSelect: modPrint.run }])
    : [{ label: 'Brak wydruków dla tego okna', disabled: true }]
  const toolItems: ToolItem[] = [
    { id: 'new', label: 'Nowe zamówienie', icon: <Plus size={16} />, kbd: 'Ctrl+N', primary: true, split: true, run: newOrder, menu: [
      { header: 'Nowy dokument' },
      { label: 'Zamówienie klienta', icon: <FilePlus2 size={15} />, kbd: 'Ctrl+N', onSelect: newOrder },
      { label: 'Przyjęcie surowca', icon: <PackageOpen size={15} />, onSelect: newReception },
      { label: 'Zlecenie masowania', icon: <Layers size={15} />, onSelect: () => openModule('plan-masowania') },
      { label: 'Plan produkcji', icon: <ClipboardList size={15} />, onSelect: () => openModule('plan-produkcji') },
    ] },
    { id: 's1', sep: true },
    { id: 'plan', label: 'Plan produkcji', icon: <ClipboardList size={16} />, tip: 'Otwórz plan produkcji', run: () => openModule('plan-produkcji') },
    { id: 'report', label: 'Raport dzienny', icon: <FileBarChart size={16} />, tip: 'Raport dzienny produkcji', run: () => openModule('raporty') },
    { id: 's2', sep: true },
    { id: 'print', label: 'Drukuj', icon: <Printer size={16} />, kbd: 'Ctrl+P', tip: `Wydruki okna: ${modLabel}`, menu: [
      { header: `Wydruki · ${activeTab.title}` }, ...printItems,
      { sep: true }, { header: 'Raporty' },
      { label: 'Raport dzienny produkcji', icon: <FileText size={15} />, onSelect: () => openModule('raporty') },
    ] },
    { id: 'refresh', label: 'Odśwież', icon: <RefreshCw size={16} />, kbd: 'F5', run: reload },
    { id: 'grow', grow: true },
    { id: 'more', label: 'Więcej akcji', icon: <MoreHorizontal size={16} />, menu: [
      { label: 'Etykiety na pasku narzędzi', checked: toolLabels, onSelect: toggleLabels },
      { label: 'Ukryj pasek narzędzi', onSelect: toggleToolbar },
      { sep: true },
      { label: 'Skróty klawiszowe', icon: <Keyboard size={15} />, kbd: 'F1', onSelect: () => setShortcuts(true) },
      { label: 'System projektowy', icon: <Palette size={15} />, onSelect: () => openModule('system') },
      { label: 'O programie PROTRIMA', icon: <Info size={15} />, onSelect: () => setAbout(true) },
    ] },
  ]

  const currentKey = activeTab.kind === 'module' ? activeTab.key : activeTab.kind === 'order' || activeTab.kind === 'new-order' || activeTab.kind === 'edit-order' || activeTab.kind === 'wz' || activeTab.kind === 'split' ? 'zamowienia' : activeTab.kind === 'new-reception' || activeTab.kind === 'edit-reception' ? 'przyjecia' : activeTab.kind === 'wz-stock' ? 'magazyn-wg' : ''

  const renderTab = (t: WTab) => {
    const setTabCtx = ctxFor(t.id)
    const setCmds = cmdsFor(t.id)
    const isActive = t.id === active
    if (t.kind === 'order') return <OrderTab orderId={t.key} active={isActive} setCtx={setTabCtx} setCmds={setCmds} />
    if (t.kind === 'split') { const o = orders.find(x => x.id === t.key); return <PodzialWysylki orderId={t.key} orderNo={o?.no ?? ''} clientName={o?.client.name ?? ''} kgCalosc={o ? metryki(o).orderedKg : 0}
      active={isActive} setCmds={setCmds} onDone={() => { closeTab(t.id); gotoOrders({ select: t.key, tab: 'documents' }) }} /> }
    if (t.kind === 'wz-stock') return <WzZamowienia wybor={wzWybor.current[t.id] ?? []} active={isActive} setCmds={setCmds} onDone={() => { closeTab(t.id); delete wzWybor.current[t.id]; gotoStock() }} />
    if (t.kind === 'wz') return <WzZamowienia orderId={t.key} active={isActive} setCmds={setCmds} onDone={() => { closeTab(t.id); gotoOrders({ select: t.key, tab: 'documents' }) }} />
    if (t.kind === 'new-order' || t.kind === 'edit-order') return <OrderEditor tabId={t.id} active={isActive} setCmds={setCmds}
      orderId={t.kind === 'edit-order' ? t.key : undefined} copyFromId={t.kind === 'new-order' && t.key ? t.key : undefined}
      onDone={(id) => { closeTab(t.id); if (id) gotoOrders({ select: id, tab: 'lines', view: 'active' }) }} />
    if (t.kind === 'new-reception' || t.kind === 'edit-reception') return <PrzyjecieEditor tabId={t.id} active={isActive} setCmds={setCmds}
      receptionId={t.kind === 'edit-reception' ? t.key : undefined} onDone={(id) => { closeTab(t.id); if (id) gotoReceptions(id) }} />
    if (t.key === 'pulpit') return <Dashboard active={isActive} setCtx={setTabCtx} setCmds={setCmds} />
    if (t.key === 'zamowienia') return <OrdersModule cmd={ordersCmd} active={isActive} setCtx={setTabCtx} setCmds={setCmds} />
    if (t.key === 'magazyn-wg') return <FinishedGoods cmd={stockCmd} active={isActive} setCtx={setTabCtx} setCmds={setCmds} />
    if (t.key === 'przyjecia') return <PrzyjeciaModule cmd={recCmd} active={isActive} setCtx={setTabCtx} setCmds={setCmds} />
    if (t.key === 'system') return <DesignSystem />
    const def = moduleDef(t.key)
    return def ? <Placeholder def={def} /> : null
  }

  const app = (
    <div ref={appRef} className="app" style={vp.scaled ? { transform: `scale(${vp.scale})`, width: vp.lw, height: vp.lh } : undefined}>
      <TitleBar onPalette={() => setPalette(true)} onLogout={() => { logout() }} />
      <MenuBar menus={menus} />
      <MainToolbar items={toolItems} />
      <Nav current={currentKey} onOpen={openModule} badges={badges} collapsed={navCollapsed} onToggle={toggleNav} />
      <main className="main">
        <TabStrip tabs={tabs} active={active} onActivate={setActive} onClose={closeTab} />
        <div className="panes">
          {tabs.map(t => (
            <section key={t.id} className="tabpane" hidden={t.id !== active} aria-label={t.title}>{renderTab(t)}</section>
          ))}
        </div>
      </main>
      <StatusBar ctx={ctx[active]} density={density} onDensity={() => setDensityOverride(density === 'compact' ? 'comfortable' : 'compact')} />
      <TooltipLayer />
      <Toasts items={toasts} dismiss={id => setToasts(ts => ts.filter(t => t.id !== id))} />
      {palette && <CommandPalette orders={orders} onClose={() => setPalette(false)} openOrder={openOrder} openModule={openModule}
        newOrder={newOrder} toggleTheme={toggleTheme} toggleNav={toggleNav} showShortcuts={() => setShortcuts(true)} />}
      {cmrId && <CmrDialog orderId={cmrId} orderNo={orders.find(o => o.id === cmrId)?.no ?? ''} onClose={() => setCmrId(null)} />}
      {kompIds && <ListaKompletacjiDialog orderIds={kompIds} onClose={() => setKompIds(null)} />}
      {kartki && <KartkiPaletDialog orderId={kartki.orderId} palletNos={kartki.nos} onClose={() => setKartki(null)} />}
      {drukId && <ZamowienieDrukDialog orderId={drukId} onClose={() => setDrukId(null)} />}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
      {about && <Dialog title="O programie" onClose={() => setAbout(false)} footer={<button className="btn primary" onClick={() => setAbout(false)}>Zamknij</button>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Logo height={40} />
          <div className="muted">Production under control</div>
          <div>Wersja {__PROTRIMA_VERSION__} · <ProbaZnacznik /></div>
          <div className="note info" style={{ marginTop: 8 }}>Nowy interfejs biura KEBABMES20 w wersji PRÓBNEJ. Dane z KOPII bazy produkcji — zmiany tutaj nie trafiają do prawdziwego MES. Znak z paczki grafika (Koncepcja 02, wektory robocze).</div>
        </div>
      </Dialog>}
    </div>
  )

  return (
    <AppCtx.Provider value={api}>
      <div className="scaled-note" role="note">Podgląd pomniejszony: PROTRIMA jest aplikacją na komputer z Windows (od 1366 × 768). Otwórz PROTRIMA na komputerze, aby pracować w pełnej skali.</div>
      <div className="stage-host" style={vp.scaled ? { height: vp.lh * vp.scale } : undefined}>{app}</div>
    </AppCtx.Provider>
  )
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Alt', 'Przejdź do menu (strzałki, Enter)'],
    ['Alt+P  Alt+E  Alt+W', 'Menu Plik, Edycja, Widok'],
    ['Ctrl+K', 'Szukaj zamówienia, klienta lub polecenia'],
    ['Ctrl+1 … 9', 'Przejdź do okna (karty)'],
    ['Ctrl+W', 'Zamknij okno (Pulpit zostaje)'],
    ['Ctrl+B', 'Zwiń / rozwiń nawigację'],
    ['Ctrl+N', 'Nowe zamówienie (w Przyjęciach — nowe przyjęcie)'],
    ['Ctrl+F', 'Szukaj na liście'],
    ['Ctrl+P', 'Drukuj'],
    ['↑ ↓  Home  End', 'Wybór wiersza na liście'],
    ['Spacja', 'Zaznacz / odznacz wiersz'],
    ['Ctrl+A', 'Zaznacz wszystkie widoczne'],
    ['Enter', 'Otwórz pozycję w osobnym oknie'],
    ['Alt+1 … 8', 'Zakładki panelu szczegółów'],
    ['F2', 'Edytuj'],
    ['F5', 'Odśwież'],
    ['Esc', 'Zamknij panel, menu lub okno dialogowe'],
  ]
  return (
    <Dialog title="Skróty klawiszowe" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Zamknij</button>}>
      <table className="tbl" style={{ fontSize: 'var(--fs-md)' }}>
        <tbody>{rows.map(([k, d]) => <tr key={k}><td style={{ width: 190 }}>{k.split('  ').map(p => <span key={p} className="kbd" style={{ marginRight: 4 }}>{p}</span>)}</td><td>{d}</td></tr>)}</tbody>
      </table>
      <div className="note info">W przeglądarce część skrótów (Ctrl+N, Ctrl+W, Alt+litera) przejmuje sama przeglądarka. W aplikacji desktopowej (Tauri) działają wszystkie.</div>
    </Dialog>
  )
}

declare const __PROTRIMA_VERSION__: string
