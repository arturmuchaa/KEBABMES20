/**
 * DANE DEMONSTRACYJNE.
 * Klienci, osoby, pojazdy i numery są fikcyjne. Receptury, gramatury i typy
 * opakowań odpowiadają temu, co występuje w KEBABMES20, żeby układ był
 * oceniany na realistycznych ilościach. Nic tutaj nie pochodzi z bazy produkcyjnej.
 */
import {
  addDays, TODAY, type Client, type Line, type Order, type OrderDoc, type Pallet,
  type PalletStatus, type Shipment, type HistoryEntry, computeMetrics, lineMissing, num, pad2,
} from './model'

// ─── Generator deterministyczny (te same dane przy każdym uruchomieniu) ─────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261029)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))

// ─── Kontrahenci ───────────────────────────────────────────────────────────
const C = (id: string, name: string, country: string, city: string, nip: string, address: string, contact: string, phone: string, terms = 'Przelew 14 dni'): Client =>
  ({ id, name, country, city, nip, address, contact, phone, terms })

export const CLIENTS: Client[] = [
  C('c1', 'Anatolia Food GmbH', 'DE', 'Köln', 'DE 318 204 557', 'Industriestraße 41, 50735 Köln', 'Kerem Aydın', '+49 221 480 1123', 'Przelew 21 dni'),
  C('c2', 'Döner Partner Sp. z o.o.', 'PL', 'Kraków', 'PL 676 251 90 44', 'ul. Półłanki 18, 30-740 Kraków', 'Joanna Wrona', '+48 12 345 20 10'),
  C('c3', 'Gastro Line s.r.o.', 'SK', 'Bratislava', 'SK 2120 448 391', 'Galvaniho 7, 821 04 Bratislava', 'Peter Hudák', '+421 2 4820 3311', 'Przelew 30 dni'),
  C('c4', 'Istanbul Grill Kft.', 'HU', 'Budapest', 'HU 2671 0942', 'Gyömrői út 120, 1103 Budapest', 'Emre Kaya', '+36 1 260 4471', 'Przelew 21 dni'),
  C('c5', 'Bosporus Handel GmbH', 'AT', 'Wien', 'ATU 6612 0398', 'Laxenburger Str. 254, 1230 Wien', 'Selin Demir', '+43 1 615 2290', 'Przelew 21 dni'),
  C('c6', 'Kebab Express Sp.j.', 'PL', 'Warszawa', 'PL 521 389 74 12', 'ul. Annopol 4A, 03-236 Warszawa', 'Michał Kot', '+48 22 614 77 01'),
  C('c7', 'Mega Döner B.V.', 'NL', 'Rotterdam', 'NL 8621 4410 B01', 'Spaanse Polder 22, 3044 Rotterdam', 'Ahmet Yıldız', '+31 10 415 8820', 'Przelew 30 dni'),
  C('c8', 'Sultan Foods s.r.o.', 'CZ', 'Brno', 'CZ 0461 2287', 'Vídeňská 89, 619 00 Brno', 'Tomáš Novák', '+420 543 210 655'),
  C('c9', 'Grill Point Sp. z o.o.', 'PL', 'Katowice', 'PL 954 270 33 85', 'ul. Bocheńskiego 38, 40-859 Katowice', 'Agata Lis', '+48 32 205 41 19'),
  C('c10', 'Efes Gastro GmbH', 'DE', 'Berlin', 'DE 297 551 038', 'Siemensstraße 12, 10551 Berlin', 'Murat Öztürk', '+49 30 398 2214', 'Przelew 21 dni'),
  C('c11', 'Antalya Hurt Sp. z o.o.', 'PL', 'Łódź', 'PL 727 284 10 63', 'ul. Kolumny 160, 93-645 Łódź', 'Paweł Grad', '+48 42 683 22 07', 'Przedpłata'),
  C('c12', 'Kapadokya Food s.r.o.', 'CZ', 'Ostrava', 'CZ 2873 1190', 'Mariánskohorská 1, 702 00 Ostrava', 'Lenka Dvořák', '+420 596 125 300'),
]
const client = (id: string) => CLIENTS.find(c => c.id === id)!

// ─── Słowniki wyrobów ──────────────────────────────────────────────────────
const PRODUCTS = ['Kebab udo 100%', 'Kebab mix 95/5', 'Kebab drobiowo-wołowy 70/30']
const RECIPES = ['KIRMIZI', 'BEYAZ', 'WROCŁAW', 'GOLD', 'BERLIN', 'YAPRAK']
const WEIGHTS = [10, 15, 15, 20, 20, 25, 30, 40]
const packFor = (kgu: number) => kgu <= 10 ? 'Tuleja 30 cm' : kgu >= 30 ? 'Tuleja metal 80 cm' : 'Tuleja metal 65 cm'

let lineSeq = 0
const L = (product: string, recipe: string, kgPerUnit: number, qty: number, produced: number, stock: number, delivered = 0, planNo?: string, note?: string): Line => ({
  id: `l${++lineSeq}`, lp: 0, product, recipe, kgPerUnit, packaging: packFor(kgPerUnit), qty,
  planned: planNo ? qty : Math.min(qty, produced), planNo, produced, stock, delivered, note,
})
const numberLines = (ls: Line[]) => ls.map((l, i) => ({ ...l, lp: i + 1 }))

// ─── Palety ────────────────────────────────────────────────────────────────
let cartonSeq = 300
const carton = () => String(++cartonSeq).padStart(6, '0')

function batchFor(recipe: string, day: Date, n: number) {
  const d = `${String(day.getFullYear()).slice(2)}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`
  return `P-${d}-${String(n).padStart(2, '0')} · ${recipe}`
}

/** Rozpisuje pozycje na palety (~640 kg), wypełnia je tym, co wydano i co leży na magazynie. */
function autoPallets(lines: Line[], ship: boolean): Pallet[] {
  const cap = 640
  const out: Pallet[] = []
  let cur: Pallet | null = null
  let curKg = 0
  const open = () => {
    cur = { id: `pl${cartonSeq + 1}`, no: out.length + 1, carton: carton(), status: 'created', items: [], readyQty: 0, batches: [] }
    out.push(cur); curKg = 0
  }
  for (const l of lines) {
    let rem = l.qty
    while (rem > 0) {
      if (!cur) open()
      const fit = Math.floor((cap - curKg) / l.kgPerUnit)
      if (fit <= 0) { open(); continue }
      const take = Math.min(fit, rem)
      cur!.items.push({ lineId: l.id, qty: take })
      curKg += take * l.kgPerUnit; rem -= take
    }
  }
  const delLeft: Record<string, number> = Object.fromEntries(lines.map(l => [l.id, l.delivered]))
  const stkLeft: Record<string, number> = Object.fromEntries(lines.map(l => [l.id, l.stock]))
  for (const p of out) {
    let total = 0, del = 0, rdy = 0
    for (const it of p.items) {
      total += it.qty
      const d = Math.min(it.qty, delLeft[it.lineId]); delLeft[it.lineId] -= d; del += d
      const s = Math.min(it.qty - d, stkLeft[it.lineId]); stkLeft[it.lineId] -= s; rdy += d + s
    }
    p.readyQty = rdy
    let st: PalletStatus = 'created'
    if (del === total) st = 'shipped'
    else if (rdy === total) st = ship ? 'loaded' : (rnd() < 0.55 ? 'cold' : 'packed')
    else if (rdy > 0) st = 'packing'
    p.status = st
    if (st !== 'created') {
      const day = addDays(TODAY, -between(0, 2))
      const recipes = [...new Set(p.items.map(it => lines.find(l => l.id === it.lineId)!.recipe))]
      p.batches = recipes.map((r, i) => batchFor(r, day, between(1, 6) + i))
      p.packedAt = `${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')} ${between(7, 15)}:${String(between(0, 59)).padStart(2, '0')}`
      p.by = pick(['Skaner MG-01', 'Skaner MG-02', 'Tablet T-04'])
      if (st === 'cold' || st === 'loaded' || st === 'shipped') p.coldAt = p.packedAt
    }
  }
  return out
}

// ─── Dokumenty ─────────────────────────────────────────────────────────────
let wzSeq = 214
function docsFor(o: Order): OrderDoc[] {
  const m = computeMetrics(o)
  const foreign = o.client.country !== 'PL'
  const docs: OrderDoc[] = [
    { kind: 'ZAM', state: 'available', note: 'Potwierdzenie dla klienta' },
    { kind: 'KOMP', state: o.status === 'draft' ? 'blocked' : 'available', note: o.status === 'draft' ? 'Dostępna po potwierdzeniu zamówienia' : 'Wewnętrzna, z podziałem na palety' },
  ]
  if (o.pallets.length) {
    const printed = o.pallets.filter(p => p.status !== 'created').length
    docs.push({ kind: 'PAL', state: printed === o.pallets.length ? 'issued' : printed ? 'partial' : 'todo', note: `Wydrukowano ${printed} z ${o.pallets.length}` })
  } else {
    docs.push({ kind: 'PAL', state: o.status === 'draft' ? 'blocked' : 'todo', note: 'Najpierw rozpisz palety' })
  }
  if (m.deliveredKg > 0) {
    const full = m.deliveredKg >= m.orderedKg
    docs.push({ kind: 'WZ', state: full ? 'issued' : 'partial', number: `WZ/2026/10/${String(++wzSeq).padStart(4, '0')}`, date: o.delivery && o.delivery < TODAY ? `${String(o.delivery.getDate()).padStart(2, '0')}.10.2026` : '29.10.2026', by: 'Anna Nowak', note: full ? 'Całość zamówienia' : `Częściowa: ${Math.round(m.shipPct)}% ilości` })
  } else {
    docs.push({ kind: 'WZ', state: m.missingKg === 0 && o.status !== 'draft' ? 'todo' : 'blocked', note: m.missingKg === 0 ? 'Wyrób kompletny — można wystawić' : `Brakuje ${Math.round(m.missingKg)} kg wyrobu` })
  }
  if (foreign) {
    const wz = docs.find(d => d.kind === 'WZ')!
    docs.push(wz.number
      ? { kind: 'CMR', state: 'issued', number: `CMR ${wz.number.slice(-4)}/2026`, date: wz.date, by: 'Anna Nowak', note: `Kraj odbiorcy: ${o.client.country}` }
      : { kind: 'CMR', state: wz.state === 'todo' ? 'todo' : 'blocked', note: `Wymagany — kraj odbiorcy: ${o.client.country}` })
  } else {
    docs.push({ kind: 'CMR', state: 'not_required', note: 'Dostawa krajowa' })
  }
  if (o.status === 'done') docs.push({ kind: 'HDI', state: 'frozen', number: `HDI/2026/${String(wzSeq).padStart(4, '0')}`, note: 'Zamrożone po realizacji' })
  else if (o.status === 'draft') docs.push({ kind: 'HDI', state: 'blocked', note: 'Dostępne po potwierdzeniu' })
  else docs.push({ kind: 'HDI', state: 'available', note: m.prodPct < 100 ? 'Nie wszystko wyprodukowano — HDI zostanie wystawione na stan faktyczny' : 'Gotowe do wystawienia' })
  return docs
}

// ─── Zamówienia kluczowe (opisane ręcznie) ─────────────────────────────────
const H = (at: string, who: string, text: string, kind?: HistoryEntry['kind']): HistoryEntry => ({ at, who, text, kind })

function orderA(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 15, 40, 40, 34, 0, 'PP-2026-1028'),
    L('Kebab udo 100%', 'KIRMIZI', 20, 30, 22, 22, 0, 'PP-2026-1028'),
    L('Kebab mix 95/5', 'BEYAZ', 15, 24, 8, 8, 0, 'PP-2026-1029'),
    L('Kebab mix 95/5', 'BEYAZ', 30, 12, 0, 0, 0, 'PP-2026-1029', 'Tuleje 80 cm — klient prosi o folię zewnętrzną'),
    L('Kebab udo 100%', 'GOLD', 10, 20, 20, 20, 0, 'PP-2026-1028'),
  ])
  const [l1, l2, l3, l4, l5] = lines
  cartonSeq = 213
  const pallets: Pallet[] = [
    { id: 'pa1', no: 1, carton: carton(), status: 'cold', items: [{ lineId: l5.id, qty: 20 }, { lineId: l1.id, qty: 26 }], readyQty: 46, packedAt: '28.10 15:20', coldAt: '28.10 15:45', by: 'Skaner MG-02', batches: ['P-261028-02 · GOLD', 'P-261028-04 · KIRMIZI'] },
    { id: 'pa2', no: 2, carton: carton(), status: 'packed', items: [{ lineId: l1.id, qty: 8 }, { lineId: l2.id, qty: 22 }], readyQty: 30, packedAt: '29.10 09:55', by: 'Skaner MG-01', batches: ['P-261028-04 · KIRMIZI', 'P-261029-01 · KIRMIZI'] },
  ]
  carton() // 000216 — paleta nr 3 usunięta 28.10, numer zablokowany
  cartonSeq = 220
  pallets.push(
    { id: 'pa4', no: 4, carton: carton(), status: 'packing', items: [{ lineId: l2.id, qty: 8 }, { lineId: l3.id, qty: 16 }], readyQty: 8, packedAt: '29.10 10:12', by: 'Skaner MG-01', batches: ['P-261029-03 · BEYAZ'] },
    { id: 'pa5', no: 5, carton: carton(), status: 'created', items: [{ lineId: l3.id, qty: 8 }, { lineId: l1.id, qty: 6 }, { lineId: l4.id, qty: 12 }], readyQty: 0, batches: [] },
  )
  const o: Order = {
    id: 'o412', no: 'ZAM-2026-0412', client: client('c1'), orderDate: addDays(TODAY, -5), delivery: addDays(TODAY, 1), deliveryTime: '07:00',
    status: 'in_production', source: 'E-mail', createdBy: 'Anna Nowak',
    notes: 'Rozładunek tylko rampa 3, awizacja dzień wcześniej do 15:00. Etykiety w języku niemieckim.',
    lines, pallets, retiredPalletNos: [3], shipmentId: 's3',
    materialIssue: 'Mięso przyprawione BEYAZ: na poz. 3–4 potrzeba ok. 470 kg, w magazynie 610 kg dzielone z 3 zamówieniami.',
    history: [
      H('29.10 10:31', 'Tablet T-03 (produkcja)', 'Zgłoszono 6 szt. KIRMIZI 15 kg — czeka na przyjęcie na magazyn', 'prod'),
      H('29.10 10:12', 'Skaner MG-01', 'Rozpoczęto pakowanie palety 4 (8 z 24 szt.)', 'scan'),
      H('29.10 09:55', 'Skaner MG-01', 'Spakowano paletę 2 — karton 000215', 'scan'),
      H('28.10 15:45', 'Skaner MG-02', 'Paleta 1 przyjęta do mroźni', 'scan'),
      H('28.10 12:05', 'Anna Nowak', 'Usunięto paletę 3 (zmiana rozpisu). Numer 3 i karton 000216 zablokowane', 'edit'),
      H('28.10 11:47', 'Anna Nowak', 'Zmieniono ilość poz. 3: 30 → 24 szt. (telefon od klienta)', 'edit'),
      H('26.10 14:03', 'Tomasz Lis', 'Ujęto w planach PP-2026-1028 (poz. 1, 2, 5) i PP-2026-1029 (poz. 3, 4)', 'prod'),
      H('24.10 08:20', 'Anna Nowak', 'Potwierdzono zamówienie', 'edit'),
      H('24.10 08:12', 'Anna Nowak', 'Utworzono z wiadomości e-mail: 5 pozycji, 2 120 kg', 'create'),
    ],
    docs: [],
  }
  return o
}

function orderB(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 20, 48, 31, 21, 10, 'PP-2026-1027'),
    L('Kebab mix 95/5', 'WROCŁAW', 15, 32, 32, 0, 32, 'PP-2026-1026'),
  ])
  const [l1, l2] = lines
  cartonSeq = 187
  const pallets: Pallet[] = [
    { id: 'pb1', no: 1, carton: carton(), status: 'shipped', items: [{ lineId: l2.id, qty: 32 }, { lineId: l1.id, qty: 10 }], readyQty: 42, packedAt: '27.10 08:40', coldAt: '27.10 08:52', loadedAt: '27.10 13:05', by: 'Skaner MG-02', batches: ['P-261026-03 · WROCŁAW', 'P-261027-01 · KIRMIZI'] },
    { id: 'pb2', no: 2, carton: carton(), status: 'cold', items: [{ lineId: l1.id, qty: 21 }], readyQty: 21, packedAt: '28.10 14:10', coldAt: '28.10 14:30', by: 'Skaner MG-01', batches: ['P-261028-05 · KIRMIZI'] },
    { id: 'pb3', no: 3, carton: carton(), status: 'created', items: [{ lineId: l1.id, qty: 17 }], readyQty: 0, batches: [] },
  ]
  return {
    id: 'o398', no: 'ZAM-2026-0398', client: client('c3'), orderDate: addDays(TODAY, -9), delivery: addDays(TODAY, -1), deliveryTime: '12:00',
    status: 'in_production', source: 'Ręcznie', createdBy: 'Anna Nowak',
    notes: 'Druga dostawa uzgodniona na 30.10 rano — potwierdzone telefonicznie (P. Hudák).',
    lines, pallets, retiredPalletNos: [], shipmentId: 's4',
    history: [
      H('29.10 08:05', 'Anna Nowak', 'Dodano uwagę: druga dostawa 30.10 rano', 'edit'),
      H('28.10 14:30', 'Skaner MG-01', 'Paleta 2 przyjęta do mroźni', 'scan'),
      H('27.10 13:20', 'Anna Nowak', 'Wystawiono WZ/2026/10/0229 i CMR 0229/2026 (częściowo)', 'doc'),
      H('27.10 13:05', 'Skaner MG-02', 'Załadowano paletę 1 na pojazd BA 482XK', 'scan'),
      H('20.10 09:41', 'Anna Nowak', 'Utworzono i potwierdzono: 2 pozycje, 1 440 kg', 'create'),
    ],
    docs: [],
  }
}

function orderC(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 15, 60, 60, 60, 0, 'PP-2026-1027'),
    L('Kebab mix 95/5', 'WROCŁAW', 20, 40, 40, 40, 0, 'PP-2026-1028'),
    L('Kebab drobiowo-wołowy 70/30', 'BERLIN', 25, 16, 16, 16, 0, 'PP-2026-1028'),
  ])
  return {
    id: 'o415', no: 'ZAM-2026-0415', client: client('c2'), orderDate: addDays(TODAY, -4), delivery: addDays(TODAY, 1), deliveryTime: '09:00',
    status: 'in_production', source: 'Import CSV', createdBy: 'Anna Nowak', lines, pallets: [], retiredPalletNos: [], shipmentId: 's3',
    history: [
      H('28.10 16:20', 'Magazyn', 'Przyjęto na magazyn 16 szt. BERLIN 25 kg — pozycje kompletne', 'scan'),
      H('25.10 10:02', 'Anna Nowak', 'Zaimportowano z pliku CSV klienta: 3 pozycje, 2 100 kg', 'create'),
    ],
    docs: [],
  }
}

function orderF(): Order {
  const lines = numberLines([
    L('Kebab mix 95/5', 'BEYAZ', 20, 36, 12, 12, 0, 'PP-2026-1026'),
    L('Kebab mix 95/5', 'BEYAZ', 15, 20, 0, 0, 0, 'PP-2026-1029'),
    L('Kebab udo 100%', 'KIRMIZI', 15, 24, 24, 24, 0, 'PP-2026-1026'),
  ])
  cartonSeq = 194
  return {
    id: 'o409', no: 'ZAM-2026-0409', client: client('c5'), orderDate: addDays(TODAY, -8), delivery: addDays(TODAY, -2), deliveryTime: '10:00',
    status: 'in_production', source: 'E-mail', createdBy: 'Anna Nowak', lines,
    pallets: autoPallets(lines, false), retiredPalletNos: [], shipmentId: 's5',
    materialIssue: 'Mięso przyprawione BEYAZ: brakuje na poz. 1–2. Masowanie BEYAZ zaplanowane na 30.10, 06:00.',
    notes: 'Klient poinformowany o opóźnieniu 27.10. Prosi o dostawę kompletną, bez częściowych wysyłek.',
    history: [
      H('27.10 15:12', 'Anna Nowak', 'Poinformowano klienta o opóźnieniu (brak BEYAZ)', 'edit'),
      H('21.10 11:30', 'Anna Nowak', 'Utworzono i potwierdzono: 3 pozycje, 1 380 kg', 'create'),
    ],
    docs: [],
  }
}

function orderE(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 25, 24, 24, 24, 0, 'PP-2026-1027'),
    L('Kebab udo 100%', 'GOLD', 20, 30, 30, 30, 0, 'PP-2026-1027'),
    L('Kebab mix 95/5', 'YAPRAK', 15, 40, 40, 40, 0, 'PP-2026-1028'),
  ])
  cartonSeq = 202
  const pallets = autoPallets(lines, false)
  pallets.forEach((p, i) => { p.status = i < 2 ? 'loaded' : 'cold'; p.loadedAt = i < 2 ? `29.10 10:${18 + i * 7}` : undefined; if (!p.batches.length) p.batches = ['P-261028-01 · KIRMIZI'] })
  return {
    id: 'o405', no: 'ZAM-2026-0405', client: client('c4'), orderDate: addDays(TODAY, -7), delivery: TODAY, deliveryTime: '14:00',
    status: 'in_production', source: 'E-mail', createdBy: 'Anna Nowak', lines, pallets, retiredPalletNos: [], shipmentId: 's2',
    history: [
      H('29.10 10:25', 'Skaner MG-02', 'Załadunek w toku: palety 1–2 na pojeździe KR 7G214', 'scan'),
      H('22.10 12:40', 'Anna Nowak', 'Utworzono i potwierdzono: 3 pozycje, 1 800 kg', 'create'),
    ],
    docs: [],
  }
}

function orderD(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 15, 30, 30, 0, 30, 'PP-2026-1027'),
    L('Kebab mix 95/5', 'WROCŁAW', 20, 18, 18, 0, 18, 'PP-2026-1027'),
  ])
  cartonSeq = 180
  const pallets = autoPallets(lines, true)
  return {
    id: 'o401', no: 'ZAM-2026-0401', client: client('c6'), orderDate: addDays(TODAY, -8), delivery: TODAY, deliveryTime: '10:30',
    status: 'done', source: 'Ręcznie', createdBy: 'Anna Nowak', lines, pallets, retiredPalletNos: [], shipmentId: 's1',
    history: [
      H('29.10 10:34', 'Anna Nowak', 'Wydano całość — zamówienie zrealizowane', 'doc'),
      H('29.10 10:20', 'Skaner MG-02', 'Załadowano 2 palety na pojazd KR 3M901', 'scan'),
      H('21.10 09:10', 'Anna Nowak', 'Utworzono i potwierdzono: 2 pozycje, 810 kg', 'create'),
    ],
    docs: [],
  }
}

function orderToday2(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 10, 30, 30, 30, 0, 'PP-2026-1028'),
    L('Kebab drobiowo-wołowy 70/30', 'BERLIN', 20, 14, 14, 14, 0, 'PP-2026-1028'),
  ])
  cartonSeq = 230
  const pallets = autoPallets(lines, false)
  pallets.forEach(p => { p.status = 'packed' })
  return {
    id: 'o407', no: 'ZAM-2026-0407', client: client('c11'), orderDate: addDays(TODAY, -6), delivery: TODAY, deliveryTime: '14:00',
    status: 'in_production', source: 'Ręcznie', createdBy: 'Anna Nowak', lines, pallets, retiredPalletNos: [], shipmentId: 's2',
    history: [H('23.10 13:15', 'Anna Nowak', 'Utworzono i potwierdzono: 2 pozycje, 580 kg', 'create')],
    docs: [],
  }
}

function orderG(): Order {
  const lines = numberLines([
    L('Kebab udo 100%', 'KIRMIZI', 25, 48, 30, 30, 0, 'PP-2026-1029'),
    L('Kebab udo 100%', 'KIRMIZI', 40, 20, 0, 0, 0, 'PP-2026-1030'),
    L('Kebab mix 95/5', 'BEYAZ', 20, 40, 0, 0, 0, 'PP-2026-1030'),
    L('Kebab udo 100%', 'GOLD', 15, 40, 24, 24, 0, 'PP-2026-1029'),
    L('Kebab mix 95/5', 'WROCŁAW', 25, 32, 16, 16, 0, 'PP-2026-1029'),
    L('Kebab drobiowo-wołowy 70/30', 'BERLIN', 30, 12, 0, 0, 0),
  ])
  cartonSeq = 240
  return {
    id: 'o410', no: 'ZAM-2026-0410', client: client('c7'), orderDate: addDays(TODAY, -6), delivery: addDays(TODAY, 4), deliveryTime: '08:00',
    status: 'in_production', source: 'Import CSV', createdBy: 'Tomasz Lis', lines, pallets: autoPallets(lines, false), retiredPalletNos: [], shipmentId: 's5',
    notes: 'Transport klienta. Wymagany wydruk temperatury z rejestratora przy załadunku.',
    history: [
      H('27.10 09:30', 'Tomasz Lis', 'Ujęto w planach PP-2026-1029 i PP-2026-1030 (bez poz. 6)', 'prod'),
      H('23.10 16:44', 'Tomasz Lis', 'Zaimportowano z CSV: 6 pozycji, 4 680 kg', 'create'),
    ],
    docs: [],
  }
}

function drafts(): Order[] {
  return [
    {
      id: 'o421', no: 'ZAM-2026-0421', client: client('c8'), orderDate: addDays(TODAY, -3), status: 'draft', source: 'E-mail', createdBy: 'Anna Nowak',
      lines: numberLines([L('Kebab udo 100%', 'KIRMIZI', 15, 30, 0, 0), L('Kebab mix 95/5', 'YAPRAK', 20, 20, 0, 0)]),
      pallets: [], retiredPalletNos: [], notes: 'Czekamy na potwierdzenie terminu przez klienta.',
      history: [H('26.10 14:55', 'Anna Nowak', 'Utworzono szkic z wiadomości e-mail', 'create')], docs: [],
    },
    {
      id: 'o424', no: 'ZAM-2026-0424', client: client('c9'), orderDate: TODAY, delivery: addDays(TODAY, 6), status: 'draft', source: 'Ręcznie', createdBy: 'Anna Nowak',
      lines: numberLines([L('Kebab udo 100%', 'WROCŁAW', 20, 25, 0, 0), L('Kebab udo 100%', 'GOLD', 10, 40, 0, 0), L('Kebab mix 95/5', 'KIRMIZI', 15, 20, 0, 0)]),
      pallets: [], retiredPalletNos: [],
      history: [H('29.10 09:12', 'Anna Nowak', 'Utworzono szkic', 'create')], docs: [],
    },
  ]
}

// ─── Zamówienia generowane ─────────────────────────────────────────────────
function genOrder(id: string, no: string, offset: number, closed?: 'done' | 'cancelled'): Order {
  const cl = pick(CLIENTS)
  const n = between(1, 5)
  const ls: Line[] = []
  for (let i = 0; i < n; i++) {
    const kgu = pick(WEIGHTS)
    const qty = Math.max(6, Math.round(between(180, 900) / kgu))
    ls.push(L(pick(PRODUCTS), pick(RECIPES), kgu, qty, 0, 0))
  }
  let cov = 0
  if (closed === 'done') cov = 1
  else if (offset <= 3) cov = 0.55 + rnd() * 0.45
  else if (offset <= 7) cov = 0.1 + rnd() * 0.5
  else cov = rnd() < 0.5 ? 0 : rnd() * 0.25
  const pd = addDays(TODAY, Math.max(-20, offset - 3))
  const plan = `PP-2026-${pad2(pd.getMonth() + 1)}${pad2(pd.getDate())}`
  for (const l of ls) {
    const done = closed === 'cancelled' ? 0 : Math.min(l.qty, Math.round(l.qty * Math.min(1, cov * (0.7 + rnd() * 0.6))))
    l.produced = done
    if (closed === 'done') { l.delivered = l.qty; l.produced = l.qty }
    else l.stock = done
    if (!closed && rnd() < 0.12 && l.produced < l.qty) l.produced = Math.min(l.qty, l.produced + between(2, 6))
    if (cov > 0 || offset <= 9) { l.planNo = plan; l.planned = l.qty }
  }
  const lines = numberLines(ls)
  const delivery = addDays(TODAY, offset)
  const status = closed ?? (lines.some(l => l.produced > 0) ? 'in_production' : 'confirmed')
  const pallets = closed === 'cancelled' ? [] : (closed === 'done' || offset <= 6) ? autoPallets(lines, closed === 'done') : []
  const orderDate = addDays(delivery, -between(4, 10))
  const kgSum = lines.reduce((a, l) => a + l.qty * l.kgPerUnit, 0)
  return {
    id, no, client: cl, orderDate, delivery, deliveryTime: pick(['06:00', '07:00', '08:00', '10:00', '12:00', '14:00']),
    status, source: pick(['Ręcznie', 'E-mail', 'Import CSV']), createdBy: pick(['Anna Nowak', 'Anna Nowak', 'Tomasz Lis']),
    lines, pallets, retiredPalletNos: [],
    history: [
      ...(closed === 'done' ? [H(`${String(delivery.getDate()).padStart(2, '0')}.${String(delivery.getMonth() + 1).padStart(2, '0')} 11:20`, 'Anna Nowak', 'Wydano całość — zamówienie zrealizowane', 'doc' as const)] : []),
      ...(closed === 'cancelled' ? [H(`${String(orderDate.getDate() + 1).padStart(2, '0')}.${String(orderDate.getMonth() + 1).padStart(2, '0')} 09:40`, 'Anna Nowak', 'Anulowano na prośbę klienta', 'edit' as const)] : []),
      H(`${String(orderDate.getDate()).padStart(2, '0')}.${String(orderDate.getMonth() + 1).padStart(2, '0')} ${between(8, 15)}:${String(between(0, 59)).padStart(2, '0')}`, 'Anna Nowak', `Utworzono: ${lines.length} poz., ${num(kgSum)} kg`, 'create'),
    ],
    docs: [],
  }
}

function buildOrders(): Order[] {
  const key = [orderA(), orderB(), orderC(), orderD(), orderE(), orderF(), orderG(), orderToday2(), ...drafts()]
  const used = new Set(key.map(o => o.no))
  const free: string[] = []
  for (let i = 362; i <= 426 && free.length < 40; i++) {
    const no = `ZAM-2026-0${i}`
    if (!used.has(no)) free.push(no)
  }
  cartonSeq = 250
  const plan: Array<[number, ('done' | 'cancelled')?]> = [
    [2], [2], [3], [3], [3], [4], [5], [5], [6], [6], [7], [8], [9], [10], [11], [13], [14],
    [-4, 'done'], [-5, 'done'], [-6, 'done'], [-7, 'done'], [-9, 'done'], [-10, 'done'], [-12, 'done'], [-13, 'done'], [-15, 'done'], [-18, 'done'],
    [-6, 'cancelled'], [5, 'cancelled'],
  ]
  // Numery rosną z datą zamówienia — przydzielamy po posortowaniu.
  const gen = plan.map(([off, cl], i) => genOrder(`g${i}`, '', off, cl))
  gen.sort((a, b) => a.orderDate.getTime() - b.orderDate.getTime())
  gen.forEach((o, i) => { o.no = free[i] })
  const all = [...key, ...gen]
  // Zamówienia generowane wysyłane przez kursy:
  all.forEach(o => { o.docs = docsFor(o) })
  // ZAM-0398: częściowe wydanie było 27.10 — numery z historii zamówienia.
  const b = all.find(o => o.id === 'o398')!
  b.docs = b.docs.map(d => d.kind === 'WZ' ? { ...d, number: 'WZ/2026/10/0229', date: '27.10.2026' }
    : d.kind === 'CMR' ? { ...d, number: 'CMR 0229/2026', date: '27.10.2026' } : d)
  return all
}

export const ORDERS: Order[] = buildOrders()

// Uwaga do kursów: przypisanie zamówień generowanych z terminem pt/pn.
const soon = ORDERS.filter(o => o.id.startsWith('g') && o.status !== 'done' && o.status !== 'cancelled' && o.delivery && Math.round((o.delivery.getTime() - TODAY.getTime()) / 86_400_000) === 2)

export const SHIPMENTS: Shipment[] = [
  { id: 's1', no: 'K-2026-1029-01', date: TODAY, time: '10:30', vehicle: 'MAN TGL 12.250 chłodnia', plate: 'KR 3M901', driver: 'Marek Wójcik', carrier: 'Transport własny', status: 'departed', orderIds: ['o401'], printPending: true },
  { id: 's2', no: 'K-2026-1029-02', date: TODAY, time: '14:00', vehicle: 'Iveco Daily 70C chłodnia', plate: 'KR 7G214', driver: 'Paweł Zieliński', carrier: 'Transport własny', status: 'loading', orderIds: ['o405', 'o407'] },
  { id: 's3', no: 'K-2026-1030-01', date: addDays(TODAY, 1), time: '06:30', vehicle: 'MAN TGL 12.250 chłodnia', plate: 'KR 3M901', driver: 'Marek Wójcik', carrier: 'Transport własny', status: 'picking', orderIds: ['o412', 'o415'] },
  { id: 's4', no: 'K-2026-1030-02', date: addDays(TODAY, 1), time: '13:00', vehicle: 'Scania R450 chłodnia', plate: 'BA 482XK', driver: 'kierowca przewoźnika', carrier: 'EuroCool Logistics s.r.o.', status: 'planned', orderIds: ['o398'] },
  { id: 's5', no: 'K-2026-1031-01', date: addDays(TODAY, 2), time: '07:00', vehicle: 'Iveco Daily 70C chłodnia', plate: 'KR 7G214', driver: 'Paweł Zieliński', carrier: 'Transport własny', status: 'planned', orderIds: ['o409', ...soon.slice(0, 2).map(o => o.id)] },
]
SHIPMENTS[4].orderIds.forEach(id => { const o = ORDERS.find(x => x.id === id); if (o) o.shipmentId = 's5' })

// ─── Pulpit: dane spoza zamówień ───────────────────────────────────────────
export interface StageData {
  key: string
  name: string
  value: string
  unit?: string
  sub: string
  level: 'ok' | 'warn' | 'crit' | 'idle'
  note?: string
  progress?: number
}

export interface PlanRow { recipe: string; plannedKg: number; reportedKg: number; line: string }
export const PRODUCTION_TODAY: PlanRow[] = [
  { recipe: 'KIRMIZI', plannedKg: 4800, reportedKg: 4120, line: 'Linia 1' },
  { recipe: 'BEYAZ', plannedKg: 3200, reportedKg: 2410, line: 'Linia 2' },
  { recipe: 'WROCŁAW', plannedKg: 2000, reportedKg: 1980, line: 'Linia 1' },
  { recipe: 'GOLD', plannedKg: 1600, reportedKg: 1350, line: 'Linia 3' },
  { recipe: 'BERLIN', plannedKg: 800, reportedKg: 0, line: 'Linia 3' },
]

export interface MaterialRow { name: string; group: string; stock: number; reserved: number; need3d: number; unit: 'kg' | 'szt'; note?: string }
export const MATERIALS: MaterialRow[] = [
  { name: 'Mięso przyprawione BEYAZ', group: 'Półprodukt', stock: 610, reserved: 610, need3d: 2100, unit: 'kg', note: 'Masowanie 30.10, 06:00 — 1 200 kg' },
  { name: 'Udo bez kości', group: 'Po rozbiorze', stock: 4820, reserved: 2100, need3d: 9600, unit: 'kg' },
  { name: 'Przyprawa KIRMIZI MIX', group: 'Dodatek', stock: 85, reserved: 40, need3d: 120, unit: 'kg', note: 'Dostawa zamówiona na 31.10' },
  { name: 'Mięso przyprawione KIRMIZI', group: 'Półprodukt', stock: 2140, reserved: 1460, need3d: 2900, unit: 'kg' },
  { name: 'Tuleje metal 65 cm', group: 'Opakowanie', stock: 340, reserved: 180, need3d: 420, unit: 'szt' },
  { name: 'Ćwiartka z kurczaka', group: 'Surowiec', stock: 18420, reserved: 6200, need3d: 14900, unit: 'kg' },
]
export const FREE_FINISHED_KG = 3170

export interface Task { id: string; level: 'crit' | 'warn' | 'info'; title: string; detail: string; action: string; module: string }
export const TASKS: Task[] = [
  { id: 't1', level: 'warn', title: '2 sesje produkcyjne czekają na potwierdzenie', detail: 'Zmiana II z 28.10 (Linia 2) i zmiana I z dziś (Linia 1). Bez potwierdzenia raport dzienny jest niepełny.', action: 'Potwierdź sesje', module: 'realizacja' },
  { id: 't2', level: 'warn', title: 'Dostawa D-2026-1029-02 bez kontroli temperatury', detail: 'Ćwiartka z kurczaka, 4 210 kg (Drobex). Rejestr przyjęcia HACCP niekompletny.', action: 'Uzupełnij kontrolę', module: 'przyjecia' },
  { id: 't3', level: 'info', title: 'Kurs K-2026-1029-01 — dokumenty do wydruku', detail: 'Magazynier zakończył załadunek o 10:20. WZ wystawione, wydruk dla kierowcy nie został zrobiony.', action: 'Drukuj dokumenty', module: 'wysylki' },
]

export function getStages(): StageData[] {
  const open = ORDERS.filter(o => o.status !== 'done' && o.status !== 'cancelled')
  const allocated = open.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.stock * l.kgPerUnit, 0), 0)
  const plan = PRODUCTION_TODAY.reduce((a, r) => a + r.plannedKg, 0)
  const rep = PRODUCTION_TODAY.reduce((a, r) => a + r.reportedKg, 0)
  const todayShip = SHIPMENTS.filter(s => s.date.getTime() === TODAY.getTime())
  return [
    { key: 'przyjecia', name: 'Przyjęcie surowca', value: '8 420', unit: 'kg', sub: '2 dostawy · 1 bez kontroli HACCP', level: 'warn' },
    { key: 'rozbior', name: 'Rozbiór', value: '6 180', unit: 'kg', sub: 'z planu 7 500 kg · wydajność 71,4%', level: 'ok', progress: 6180 / 7500 },
    { key: 'masowanie', name: 'Masowanie', value: '3 920', unit: 'kg', sub: '4 zlecenia · BEYAZ: brak 1 490 kg na 3 dni', level: 'crit', progress: 3920 / 5100 },
    { key: 'realizacja', name: 'Produkcja', value: num(rep), unit: 'kg', sub: `z planu ${num(plan)} kg · 2 sesje do potwierdzenia`, level: 'warn', progress: rep / plan },
    { key: 'magazyn-wg', name: 'Magazyn wyrobu', value: num(allocated + FREE_FINISHED_KG), unit: 'kg', sub: `przydzielone ${num(allocated)} kg · wolne ${num(FREE_FINISHED_KG)} kg`, level: 'ok' },
    { key: 'wysylki', name: 'Wysyłka', value: String(todayShip.length), unit: todayShip.length === 1 ? 'kurs' : 'kursy', sub: '1 wyjechał · 1 w załadunku · 1 do wydruku', level: 'ok' },
  ]
}

/** Ilość brakująca po pozycjach — używana w panelu „Pokrycie". */
export const missingOf = lineMissing

/** Wolny wyrób gotowy (nieprzydzielony do żadnego zamówienia) — podpowiedzi w zakładce Pokrycie. */
export interface FreeStock { recipe: string; kgPerUnit: number; qty: number; cartons: string[]; batch: string }
export const FREE_STOCK: FreeStock[] = [
  { recipe: 'BEYAZ', kgPerUnit: 15, qty: 6, cartons: ['000188', '000193'], batch: 'P-261027-06' },
  { recipe: 'KIRMIZI', kgPerUnit: 20, qty: 9, cartons: ['000176'], batch: 'P-261028-05' },
  { recipe: 'WROCŁAW', kgPerUnit: 25, qty: 8, cartons: ['000171'], batch: 'P-261026-02' },
  { recipe: 'GOLD', kgPerUnit: 15, qty: 12, cartons: ['000182', '000183'], batch: 'P-261028-02' },
]
