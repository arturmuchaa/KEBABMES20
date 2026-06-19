/**
 * Gotowe wzory etykiet do edytora Zebra (Z-Design-1). Odwzorowują typową etykietę
 * spożywczą KEBAB (jak na wydruku klienta) jako natywne elementy z polami dynamicznymi
 * [[WAGA]]/[[PARTIA]]/[[DATA_PROD]]/[[BEST_BEFORE]]/[[QR]]. Użytkownik wczytuje wzór
 * jednym kliknięciem i tylko go poprawia — wynik to wektorowy ZPL (dane podstawialne).
 * Współrzędne i wymiary w mm (canvas 100×150).
 */
import type { ZebraElement } from '@/lib/api'

let _seq = 0
function el(e: Omit<ZebraElement, 'id'>): ZebraElement {
  _seq += 1
  return { id: `wz${_seq}`, ...e }
}

const NUTRITION: Array<[string, string]> = [
  ['Wartość energetyczna / Valeur énergétique', '145kcal/607kJ'],
  ['Tłuszcz / Graisses', '6,8g'],
  ['- w tym kwasy nasycone / dont saturés', '2,08g'],
  ['Węglowodany / Glucides', '1,25g'],
  ['- w tym cukry / dont sucres', '0,09g'],
  ['Błonnik / Fibres', '0,69g'],
  ['Białko / Protéines', '16,5g'],
  ['Sól / Sel', '0,67g'],
]

/** Etykieta spożywcza KEBAB 100×150 mm (wzór startowy — do edycji). */
export function kebabFoodLabelPreset(): ZebraElement[] {
  _seq = 0
  const out: ZebraElement[] = []
  const M = 5          // margines mm
  const W = 100 - 2 * M

  // Nagłówek
  out.push(el({ type: 'text', x: M, y: 5, w: 65, fontMm: 7, align: 'L', value: 'GOLD KEBAB' }))
  out.push(el({ type: 'box', x: 80, y: 4, w: 15, h: 11, thickMm: 0.4 }))
  out.push(el({ type: 'text', x: 80, y: 7, w: 15, fontMm: 3, align: 'C', value: 'HALAL' }))
  out.push(el({ type: 'text', x: M, y: 14, w: 70, fontMm: 2.6, align: 'L',
    value: 'Produit cru surgelé à base de poulet, formé à partir de morceaux de viande – à cuire' }))

  // Składniki / alergeny / przechowywanie
  out.push(el({ type: 'text', x: M, y: 23, w: W, fontMm: 2.4, align: 'L',
    value: 'Ingrédients: Viande de poulet 82%, eau, protéines de soja, amidon de pomme de terre, stabilisant: E451, amidon de pois natif, dextrose, sel de table, épices (moutarde), extraits d’épices, arôme (céleri), extrait de paprika.' }))
  out.push(el({ type: 'text', x: M, y: 38, w: W, fontMm: 2.4, align: 'L',
    value: 'Allergènes: contient du soja, de la moutarde, du céleri. Peut contenir des traces de: gluten de blé, œufs, protéines de lait, dioxyde de soufre.' }))
  out.push(el({ type: 'text', x: M, y: 48, w: W, fontMm: 2.3, align: 'L',
    value: '- Produit surgelé. Sortir du congélateur 1,5 h avant la cuisson. Ne pas recongeler. À consommer uniquement après cuisson. À consommer dans les 12 mois suivant la date de production.' }))

  // Tabela wartości odżywczych
  const tY = 62, rowH = 4.5, rows = NUTRITION.length
  const tH = rowH * rows
  const colX = 66
  out.push(el({ type: 'text', x: M, y: tY - 4, w: W, fontMm: 2.5, align: 'L',
    value: 'Valeurs nutritionnelles pour 100 g de produit cuit:' }))
  out.push(el({ type: 'box', x: M, y: tY, w: W, h: tH, thickMm: 0.3 }))          // ramka
  out.push(el({ type: 'box', x: colX, y: tY, w: 0.3, h: tH, thickMm: 0.3 }))     // pionowy podział
  NUTRITION.forEach(([label, val], i) => {
    const ry = tY + i * rowH
    if (i > 0) out.push(el({ type: 'box', x: M, y: ry, w: W, h: 0.3, thickMm: 0.3 })) // linia wiersza
    out.push(el({ type: 'text', x: M + 1, y: ry + 0.6, w: colX - M - 2, fontMm: 2.2, align: 'L', value: label }))
    out.push(el({ type: 'text', x: colX + 1, y: ry + 0.6, w: 100 - colX - M - 1, fontMm: 2.2, align: 'L', value: val }))
  })

  // Waga + dane partii
  out.push(el({ type: 'text', x: M, y: tY + tH + 3, w: 60, fontMm: 6, align: 'L', value: 'POIDS [[WAGA]]KG' }))
  out.push(el({ type: 'text', x: M, y: tY + tH + 11, w: 60, fontMm: 3, align: 'L', value: 'N° de lot: [[PARTIA]]' }))
  out.push(el({ type: 'text', x: M, y: tY + tH + 15.5, w: 60, fontMm: 3, align: 'L', value: 'Date de production: [[DATA_PROD]]' }))
  out.push(el({ type: 'text', x: M, y: tY + tH + 20, w: 60, fontMm: 3, align: 'L', value: 'À consommer jusqu’au: [[BEST_BEFORE]]' }))

  // Znak weterynaryjny + QR
  out.push(el({ type: 'box', x: 66, y: tY + tH + 10, w: 29, h: 11, thickMm: 0.4 }))
  out.push(el({ type: 'text', x: 66, y: tY + tH + 12.5, w: 29, fontMm: 2.6, align: 'C', value: 'PL 12060602 WE' }))
  out.push(el({ type: 'qr', x: 80, y: 17, mag: 3, value: '[[QR]]' }))

  // Producent
  out.push(el({ type: 'text', x: M, y: tY + tH + 25, w: W, fontMm: 2.2, align: 'L',
    value: 'Wyprodukowano: FHUP Marek Księżyc, Dunajewskiego 83, 32-064 Rudawa' }))

  return out
}

export const LABEL_PRESETS: Array<{ key: string; name: string; build: () => ZebraElement[] }> = [
  { key: 'kebab-food', name: 'Etykieta spożywcza KEBAB (wzór)', build: kebabFoodLabelPreset },
]
