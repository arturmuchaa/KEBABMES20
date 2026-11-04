import type { PozycjaSkladu } from '@/lib/api'
import { kgTxt } from './pula'

export function ZawartoscMrozni({ lines }: { lines: PozycjaSkladu[] }) {
  return <span className="mt-1 block space-y-1">
    {lines.map((p, i) => <span key={i} className="block break-words text-[15px] leading-snug">
      <b>{p.qty} szt × {kgTxt(p.kgPerUnit)} kg · {p.recipeName || 'receptura niepodana'}</b>
      <span className="block text-[13px]" style={{ color: 'var(--mut)' }}>
        {p.productTypeName || 'rodzaj niepodany'} · tuleja: {p.packagingName || 'niepodana'}
        {p.source === 'plan' ? ' · ROZPIS — bez skanów sztuk' : ''}
      </span>
    </span>)}
  </span>
}
