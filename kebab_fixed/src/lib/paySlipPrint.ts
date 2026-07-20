/**
 * paySlipPrint.ts — czysta logika i HTML wydruku pasków wypłat
 * (src/pages/office/PayrollPage.tsx). Kartka A4 POZIOMO, 4 paski w siatce
 * 2×2 — każdy pasek 148,5×105 mm, czyli szeroki: dane pracownika u góry,
 * dni pracy po lewej, rozliczenie po prawej. Wydzielone, żeby dało się to
 * testować bez renderowania React i bez okna wydruku.
 */

export const SLIPS_PER_PAGE = 4

/** Powyżej tylu dni pracy lista dni łamie się na dwie kolumny. */
const DAYS_SPLIT_THRESHOLD = 8

export const ROLE_LABEL: Record<string, string> = {
  WORKER_DEBONING: 'Rozbiór', WORKER_PRODUCTION: 'Produkcja', WORKER_GENERAL: 'Ogólny',
}

export interface SettlementRange {
  date_from: string
  date_to: string
}

/** Okres rozliczenia zahacza o zakres [from, to] (brzegi włącznie).
 * Pusty koniec zakresu = brak ograniczenia z tej strony. */
export function settlementOverlapsRange(s: SettlementRange, from: string, to: string): boolean {
  if (to && s.date_from > to) return false
  if (from && s.date_to < from) return false
  return true
}

/** Podział na strony po 4, ostatnia dopełniona `null` (puste komórki 2×2).
 * Pusta lista → jedna pusta strona (tak drukował dotychczasowy kod). */
export function chunkIntoPages<T>(items: T[]): (T | null)[][] {
  const pages: (T | null)[][] = []
  for (let i = 0; i < Math.max(1, items.length); i += SLIPS_PER_PAGE) {
    const chunk: (T | null)[] = items.slice(i, i + SLIPS_PER_PAGE)
    while (chunk.length < SLIPS_PER_PAGE) chunk.push(null)
    pages.push(chunk)
  }
  return pages
}

/** Liczba kartek A4 dla n pasków (min 1) — licznik w stopce dialogu. */
export function pageCount(n: number): number {
  return Math.max(1, Math.ceil(n / SLIPS_PER_PAGE))
}

// ─── Formatowanie ─────────────────────────────────────────────

/** Nazwiska i opisy potrąceń trafiają wprost do HTML — muszą być escapowane. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function num(v: unknown): string {
  return Number(v ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('pl-PL', opts)
}

export function kgLabel(role: string): string {
  if (role?.includes('DEBONING')) return 'Pobrana ćwiartka'
  if (role?.includes('PRODUCTION')) return 'Wyprodukowane'
  return 'Przepracowane kg'
}

// ─── Pojedynczy pasek (komórka siatki 2×2, 148,5×105 mm) ──────

function paySlipHtml(s: any | null): string {
  if (!s) {
    return `<div class="cell empty"><div class="empty-mark">— miejsce na kolejny pasek —</div></div>`
  }
  const role = s.worker_role ?? ''
  const label = kgLabel(role)
  const days: any[] = s.work_dates_detail ?? []
  const deducts: any[] = s.deductions ?? []

  // Stawka ukryta na pasku, ale używamy jej do policzenia zarobku per dzień.
  // Powyżej 8 dni (np. rozliczenie 2-tygodniowe) lista nie mieści się na
  // wysokość komórki — szeroki pasek pozwala rozbić ją na dwie kolumny.
  // W dwóch kolumnach brakuje miejsca na nazwę dnia tygodnia — sama data.
  const split = days.length > DAYS_SPLIT_THRESHOLD
  const dateFmt: Intl.DateTimeFormatOptions = split
    ? { day: '2-digit', month: '2-digit' }
    : { weekday: 'short', day: '2-digit', month: '2-digit' }

  // Przy dwóch kolumnach dni kolumna „Zarobek" nie zmieściłaby się czytelnie
  // — dla długich okresów zostają data i kg, kwoty są w podsumowaniu.
  const dayRow = (d: any) => split
    ? `<tr><td class="nw">${esc(fmtDate(d.work_date, dateFmt))}</td><td class="r">${num(d.kg)}</td></tr>`
    : `<tr>
      <td class="nw">${esc(fmtDate(d.work_date, dateFmt))}</td>
      <td class="r">${num(d.kg)}</td>
      <td class="r nw">${num(Number(d.kg) * Number(s.rate_per_kg))} zł</td>
    </tr>`
  const daysHead = split
    ? `<tr><th>Dzień</th><th class="r">kg</th></tr>`
    : `<tr><th>Dzień</th><th class="r">kg</th><th class="r">Zarobek</th></tr>`
  const daysTable = (rows: any[]) => `<table class="days">
      <thead>${daysHead}</thead>
      <tbody>${rows.map(dayRow).join('')}</tbody>
    </table>`

  const half = Math.ceil(days.length / 2)
  const daysBlock = days.length === 0
    ? `<div class="no-days">Rozliczenie zbiorcze za okres</div>`
    : split
      ? `<div class="days-wrap split">${daysTable(days.slice(0, half))}${daysTable(days.slice(half))}</div>`
      : `<div class="days-wrap">${daysTable(days)}</div>`

  const deductRows = deducts.map(d => `<tr>
      <td class="lbl">${esc(d.description)}</td>
      <td class="r minus">− ${num(d.amount)} zł</td>
    </tr>`).join('')

  return `<div class="cell">
    <div class="head">
      <div>
        <div class="kicker">Pasek wypłaty</div>
        <div class="name">${esc(s.worker_name)}</div>
        <div class="role">${esc(ROLE_LABEL[role] ?? role)}</div>
      </div>
      <div class="period">
        <div class="period-lbl">Okres rozliczenia</div>
        <div class="period-val">${esc(fmtDate(s.date_from, { day: 'numeric', month: 'short' }))} – ${esc(fmtDate(s.date_to, { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
      </div>
    </div>

    <div class="body${split ? ' wide-days' : ''}">
      <div class="col-days">${daysBlock}</div>
      <div class="col-sum">
        <table class="sum">
          <tr><td class="lbl">${esc(label)}</td><td class="r bold">${num(s.kg_total)} kg</td></tr>
          <tr><td class="lbl">Wynagrodzenie</td><td class="r bold">${num(s.gross_amount)} zł</td></tr>
          ${deductRows}
        </table>
        <div class="net">
          <span class="net-lbl">Do wypłaty</span>
          <span class="net-val">${num(s.net_amount)} zł</span>
        </div>
      </div>
    </div>

    <div class="sigs">
      <div class="sig">Podpis pracodawcy</div>
      <div class="sig">Podpis pracownika</div>
    </div>
  </div>`
}

// ─── Dokument: N pasków → kartki A4 poziomo, po 4 (2×2) ───────

export function buildPaySlipsDocument(items: any[]): string {
  const sheets = chunkIntoPages(items)
    .map(p => `<div class="sheet">${p.map(paySlipHtml).join('')}</div>`)
    .join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Paski wypłaty</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#171717;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}

  /* A4 poziomo = 297×210 mm; 2×2 → każdy pasek 148,5×105 mm (szeroki) */
  .sheet{width:297mm;height:210mm;display:grid;
    grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;page-break-after:always}
  .sheet:last-child{page-break-after:auto}
  .cell{border:1px dashed #999;padding:7mm 8mm;display:flex;flex-direction:column;overflow:hidden;font-size:12px;line-height:1.35}
  .cell.empty{align-items:center;justify-content:center;color:#bbb;font-size:10px;font-style:italic}
  .empty-mark{transform:rotate(-12deg);opacity:.5}

  /* Nagłówek: kto i za jaki okres */
  .head{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid #171717;padding-bottom:2.5mm;margin-bottom:3.5mm}
  .kicker{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-bottom:.8mm}
  .name{font-size:19px;font-weight:900;line-height:1.1}
  .role{font-size:11px;color:#555;margin-top:.6mm}
  .period{text-align:right}
  .period-lbl{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#666}
  .period-val{font-size:12.5px;font-weight:700;margin-top:.8mm;white-space:nowrap}

  /* Środek: dni pracy | rozliczenie */
  .body{flex:1;display:grid;grid-template-columns:1.15fr 1fr;gap:7mm;min-height:0}
  .body.wide-days{grid-template-columns:1.3fr 1fr;gap:6mm}
  .col-days{min-width:0;overflow:hidden}
  .col-sum{display:flex;flex-direction:column;justify-content:flex-start}
  .days-wrap{display:grid;grid-template-columns:1fr;gap:4mm}
  .days-wrap.split{grid-template-columns:1fr 1fr}

  table{width:100%;border-collapse:collapse}
  td,th{padding:1.5mm 0;vertical-align:baseline}
  td+td,th+th{padding-left:3mm}   /* kolumny nie mogą się sklejać */
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .nw{white-space:nowrap}
  .lbl{color:#555}
  .bold{font-weight:700}
  /* Bez czerwieni — na drukarce mono wychodzi bladym szarym */
  .minus{font-weight:700;white-space:nowrap}

  .days th{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#666;
    text-align:left;border-bottom:1px solid #bbb;padding-bottom:1.2mm}
  .days th.r{text-align:right}
  .days td{font-size:12px;border-bottom:1px solid #e8e8e8}
  .days.split td,.days-wrap.split .days td{font-size:11px}
  .no-days{font-size:11px;color:#888;font-style:italic;padding-top:2mm}

  .sum td{font-size:12.5px;border-bottom:1px solid #e8e8e8}

  /* Kwota do wypłaty — najważniejsza liczba na pasku */
  .net{margin-top:4mm;border:2.5px solid #171717;padding:3mm 3.5mm;
    display:flex;justify-content:space-between;align-items:baseline;gap:3mm}
  .net-lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;white-space:nowrap}
  .net-val{font-size:21px;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}

  .sigs{display:grid;grid-template-columns:1fr 1fr;gap:10mm;margin-top:auto;padding-top:7mm}
  .sig{border-top:1px solid #333;padding-top:1.2mm;font-size:9px;color:#666;text-align:center}
</style></head><body>
${sheets}
<script>window.onload=function(){window.print()}</script>
</body></html>`
}
