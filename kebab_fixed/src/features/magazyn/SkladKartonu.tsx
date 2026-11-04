import type { KartonPozycja } from '@/lib/api'
import { kgTxt } from './pula'

/** Pełny rozpis, bez obcinania mieszanego kartonu do pierwszej pozycji. */
export function SkladKartonu({ lines }: { lines: KartonPozycja[] }) {
  return <span className="mt-2 block space-y-1" aria-label="Zawartość kartonu">
    {lines.length ? lines.map((p, i) => <span key={i} className="block break-words text-[16px] leading-snug">
      <strong>{p.targetQty} szt × {kgTxt(p.kgPerUnit)} kg · {p.recipeName || 'receptura niepodana'}</strong>
      <span className="block text-[14px]" style={{ color: 'var(--mut)' }}>
        {p.productTypeName || 'rodzaj niepodany'} · tuleja: {p.packagingName || 'niepodana'}
        {' · '}spakowano {p.packedQty}/{p.targetQty} szt
      </span>
    </span>) : <span>Brak rozpisu zawartości</span>}
  </span>
}
