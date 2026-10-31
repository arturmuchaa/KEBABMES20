import { useMemo } from 'react'
import { zplPreviewBoxes } from '@/features/raw-batches/zplPreview'
import { TAG_H_MM, TAG_W_MM } from '@/features/raw-batches/receptionTagZpl'

/**
 * Podgląd zawieszki rysowany Z SAMEGO ZPL (ten ciąg idzie na drukarkę) —
 * ręcznie odwzorowany HTML rozjechałby się z wydrukiem przy pierwszej zmianie
 * fontu. Znak firmowy jest prostokątem: raster zostaje na drukarce.
 */
export function PodgladZawieszki({ zpl, opis }: { zpl: string; opis: string }) {
  const pola = useMemo(() => zplPreviewBoxes(zpl), [zpl])
  return (
    <svg className="tag-preview" viewBox={`0 0 ${TAG_W_MM} ${TAG_H_MM}`} role="img" aria-label={opis}>
      <rect x={0} y={0} width={TAG_W_MM} height={TAG_H_MM} rx={1.5} className="tp-paper" />
      {pola.map((p, i) => {
        if (p.kind === 'logo') return <rect key={i} x={p.xMm} y={p.yMm} width={p.widthMm} height={p.heightMm} rx={0.6} className="tp-logo" />
        if (p.kind === 'line') {
          const w = p.widthMm ?? 0, h = p.heightMm ?? 0
          // Kreska albo wypełnione pole (tło pod białym napisem) — rysujemy pełne; ramkę obrysem.
          return p.filled || Math.min(w, h) < 1
            ? <rect key={i} x={p.xMm} y={p.yMm} width={Math.max(w, 0.25)} height={Math.max(h, 0.25)} className="tp-ink" />
            : <rect key={i} x={p.xMm} y={p.yMm} width={w} height={h} className="tp-frame" />
        }
        const f = p.fontMm ?? 3
        const x = p.align === 'C' ? p.xMm + (p.widthMm ?? 0) / 2 : p.align === 'R' ? p.xMm + (p.widthMm ?? 0) : p.xMm
        const anchor = p.align === 'C' ? 'middle' : p.align === 'R' ? 'end' : 'start'
        return <text key={i} x={x} y={p.yMm + f * 0.82} fontSize={f} textAnchor={anchor} className={p.reverse ? 'tp-rev' : 'tp-text'}>{p.text}</text>
      })}
    </svg>
  )
}
