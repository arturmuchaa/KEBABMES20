import React from 'react'
import { AlertTriangle, Bold, Trash2 } from 'lucide-react'
import type { LabelDesign, LabelField, LabelFieldKind } from '@/lib/api'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { MIN_QR_MM, RODZAJE_POL, nowePole, polePlotna, poZaEtykieta } from './model'
import { tekstPola } from './Plotno'

export type Zakladka = 'pole' | 'przypisanie' | 'druk'

const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2, useGrouping: false }).format(n)
const liczba = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0 }
const KOLEJNOSC: LabelFieldKind[] = ['weight', 'batch', 'prod_date', 'freeze_date', 'best_before', 'qr', 'org_code', 'unit_no', 'client', 'recipe', 'product_type', 'static_text', 'box']

function Liczba({ label, value, onChange, krok = 0.5 }: { label: string; value: number; onChange: (v: number) => void; krok?: number }) {
  const id = `et-${label.replace(/\W+/g, '-')}`
  return (
    <label className="et-l" htmlFor={id}><span>{label}</span>
      <input id={id} className="field num" inputMode="decimal" value={fmt(value)} aria-label={label}
        onChange={e => onChange(liczba(e.target.value))} onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.round((value + (e.key === 'ArrowUp' ? krok : -krok)) * 100) / 100) } }} /></label>
  )
}

/** Prawa kolumna: właściwości pola, przypisanie szablonu i ustawienia druku. */
export function PanelPola({ projekt, pole, slot, zakladka, onZakladka, klienci, rodzaje, receptury, onProjekt, onPole, onUsunPole, onDodane }: {
  projekt: LabelDesign; pole: LabelField | null; slot: 0 | 1; zakladka: Zakladka; onZakladka: (z: Zakladka) => void
  klienci: WyborItem[]; rodzaje: WyborItem[]; receptury: WyborItem[]
  onProjekt: (zm: Partial<LabelDesign>) => void; onPole: (zm: Partial<LabelField>) => void; onUsunPole: () => void
  onDodane: (f: LabelField) => void
}) {
  const naPlotnie = pole ? polePlotna(projekt, pole, slot) : null
  const zebra = projekt.printMode === 'zebra'
  const poza = naPlotnie ? poZaEtykieta(projekt, naPlotnie, tekstPola(pole!)) : false
  return (
    <aside className="et-panel">
      <div className="dock-tabs" role="tablist">
        {(['pole', 'przypisanie', 'druk'] as Zakladka[]).map(z => (
          <button key={z} role="tab" className="dock-tab" aria-selected={zakladka === z} onClick={() => onZakladka(z)}>
            {z === 'pole' ? 'Pola' : z === 'przypisanie' ? 'Przypisanie' : 'Druk'}</button>
        ))}
      </div>
      <div className="et-panel-b" role="tabpanel">
        {zakladka === 'pole' && <>
          <div className="et-dodaj" aria-label="Dodaj pole">
            <div className="et-h">Dodaj pole</div>
            <div className="et-dodaj-g">
              {KOLEJNOSC.map(k => (
                <button key={k} type="button" className="btn sm" aria-label={`Dodaj pole: ${RODZAJE_POL[k].nazwa}`} onClick={() => onDodane(nowePole(k, projekt))}>
                  {RODZAJE_POL[k].nazwa}</button>
              ))}
            </div>
          </div>
          {!pole && <p className="muted">Kliknij pole na etykiecie, żeby zmienić jego położenie i wygląd. Pole przeciągasz myszą albo strzałkami (Shift — 5 mm).</p>}
          {pole && naPlotnie && <section className="et-wl" role="region" aria-label="Właściwości pola">
            <div className="et-h">{RODZAJE_POL[pole.kind].nazwa}{slot ? ' — etykieta 2' : ''}
              {slot === 0 && <button className="btn ghost icon sm danger" aria-label="Usuń pole" onClick={onUsunPole}><Trash2 size={14} /></button>}</div>
            {poza && <div className="note warn"><AlertTriangle size={15} /><div>Pole wychodzi poza etykietę — na wydruku zostanie pominięte albo ucięte.</div></div>}
            {pole.kind === 'qr' && (pole.qrMm ?? 25) < MIN_QR_MM && <div className="note warn"><AlertTriangle size={15} /><div>Kod QR mniejszy niż {MIN_QR_MM} mm może się nie zeskanować na hali.</div></div>}
            {slot === 1 && <p className="muted">Na drugiej etykiecie arkusza zmienia się tylko położenie tego pola.</p>}
            <div className="et-2">
              <Liczba label="X (mm)" value={naPlotnie.xMm} onChange={v => onPole({ xMm: v })} />
              <Liczba label="Y (mm)" value={naPlotnie.yMm} onChange={v => onPole({ yMm: v })} />
            </div>
            {slot === 0 && pole.kind === 'qr' && <Liczba label="Rozmiar QR (mm)" value={pole.qrMm ?? 25} krok={1} onChange={v => onPole({ qrMm: Math.max(5, v) })} />}
            {slot === 0 && pole.kind === 'box' && <>
              <div className="et-2">
                <Liczba label="Szerokość (mm)" value={pole.wMm ?? 30} onChange={v => onPole({ wMm: Math.max(1, v) })} />
                <Liczba label="Wysokość (mm)" value={pole.hMm ?? 8} onChange={v => onPole({ hMm: Math.max(1, v) })} />
              </div>
              <div className="seg" role="group" aria-label="Wypełnienie">
                <button type="button" aria-pressed={pole.fill === 'white'} onClick={() => onPole({ fill: 'white' })}>Biała zakrywka</button>
                <button type="button" aria-pressed={pole.fill !== 'white'} onClick={() => onPole({ fill: 'none' })}>Ramka</button>
              </div>
            </>}
            {slot === 0 && pole.kind !== 'qr' && pole.kind !== 'box' && <>
              {pole.kind === 'static_text' && <label className="et-l" htmlFor="et-tekst"><span>Tekst</span>
                <input id="et-tekst" className="field" value={pole.text ?? ''} onChange={e => onPole({ text: e.target.value })} /></label>}
              <div className="et-2">
                <Liczba label="Rozmiar (pt)" value={pole.sizePt ?? 10} krok={1} onChange={v => onPole({ sizePt: Math.max(4, v) })} />
                <label className="et-l"><span>Czcionka</span>
                  <select className="field" value={pole.font ?? 'arial'} onChange={e => onPole({ font: e.target.value as LabelField['font'] })} aria-label="Czcionka">
                    <option value="arial">Arial</option><option value="times">Times</option><option value="courier">Courier</option>
                  </select></label>
              </div>
              <div className="et-rzad">
                <button type="button" className={`btn sm${pole.bold ? ' on' : ''}`} aria-pressed={!!pole.bold} onClick={() => onPole({ bold: !pole.bold })}><Bold size={14} />Pogrubienie</button>
                <div className="seg" role="group" aria-label="Wyrównanie">
                  {(['L', 'C', 'R'] as const).map(a => <button key={a} type="button" aria-pressed={(pole.align ?? 'L') === a} onClick={() => onPole({ align: a })}>{a === 'L' ? 'Lewo' : a === 'C' ? 'Środek' : 'Prawo'}</button>)}
                </div>
              </div>
              {(pole.align === 'C' || pole.align === 'R') && <Liczba label="Szerokość pola (mm)" value={pole.wMm ?? 40} onChange={v => onPole({ wMm: Math.max(5, v) })} />}
              {zebra && <div className="seg" role="group" aria-label="Obrót">
                {([0, 90, 180, 270] as const).map(o => <button key={o} type="button" aria-label={`Obrót ${o}°`} aria-pressed={(pole.rotation ?? 0) === o} onClick={() => onPole({ rotation: o })}>{o}°</button>)}
              </div>}
            </>}
            <p className="muted et-przyklad">Przykład: <b>{tekstPola(pole) || '—'}</b></p>
          </section>}
          {projekt.fields.length > 0 && <div className="et-spis">
            <div className="et-h">Pola na etykiecie ({projekt.fields.length})</div>
            {projekt.fields.map(f => <span key={f.id} className="tag outline">{RODZAJE_POL[f.kind].nazwa}</span>)}
          </div>}
        </>}

        {zakladka === 'przypisanie' && <div className="et-form">
          <label className="et-l" htmlFor="et-nazwa"><span>Nazwa szablonu</span>
            <input id="et-nazwa" className="field" value={projekt.name} placeholder="np. YALCIN · kebab 100 × 150" onChange={e => onProjekt({ name: e.target.value })} /></label>
          <div className="et-l"><span>Klient</span>
            <Wybor id="et-klient" label="Klient" items={klienci} value={projekt.clientId} onChange={v => onProjekt({ clientId: v })} placeholder="Wybierz klienta…" invalid={!projekt.clientId} /></div>
          <div className="et-l"><span>Rodzaj</span>
            <Wybor id="et-rodzaj" label="Rodzaj" items={rodzaje} value={projekt.productTypeId} noneLabel="każdy rodzaj" onChange={v => onProjekt({ productTypeId: v })} /></div>
          <div className="et-l"><span>Receptura</span>
            <Wybor id="et-receptura" label="Receptura" items={receptury} value={projekt.recipeId} noneLabel="każda receptura" onChange={v => onProjekt({ recipeId: v })} /></div>
          <p className="muted">Przy druku z planu pozycja bierze najdokładniej pasujący szablon klienta: klient + rodzaj + receptura, potem klient + receptura, klient + rodzaj, na końcu sam klient.</p>
        </div>}

        {zakladka === 'druk' && <div className="et-form">
          <p><span className="tag neutral">{zebra ? `Zebra ${Math.round(projekt.widthMm)} × ${Math.round(projekt.heightMm)} mm` : 'A4 — zwykła drukarka przez okno druku'}</span></p>
          {!zebra && <>
            <div className="seg" role="group" aria-label="Etykiet na arkuszu">
              <button type="button" aria-pressed={projekt.labelsPerSheet === 1} onClick={() => onProjekt({ labelsPerSheet: 1 })}>1 na arkuszu</button>
              <button type="button" aria-pressed={projekt.labelsPerSheet === 2} onClick={() => onProjekt({ labelsPerSheet: 2 })}>2 na arkuszu</button>
            </div>
            {projekt.labelsPerSheet === 2 && <div className="et-2">
              <Liczba label="Druga etykieta X (mm)" value={projekt.slotOffset.dxMm} onChange={v => onProjekt({ slotOffset: { ...projekt.slotOffset, dxMm: v } })} />
              <Liczba label="Druga etykieta Y (mm)" value={projekt.slotOffset.dyMm} onChange={v => onProjekt({ slotOffset: { ...projekt.slotOffset, dyMm: v } })} />
            </div>}
            <div className="et-h">Kalibracja wydruku</div>
            <p className="muted">Gdy drukarka ucina brzeg albo przesuwa wydruk — przesuń lub zmniejsz całą stronę (tło i pola razem).</p>
            <div className="et-3">
              <Liczba label="Przesunięcie X (mm)" value={projekt.calibration.dxMm} krok={0.1} onChange={v => onProjekt({ calibration: { ...projekt.calibration, dxMm: v } })} />
              <Liczba label="Przesunięcie Y (mm)" value={projekt.calibration.dyMm} krok={0.1} onChange={v => onProjekt({ calibration: { ...projekt.calibration, dyMm: v } })} />
              <Liczba label="Skala (%)" value={projekt.calibration.scale} krok={0.5} onChange={v => onProjekt({ calibration: { ...projekt.calibration, scale: Math.min(110, Math.max(80, v)) } })} />
            </div>
          </>}
          {zebra && <p className="muted">Tło z pliku {projekt.sourceName || 'PRN/PDF'}. Rolkę zmieniasz, zakładając szablon od nowa z innym rozmiarem.</p>}
        </div>}
      </div>
    </aside>
  )
}
