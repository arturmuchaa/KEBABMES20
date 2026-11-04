import type { PozycjaSkladu } from '@/lib/api'
import { kgTxt } from './pula'
import { freezerTube } from './mrozniaContents'

export function ZawartoscMrozni({ lines, compact = false }: { lines: PozycjaSkladu[]; compact?: boolean }) {
  return <span className="mt-1 block space-y-2">
    {!lines.length ? <span className="block text-sm" style={{ color: 'var(--mut)' }}>Brak danych zawartości</span> : null}
    {lines.map((p, i) => {
      const tube = freezerTube(p.packagingName)
      const showTube = !compact || tube.nonstandard || tube.cm === null
      return <span key={i} className="block break-words text-[16px] leading-snug">
      <b>{p.qty} szt × {kgTxt(p.kgPerUnit)} kg · {p.recipeName || 'receptura niepodana'}</b>
      <span className="block text-[13px]" style={{ color: 'var(--mut)' }}>
        {p.productTypeName || 'rodzaj niepodany'}
        {showTube ? <>{' · '}<span className={tube.nonstandard ? 'inline-block rounded border px-1.5 py-0.5 font-bold' : ''}
          style={tube.nonstandard ? { color: '#92400e', background: 'var(--ambSoft)', borderColor: 'var(--ambLine)' } : undefined}>
          tuleja: {p.packagingName || 'niepodana'}{tube.nonstandard ? ' · niestandard' : ''}
        </span></> : null}
        {p.source === 'plan' ? <span className="block text-xs">ROZPIS — bez skanów sztuk</span> : null}
      </span>
    </span>})}
  </span>
}
