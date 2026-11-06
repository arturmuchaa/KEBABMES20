/**
 * Etapy i następny krok zamówienia — jedno źródło dla szyny w panelu zamówienia,
 * mini-szyny na liście i kolejki „Do zrobienia” na Pulpicie.
 * Tylko z danych, które już są w przeglądarce (computeMetrics, etapZamowienia) —
 * bez zmian reguł serwera.
 */
import type { DetailTab } from '../shell/context'
import { etapZamowienia, fmtDate, isClosed, kg, kursCzeka, num, pct, type Metrics, type Order } from './model'

export type Poziom = 'ok' | 'warn' | 'crit' | 'idle'
export interface EtapSzyny { key: DetailTab; name: string; value: string; sub: string; level: Poziom }

const pokrycieTxt = (v: number) => `${v >= 99.95 ? 100 : Math.max(0, Math.min(99, Math.floor(v)))}%`

/** Siedem etapów zamówienia w kolejności zakładu: Przyjęte → … → Wydano. */
export function etapyZamowienia(o: Order, m: Metrics): EtapSzyny[] {
  const due = m.dueDays ?? 99
  const draft = o.status === 'draft'
  const planned = o.lines.filter(l => l.planNo).length
  const plans = [...new Set(o.lines.map(l => l.planNo).filter(Boolean))]
  // Cały wyrób już jest (magazyn lub wydany) — plan i produkcja nie są potrzebne; bez fałszywego bursztynu.
  const zMagazynu = !draft && m.missingKg === 0 && o.lines.length > 0
  return [
    { key: 'history', name: 'Przyjęte', value: fmtDate(o.orderDate).slice(0, 5), sub: draft ? 'szkic — do potwierdzenia' : 'potwierdzone', level: draft ? 'warn' : 'ok' },
    zMagazynu && planned < o.lines.length
      ? { key: 'production', name: 'Zaplanowane', value: 'nie trzeba', sub: 'cały wyrób z magazynu', level: 'ok' }
      : { key: 'production', name: 'Zaplanowane', value: `${planned}/${o.lines.length} poz.`, sub: plans.length ? plans.join(', ') : 'brak planu', level: draft ? 'idle' : planned === o.lines.length ? 'ok' : due <= 3 ? 'warn' : 'idle' },
    zMagazynu && m.prodPct < 100
      ? { key: 'production', name: 'Produkcja', value: 'nie trzeba', sub: 'cały wyrób z magazynu', level: 'ok' }
      : { key: 'production', name: 'Produkcja', value: pct(m.prodPct), sub: `zgłoszono ${kg(m.producedKg)}`, level: draft ? 'idle' : m.prodPct >= 100 ? 'ok' : due <= 1 ? 'warn' : m.prodPct > 0 ? 'ok' : 'idle' },
    { key: 'coverage', name: 'Pokrycie', value: pokrycieTxt(m.coverPct), sub: m.missingKg > 0 ? `brak ${kg(m.missingKg)}` : 'komplet wyrobu', level: draft ? 'idle' : m.missingKg === 0 ? 'ok' : due <= 0 ? 'crit' : due === 1 ? 'warn' : 'idle' },
    { key: 'pallets', name: 'Palety', value: m.palletsTotal ? `${m.palletsReady}/${m.palletsTotal}` : '—', sub: m.palletsTotal ? (m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : 'gotowe z rozpisanych') : 'nierozpisane', level: draft ? 'idle' : m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : (m.unassignedQty > 0 && due <= 1) ? 'warn' : m.palletsTotal ? 'ok' : 'idle' },
    { key: 'shipping', name: 'Załadunek', value: m.palletsTotal ? `${m.palletsLoaded}/${m.palletsTotal}` : '—', sub: m.palletsLoaded ? 'palet na aucie (skan QR)' : 'nic nie załadowano', level: m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'idle' },
    { key: 'documents', name: 'Wydano', value: pct(m.shipPct), sub: m.deliveredKg > 0 ? `na WZ ${kg(m.deliveredKg)}` : 'WZ nie wystawione', level: m.shipPct >= 100 ? 'ok' : 'idle' },
  ]
}

export type KodKroku = 'potwierdz' | 'palety' | 'papiery' | 'w-zaladunku' | 'czeka-zaladunek' | 'czeka-wyrob' | 'brak-wyrobu' | 'zrealizowane' | 'anulowane'
export interface Krok {
  kod: KodKroku
  /** Słowo na liście i na Pulpicie — zawsze to samo dla tego samego kroku. */
  tekst: string
  /** Biuro może to zrobić od razu w PROTRIMA (czasownik) — w przeciwnym razie to czekanie na halę/auto. */
  akcja: boolean
  /** Zakładka panelu zamówienia, w której się to robi albo widać. */
  tab: DetailTab
  /** Wyjazd dziś/jutro albo po terminie — krok jest pilny. */
  pilne: boolean
  dopisek?: string
}

/**
 * Jeden następny krok zamówienia. Kolejność: potwierdzenie → auto (załadunek, papiery) →
 * palety (gdy wyrób jest albo auto zaraz jedzie) → wyrób → czekanie na załadunek.
 */
export function nastepnyKrok(o: Order, m: Metrics): Krok {
  const pilne = !isClosed(o) && m.dueDays !== null && m.dueDays <= 1
  if (o.status === 'cancelled') return { kod: 'anulowane', tekst: 'Anulowane', akcja: false, tab: 'history', pilne: false }
  if (o.status === 'done') return { kod: 'zrealizowane', tekst: 'Zrealizowane', akcja: false, tab: 'documents', pilne: false }
  if (o.status === 'draft') return { kod: 'potwierdz', tekst: 'Potwierdź', akcja: true, tab: 'overview', pilne, dopisek: 'szkic nie trafia do planowania' }
  const e = etapZamowienia(o, m)
  if (e.etap === 'zaladunek') return { kod: 'w-zaladunku', tekst: 'W załadunku', akcja: false, tab: 'shipping', pilne: false, dopisek: e.szczegol }
  if (kursCzeka(o, e.etap)) return { kod: 'papiery', tekst: 'Papiery kursu', akcja: true, tab: 'shipping', pilne, dopisek: e.szczegol }
  if (m.unassignedQty > 0 && (m.missingKg <= 0 || pilne)) return { kod: 'palety', tekst: 'Rozpisz palety', akcja: true, tab: 'pallets', pilne, dopisek: `${num(m.unassignedQty)} szt. bez palety` }
  if (m.missingKg > 0) return pilne
    ? { kod: 'brak-wyrobu', tekst: 'Brakuje wyrobu', akcja: false, tab: 'coverage', pilne, dopisek: kg(m.missingKg) }
    : { kod: 'czeka-wyrob', tekst: 'Czeka na wyrób', akcja: false, tab: 'coverage', pilne, dopisek: kg(m.missingKg) }
  return { kod: 'czeka-zaladunek', tekst: 'Czeka na załadunek', akcja: false, tab: 'shipping', pilne, dopisek: m.palletsTotal ? `${m.palletsReady}/${m.palletsTotal} palet gotowe` : undefined }
}
