// Układ druku CMR: pozycje pól (% strony A4), wspólne dla druku i konfiguratora.
// Konfigurator zapisuje nadpisania do bazy (cmr_layout); druk scala je z DEFAULTS.

export interface FieldPos {
  x: number
  y: number
  size: number
  font?: string      // klucz z CMR_FONTS (brak = 'condensed')
  bold?: boolean
  italic?: boolean
  hidden?: boolean   // pole predefiniowane ukryte — nie drukuje się
  custom?: boolean   // pole własne dodane w konfiguratorze
  text?: string      // treść pola własnego
  label?: string     // etykieta pola własnego (na liście)
}
export type CmrPositions = Record<string, FieldPos>

// ─── Czcionki dostępne w konfiguratorze ───────────────────────────────────────
// Tylko rodziny pewne na wydruku (Roboto Condensed ładowane z woff2; reszta to
// generyczne rodziny renderowane też przez headless Chromium przy generacji PDF).
export interface CmrFont { key: string; label: string; css: string }
export const CMR_FONTS: CmrFont[] = [
  { key: 'condensed', label: 'Roboto Condensed', css: "'Roboto Condensed', Arial, sans-serif" },
  { key: 'sans',      label: 'Bezszeryfowa',     css: 'Arial, Helvetica, sans-serif' },
  { key: 'serif',     label: 'Szeryfowa',        css: '"Times New Roman", Times, serif' },
  { key: 'mono',      label: 'Maszynowa',        css: '"Courier New", Courier, monospace' },
]
export function fontCss(key?: string): string {
  return (CMR_FONTS.find(f => f.key === key) || CMR_FONTS[0]).css
}

// Domyślne pozycje (wyciągnięte z wzoru). Konfigurator pozwala je nadpisać.
export const CMR_DEFAULTS: CmrPositions = {
  cmrNo:            { x: 79.3, y: 8.7,  size: 15 },
  sender:           { x: 8.4,  y: 8.7,  size: 11.5 },
  senderNip:        { x: 35.4, y: 12.7, size: 11 },
  consignee:        { x: 8.4,  y: 18.6, size: 11.5 },
  consigneeNip:     { x: 36.4, y: 22.6, size: 11 },
  delivery:         { x: 8.4,  y: 28.5, size: 11.5 },
  loadPlace:        { x: 8.4,  y: 38.4, size: 11 },
  loadDate:         { x: 42.1, y: 38.4, size: 11 },
  attHdi:           { x: 8.4,  y: 42.0, size: 11 },
  attInvoice:       { x: 8.4,  y: 43.2, size: 11 },
  goodsNum:         { x: 6.8,  y: 48.3, size: 11 },
  goodsQty:         { x: 22,   y: 48.3, size: 11 },
  goodsName:        { x: 47.7, y: 48.3, size: 11 },
  goodsKg:          { x: 77.6, y: 48.3, size: 11 },
  goodsGross:       { x: 77.6, y: 57.0, size: 11 },
  instructions:     { x: 9.3,  y: 65.8, size: 11 },
  franco:           { x: 31,   y: 77.4, size: 11 },
  carrier:          { x: 53.7, y: 18.6, size: 11.5 },
  carrierNip:       { x: 78,   y: 23.4, size: 11 },
  carrierVat:       { x: 78,   y: 24.5, size: 11 },
  carrierPlate:     { x: 53.7, y: 26.0, size: 11 },
  establishedPlace: { x: 15.6, y: 83.1, size: 11 },
  establishedDate:  { x: 32.7, y: 83.1, size: 11 },
}

// Odstęp linii w blokach adresowych (% wysokości A4) i wysokość wiersza towaru.
export const CMR_LINE_GAP = 1.3
export const CMR_GOODS_ROWH = 2.7

// Metadane pól do konfiguratora: etykieta + przykładowa wartość (podgląd na tle).
export interface FieldMeta { key: string; label: string; sample: string; block?: boolean }
export const CMR_FIELDS: FieldMeta[] = [
  { key: 'cmrNo',            label: 'Numer CMR',              sample: '1' },
  { key: 'sender',           label: '1 Nadawca',             sample: 'FHUP MAREK KSIĘŻYC', block: true },
  { key: 'senderNip',        label: '1 NIP nadawcy',         sample: '5130064478' },
  { key: 'consignee',        label: '2 Odbiorca',            sample: 'POLAT D.O.O.', block: true },
  { key: 'consigneeNip',     label: '2 NIP odbiorcy',        sample: 'SI54806852' },
  { key: 'delivery',         label: '3 Miejsce przeznacz.',  sample: 'POLAT D.O.O.', block: true },
  { key: 'loadPlace',        label: '4 Miejsce załadunku',   sample: 'RUDAWA, POLAND' },
  { key: 'loadDate',         label: '4 Data załadunku',      sample: '05.06.2026' },
  { key: 'attHdi',           label: '5 Załącznik HDI',       sample: 'HDI 1/06/26' },
  { key: 'attInvoice',       label: '5 Nr faktury',          sample: 'FV 11/06/2026' },
  { key: 'goodsNum',         label: '6 Lp. towaru',          sample: '1.' },
  { key: 'goodsQty',         label: '7 Ilość szt.',          sample: '10' },
  { key: 'goodsName',        label: '9 Nazwa towaru',        sample: 'KEBAB MROŻONY' },
  { key: 'goodsKg',          label: '11 Waga poz.',          sample: '200' },
  { key: 'goodsGross',       label: '11 Waga razem',         sample: '206' },
  { key: 'instructions',     label: '13 Instrukcje',         sample: 'TRANSPORT MROŻNICZY -22' },
  { key: 'franco',           label: '14 Franco',             sample: 'FRANCO RUDAWA' },
  { key: 'carrier',          label: '16 Przewoźnik',         sample: 'FTH DAMIAN UCHNAST', block: true },
  { key: 'carrierNip',       label: '16 NIP przewoźnika',    sample: 'WP84860T' },
  { key: 'carrierVat',       label: '16 VAT przewoźnika',    sample: 'SI77745083' },
  { key: 'carrierPlate',     label: '16 Nr rej.',            sample: 'NR REJ.: SK226WM' },
  { key: 'establishedPlace', label: '21 Wystawiono w',       sample: 'RUDAWA' },
  { key: 'establishedDate',  label: '21 Data wystawienia',   sample: '05.06.2026' },
]

// Scal zapisaną konfigurację z domyślną (pełny zestaw pól predefiniowanych zawsze
// obecny) oraz zachowaj pola własne (klucze spoza DEFAULTS, np. custom_*).
export function mergeCmrPositions(saved: CmrPositions | null | undefined): CmrPositions {
  const out: CmrPositions = {}
  for (const k of Object.keys(CMR_DEFAULTS)) {
    out[k] = { ...CMR_DEFAULTS[k], ...(saved?.[k] || {}) }
  }
  if (saved) {
    for (const k of Object.keys(saved)) {
      if (!(k in CMR_DEFAULTS)) out[k] = saved[k]   // pola własne
    }
  }
  return out
}

// Klucze pól własnych (dodanych w konfiguratorze) z układu.
export function customFieldKeys(positions: CmrPositions): string[] {
  return Object.keys(positions).filter(k => positions[k]?.custom)
}

// Nowy unikalny klucz pola własnego.
export function newCustomKey(): string {
  return `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`
}
