/**
 * Ręczne dodanie wyrobu gotowego z biura.
 *
 * Do czasu, aż produkcja i masownia dostaną komputery, wyrób wprowadza biuro.
 * Ten wpis ma robić DOKŁADNIE to, co zrobiłby kiosk: postawić sztuki na
 * magazynie, zdjąć tuleje, zdjąć mięso przyprawione i policzyć się do
 * pokrycia zamówienia. Inaczej stany rozjeżdżają się po tygodniu.
 *
 * Powiązanie z zamówieniem trzyma się na TRZECH polach naraz: `clientOrderNo`
 * + `recipeId` + `kgPerUnit` — tak liczy pokrycie `orders_service`. Dlatego
 * formularz wypełnia je z POZYCJI zamówienia, a nie z ręki.
 */
export interface ManualGoodsForm {
  qty: string
  kgPerUnit: string
  producedDate: string
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  clientId: string
  clientName: string
  clientOrderNo: string
  /** Wsad z masowni — z niego backend policzy numer partii wyrobu. */
  batchNos: string[]
  /** Zdjąć mięso przyprawione ze stanu masowni. */
  consumeSeasoned: boolean
}

/** „17,5" → 17.5. Biuro wpisuje przecinkiem. */
export const liczba = (v: string): number => {
  const n = Number(String(v ?? '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : 0
}

export function manualGoodsIssues(f: ManualGoodsForm): string[] {
  const bledy: string[] = []
  if (!f.recipeId) bledy.push('Wskaż recepturę — bez niej wyrób nie połączy się z zamówieniem')
  if (liczba(f.qty) <= 0) bledy.push('Podaj liczbę sztuk')
  if (liczba(f.kgPerUnit) <= 0) bledy.push('Podaj wagę jednej sztuki')
  if (!f.producedDate) bledy.push('Podaj datę produkcji — z niej powstaje numer partii')
  if (f.consumeSeasoned && !(f.batchNos ?? []).length) {
    bledy.push('Wskaż partię z masowni albo odznacz zdejmowanie mięsa')
  }
  return bledy
}

export function manualGoodsPayload(f: ManualGoodsForm) {
  return {
    qty: Math.round(liczba(f.qty)),
    kgPerUnit: liczba(f.kgPerUnit),
    producedDate: f.producedDate,
    recipeId: f.recipeId,
    recipeName: f.recipeName,
    productTypeId: f.productTypeId,
    productTypeName: f.productTypeName,
    packagingId: f.packagingId,
    packagingName: f.packagingName,
    clientId: f.clientId,
    clientName: f.clientName,
    clientOrderNo: f.clientOrderNo,
    seasonedBatchNos: f.batchNos ?? [],
    consumeSeasoned: !!f.consumeSeasoned,
  }
}

/** Ile sztuk zostało do zrobienia na pozycji zamówienia. */
export function remainingOnLine(line: { qty?: number; qtyDone?: number }): number {
  const zostalo = Number(line?.qty ?? 0) - Number(line?.qtyDone ?? 0)
  return zostalo > 0 ? Math.round(zostalo) : 0
}

// ── Wybór z zamówień ─────────────────────────────────────────────────────

export interface PickableLine {
  id: string
  orderId: string
  orderNo: string
  qty: number
  qtyDone: number
  kgPerUnit: number
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
}

export interface ClientGroup {
  clientId: string
  clientName: string
  /** Ile kilogramów zostało do zrobienia u tego klienta. */
  kgLeft: number
  lines: PickableLine[]
}

const OTWARTE = (status: string): boolean => status !== 'done' && status !== 'cancelled'

/**
 * Pozycje zamówień pogrupowane KLIENTAMI.
 *
 * Biuro wpisuje cały dzień produkcji naraz i myśli klientami („co dziś idzie
 * do Bulli"), a nie numerami zamówień. Płaska lista wszystkich pozycji
 * zmuszała do polowania wzrokiem.
 */
export function groupLinesByClient(orders: any[] | null | undefined): ClientGroup[] {
  const grupy = new Map<string, ClientGroup>()
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !OTWARTE(String(o.status || ''))) continue
    for (const l of o.lines ?? []) {
      if (!l?.id) continue
      const clientId = String(o.clientId || o.clientName || '—')
      let g = grupy.get(clientId)
      if (!g) {
        g = { clientId, clientName: String(o.clientName || '—'), kgLeft: 0, lines: [] }
        grupy.set(clientId, g)
      }
      const linia: PickableLine = {
        id: String(l.id), orderId: String(o.id || ''), orderNo: String(o.orderNo || ''),
        qty: Number(l.qty) || 0, qtyDone: Number(l.qtyDone) || 0,
        kgPerUnit: Number(l.kgPerUnit) || 0,
        recipeId: l.recipeId ?? '', recipeName: l.recipeName ?? '',
        productTypeId: l.productTypeId ?? '', productTypeName: l.productTypeName ?? '',
        packagingId: l.packagingId ?? '', packagingName: l.packagingName ?? '',
      }
      g.lines.push(linia)
      g.kgLeft = Math.round((g.kgLeft + remainingOnLine(linia) * linia.kgPerUnit) * 100) / 100
    }
  }
  return [...grupy.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, 'pl'))
}

/** Podsumowanie koszyka — to, co operator widzi przed kliknięciem zapisu. */
export function cartTotals(pozycje: { qty: number; kgPerUnit: number }[]): {
  pozycje: number; sztuki: number; kg: number
} {
  const sztuki = pozycje.reduce((s, p) => s + (Number(p.qty) || 0), 0)
  const kg = pozycje.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.kgPerUnit) || 0), 0)
  return { pozycje: pozycje.length, sztuki, kg: Math.round(kg * 100) / 100 }
}

// ── Numer partii wyrobu ──────────────────────────────────────────────────
//
// Backend składa go jako `ddmmrr <numer wsadu>` z DATY PRODUKCJI z formularza
// (nie z „dzisiaj"), więc wpis wczorajszej produkcji dostaje wczorajszą datę.
// Numer wpisany ręcznie leci na wyrób BEZ ZMIAN — dlatego biuro musi wpisać
// pełne „230826 456". Żeby nikt nie musiał tego pamiętać, sam numer
// porządkowy uzupełniamy datą, a okno pokazuje wynik na żywo.

/** '2026-08-23' → '230826'. */
export function ddmmrr(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim())
  return m ? `${m[3]}${m[2]}${m[1].slice(2)}` : ''
}

const MA_DATE = /^\d{6}\s+\S/

/** Goły numer („456", „PP13") dostaje z przodu datę produkcji. */
export function normalizeManualBatchNo(manual: string, producedDate: string): string {
  const wpis = String(manual || '').trim()
  if (!wpis || MA_DATE.test(wpis)) return wpis
  const data = ddmmrr(producedDate)
  return data ? `${data} ${wpis}` : wpis
}

/** Co dokładnie stanie na wyrobie — pokazywane pod polem partii. */
export function batchNoPreview(o: {
  mode: 'masownia' | 'recznie'
  batchNos: string[]
  manual: string
  producedDate: string
}): string {
  const data = ddmmrr(o.producedDate)
  if (o.mode === 'recznie') return normalizeManualBatchNo(o.manual, o.producedDate) || '—'
  if (!o.batchNos.length) return '—'
  if (o.batchNos.length === 1) return data ? `${data} ${o.batchNos[0]}` : o.batchNos[0]
  // Sztuki z kilku wsadów dostają partię mieszaną PM — numer z sekwencji
  // nadaje backend, więc uczciwie mówimy „nada system" zamiast zgadywać.
  return `${data} PM… (numer nada system)`
}
