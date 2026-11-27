import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import type { LabelDesign, LabelField } from '@/lib/api'
import { KROK_MM, PRZYKLAD, RODZAJE_POL, polePlotna, poZaEtykieta, prostokat, rozmiarStrony, wartosciPol } from './model'

const PT_MM = 25.4 / 72
const PRZYKLADOWE = wartosciPol(PRZYKLAD, { razem: 29, orgCode: 'HAL-0000' })
const snap = (mm: number) => Math.round(mm / KROK_MM) * KROK_MM
const RODZINA: Record<string, string> = { arial: 'Arial, "Liberation Sans", sans-serif', times: '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' }

export function tekstPola(f: LabelField): string {
  return f.kind === 'static_text' ? (f.text ?? '') : PRZYKLADOWE[f.kind]
}

/**
 * Etykieta w skali: tło (PNG z importu) rozciągnięte na stronę jak przy druku,
 * linijki w mm, pola przeciągane myszą z przyciąganiem do 0,5 mm. Na arkuszu
 * A4 z dwiema etykietami pola drugiej są półprzezroczyste; przesunięcie pola
 * na drugiej zapisuje się tylko dla niej (nierówny arkusz).
 */
export function Plotno({ projekt, sel, onSel, onZmien, onPrzeciaganie }: {
  projekt: LabelDesign
  sel: { id: string; slot: 0 | 1 } | null
  onSel: (s: { id: string; slot: 0 | 1 } | null) => void
  onZmien: (id: string, slot: 0 | 1, zm: Partial<LabelField>) => void
  onPrzeciaganie: (v: boolean) => void
}) {
  const strona = rozmiarStrony(projekt)
  const ramka = useRef<HTMLDivElement>(null)
  const [dopasowanie, setDopasowanie] = useState(3)
  const [zoom, setZoom] = useState<number | null>(null)
  const px = zoom ?? dopasowanie

  // Dopasuj do okna: cała strona widoczna.
  useLayoutEffect(() => {
    const el = ramka.current
    if (!el) return
    const licz = () => {
      const w = el.clientWidth - 48, h = el.clientHeight - 48
      if (w > 0 && h > 0) setDopasowanie(Math.max(1, Math.min(w / strona.w, h / strona.h)))
    }
    licz()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(licz) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [strona.w, strona.h])
  useEffect(() => { setZoom(null) }, [projekt.id, projekt.printMode])

  const ciagnij = (e: React.PointerEvent, f: LabelField, slot: 0 | 1) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    onSel({ id: f.id, slot })
    const start = { x: e.clientX, y: e.clientY, fx: f.xMm, fy: f.yMm }
    const p = prostokat(f, tekstPola(f))
    let ruszyl = false
    const ruch = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / px, dy = (ev.clientY - start.y) / px
      if (!ruszyl && Math.abs(dx) + Math.abs(dy) < 0.4) return
      if (!ruszyl) { ruszyl = true; onPrzeciaganie(true) }
      onZmien(f.id, slot, {
        xMm: Math.min(strona.w - Math.min(p.w, strona.w), Math.max(0, snap(start.fx + dx))),
        yMm: Math.min(strona.h - Math.min(p.h, strona.h), Math.max(0, snap(start.fy + dy))),
      })
    }
    const koniec = () => {
      window.removeEventListener('pointermove', ruch); window.removeEventListener('pointerup', koniec)
      if (ruszyl) onPrzeciaganie(false)
    }
    window.addEventListener('pointermove', ruch); window.addEventListener('pointerup', koniec)
  }

  const naArkusz = projekt.printMode === 'a4' && projekt.labelsPerSheet === 2 ? 2 : 1
  const pola = [0, 1].slice(0, naArkusz).flatMap(slot => projekt.fields.map(f => ({ f: polePlotna(projekt, f, slot as 0 | 1), baza: f, slot: slot as 0 | 1 })))

  const podzialki = (dl: number) => Array.from({ length: Math.floor(dl / 10) + 1 }, (_, i) => i * 10)

  return (
    <div className="et-plotno-ramka">
      <div className="et-zoom" role="group" aria-label="Powiększenie">
        <button className="btn icon sm ghost" aria-label="Pomniejsz" onClick={() => setZoom(Math.max(0.5, px / 1.25))}><Minus size={15} /></button>
        <span className="tnum">{Math.round((px / 3.78) * 100)}%</span>
        <button className="btn icon sm ghost" aria-label="Powiększ" onClick={() => setZoom(Math.min(16, px * 1.25))}><Plus size={15} /></button>
        <button className="btn sm ghost" onClick={() => setZoom(null)} aria-label="Dopasuj do okna"><Maximize size={14} />Dopasuj</button>
        <span className="muted">{strona.w} × {strona.h} mm{projekt.printMode === 'zebra' ? ` · ${projekt.dpi || 203} dpi` : naArkusz === 2 ? ' · 2 etykiety na arkusz' : ''}</span>
      </div>
      <div className="et-plotno" ref={ramka} onPointerDown={() => onSel(null)}>
        <div className="et-strona-w" style={{ width: strona.w * px + 24, height: strona.h * px + 24 }}>
          <div className="et-linijka x" style={{ width: strona.w * px }} aria-hidden="true">
            {podzialki(strona.w).map(mm => <span key={mm} style={{ left: mm * px }}>{mm % 50 === 0 ? mm : ''}</span>)}
          </div>
          <div className="et-linijka y" style={{ height: strona.h * px }} aria-hidden="true">
            {podzialki(strona.h).map(mm => <span key={mm} style={{ top: mm * px }}>{mm % 50 === 0 ? mm : ''}</span>)}
          </div>
          <div className={`et-strona${projekt.printMode === 'zebra' ? ' zebra' : ''}`} style={{ width: strona.w * px, height: strona.h * px }}>
            {projekt.backgroundPng && <img src={projekt.backgroundPng} alt={`Tło etykiety ${projekt.name || ''}`.trim()} draggable={false} />}
            {naArkusz === 2 && <div className="et-podzial" style={{ left: (projekt.slotOffset?.dxMm ?? 105) * px }} aria-hidden="true" />}
            {pola.map(({ f, baza, slot }) => {
              const tekst = tekstPola(baza)
              const r = prostokat(f, tekst)
              const zaznaczone = sel?.id === f.id && sel.slot === slot
              const poza = poZaEtykieta(projekt, f, tekst)
              const nazwa = RODZAJE_POL[f.kind].nazwa
              const obrot = f.rotation ?? 0
              return (
                <button key={`${slot}-${f.id}`} type="button"
                  className={`et-pole k-${f.kind}${zaznaczone ? ' sel' : ''}${slot ? ' slot2' : ''}${poza ? ' poza' : ''}${projekt.slot2Fields[f.id] && slot ? ' wlasne' : ''}`}
                  aria-label={`Pole ${nazwa}${slot ? ' (etykieta 2)' : ''}`} aria-pressed={zaznaczone}
                  style={{ left: f.xMm * px, top: f.yMm * px, width: r.w * px, height: r.h * px }}
                  onPointerDown={e => ciagnij(e, baza, slot)} onClick={e => { e.stopPropagation(); onSel({ id: f.id, slot }) }}>
                  {f.kind === 'qr' ? <span className="et-qr" aria-hidden="true" />
                    : f.kind === 'box' ? null
                      : <span className="et-tekst" style={{
                        fontSize: (f.sizePt ?? 10) * PT_MM * px, fontWeight: f.bold ? 700 : 400, fontFamily: RODZINA[f.font ?? 'arial'],
                        textAlign: f.align === 'C' ? 'center' : f.align === 'R' ? 'right' : 'left',
                        transform: obrot ? `rotate(${obrot}deg)` : undefined,
                        transformOrigin: obrot === 90 ? `${((f.sizePt ?? 10) * PT_MM * px) / 2}px ${((f.sizePt ?? 10) * PT_MM * px) / 2}px` : 'center',
                        width: obrot === 90 || obrot === 270 ? r.h * px : undefined,
                      }}>{tekst || nazwa}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
