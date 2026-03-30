import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Package, Beef, ClipboardList, BookOpen,
  Layers, Users, UserCog, FlaskConical, ShoppingBag,
  BarChart2, CreditCard, Scissors, Monitor, Truck, Building2,
  FileText, X, Factory, ShoppingCart, Archive, AlertTriangle,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: React.ReactNode }
interface NavSection { heading: string; items: NavItem[] }

const NAV: NavSection[] = [
  { heading:'Kontrahenci', items:[
    { to:'/office/dostawcy',    label:'Dostawcy',    icon:<Truck size={13}/> },
    { to:'/office/kontrahenci', label:'Kontrahenci', icon:<Building2 size={13}/> },
    { to:'/office/zamowienia',  label:'Zamówienia',   icon:<ShoppingCart size={13}/> },
  ]},
  { heading:'Zakupy', items:[
    { to:'/office/faktury', label:'Faktury zakupowe', icon:<CreditCard size={13}/> },
  ]},
  { heading:'Magazyny', items:[
    { to:'/office/raw-batches',          label:'Przyjęcie ćwiartki',  icon:<Package size={13}/> },
    { to:'/office/magazyn/surowiec',     label:'Surowiec',            icon:<Beef size={13}/> },
    { to:'/office/magazyn/przyprawy',    label:'Przyprawy i dodatki', icon:<FlaskConical size={13}/> },
    { to:'/office/magazyn/mieso-przyp',  label:'Mięso przyprawione',  icon:<Beef size={13}/> },
    { to:'/office/magazyn/opakowania',  label:'Opakowania/Tuleje',   icon:<Archive size={13}/> },
    { to:'/office/magazyn/gotowe',       label:'Wyrób gotowy',        icon:<ShoppingBag size={13}/> },
  ]},
  { heading:'Rozbiór', items:[
    { to:'/office/deboning',     label:'Raporty rozbioru', icon:<BarChart2 size={13}/> },
    { to:'/office/haccp-report', label:'Raport HACCP',     icon:<FileText size={13}/> },
  ]},
  { heading:'Produkcja', items:[
    { to:'/office/rodzaje-produktow',    label:'Rodzaje produktów',  icon:<Package size={13}/> },
    { to:'/office/receptury',            label:'Receptury',          icon:<BookOpen size={13}/> },
    { to:'/office/planowanie-masowania', label:'Plan. masowania',    icon:<Layers size={13}/> },
    { to:'/office/planowanie-produkcji', label:'Plan. produkcji',    icon:<Factory size={13}/> },
  ]},
  { heading:'Jakość i Wycofanie', items:[
    { to:'/office/recall', label:'Wycofanie (Recall)', icon:<AlertTriangle size={13}/> },
  ]},
  { heading:'Administracja', items:[
    { to:'/office/pracownicy',  label:'Pracownicy',  icon:<Users size={13}/> },
    { to:'/office/uzytkownicy', label:'Użytkownicy', icon:<UserCog size={13}/> },
  ]},
]

const TABLET_LINKS = [
  { to:'/tablet/rozbior',   label:'Tablet — Rozbiór',  icon:<Scissors size={12}/> },
  { to:'/tablet/mieszanie', label:'Tablet — Masownia', icon:<Layers size={12}/> },
  { to:'/tablet/produkcja', label:'Tablet — Produkcja',icon:<Monitor size={12}/> },
]

export function OfficeSidebar({ onClose }: { onClose?: () => void }) {
  const { pathname } = useLocation()
  return (
    <aside className="w-52 h-full flex flex-col bg-sidebar-bg border-r border-sidebar-border overflow-y-auto">
      <div className="h-11 px-4 flex items-center justify-between border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-brand rounded flex items-center justify-center flex-shrink-0"><LayoutDashboard size={11} className="text-white"/></div>
          <span className="text-sm font-semibold text-white">Kebab <span className="text-blue-400">MES</span></span>
        </div>
        {onClose && <button onClick={onClose} className="md:hidden p-1 text-sidebar-heading hover:text-ink"><X size={16}/></button>}
      </div>
      <div className="px-2 pt-2">
        <NavLink to="/office/dashboard" className={({isActive})=>cn('flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] font-medium transition-colors',isActive?'bg-sidebar-active text-blue-400 font-semibold':'text-sidebar-text hover:bg-sidebar-active hover:text-white')}>
          <LayoutDashboard size={13} className="flex-shrink-0 text-sidebar-heading"/> Dashboard
        </NavLink>
      </div>
      <nav className="flex-1 px-2 pt-1">
        {NAV.map(section=>(
          <div key={section.heading} className="mt-4 first:mt-2">
            <div className="px-2.5 mb-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-heading">{section.heading}</span></div>
            <ul className="space-y-0.5">
              {section.items.map(item=>(
                <li key={item.to}>
                  <NavLink to={item.to} className={({isActive})=>cn('flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] transition-colors',isActive?'bg-sidebar-active text-blue-400 font-semibold':'text-sidebar-text hover:bg-sidebar-active hover:text-white font-medium')}>
                    <span className={cn('flex-shrink-0',pathname===item.to?'text-blue-400':'text-sidebar-heading')}>{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-2 py-3 border-t border-sidebar-border">
        <div className="px-2.5 mb-1"><span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-heading">Hala</span></div>
        {TABLET_LINKS.map(item=>(
          <a key={item.to} href={item.to} className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px] font-medium text-sidebar-heading hover:text-brand hover:bg-sidebar-active transition-colors">
            {item.icon}{item.label}
          </a>
        ))}
      </div>
    </aside>
  )
}
