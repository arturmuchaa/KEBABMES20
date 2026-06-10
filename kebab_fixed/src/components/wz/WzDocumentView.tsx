import { WzDoc, WzLine } from '@/lib/api'
import { fmtDatePl } from '@/lib/utils'

/** Dane dokumentu do renderu — pełny WzDoc z API albo szkic z formularza
 *  (przed wystawieniem; wtedy number/seller mogą być puste). */
export type WzDocData = {
  number?: string
  place?: string
  issued_date?: string
  release_date?: string
  seller?: { name?: string; address?: string; nip?: string }
  buyer_name?: string
  buyer_address?: string
  buyer_nip?: string
  valued: boolean
  lines: WzLine[]
  total_value?: number
}

export function asWzDocData(doc: WzDoc): WzDocData { return doc }

const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(2)

/** Arkusz dokumentu WZ — wspólny dla podglądu (modal), strony wydruku i PDF.
 *  Klasyczny układ dokumentu magazynowego: nagłówek, strony, tabela, podpisy. */
export function WzDocumentView({ doc, draft }: { doc: WzDocData; draft?: boolean }) {
  const head = ['Lp', 'Nazwa towaru', 'Partia', 'Ilość', 'j.m.', ...(doc.valued ? ['Cena jedn.', 'Wartość'] : [])]
  const cols = head.length
  return (
    <div className="wz bg-white text-[#111] mx-auto" style={{ width: 794, padding: 40, fontSize: 13 }}>
      {/* Nagłówek dokumentu */}
      <div className="flex justify-between items-start pb-4 border-b-2 border-[#111]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Dokument magazynowy</div>
          <h1 className="text-[26px] font-bold leading-tight mt-0.5">WZ — Wydanie zewnętrzne</h1>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#666]">Numer</div>
          <div className="font-mono font-bold text-[18px]">
            {doc.number || (draft ? '— / —— / ————' : '')}
          </div>
          <div className="text-[12px] mt-1 text-[#444]">
            {doc.place}{doc.place ? ', ' : ''}{fmtDatePl(doc.issued_date)}
          </div>
        </div>
      </div>

      {/* Strony */}
      <div className="flex gap-5 mt-5">
        {[
          { label: 'Sprzedający / Wystawca', name: doc.seller?.name, address: doc.seller?.address, nip: doc.seller?.nip },
          { label: 'Odbiorca / Nabywca',     name: doc.buyer_name,   address: doc.buyer_address,   nip: doc.buyer_nip },
        ].map(p => (
          <div key={p.label} className="flex-1 border border-[#9a9a9a] p-3">
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-1.5">{p.label}</div>
            <div className="font-bold">{p.name || (draft ? '—' : '')}</div>
            <div className="text-[12px] text-[#333] whitespace-pre-line">{p.address}</div>
            {p.nip && <div className="text-[12px] mt-0.5">NIP: <span className="font-mono">{p.nip}</span></div>}
          </div>
        ))}
      </div>

      {/* Pozycje */}
      <table className="w-full mt-5" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {head.map(h => (
              <th key={h} className="border border-[#9a9a9a] bg-[#f0f0f0] px-2 py-1.5 text-[11px] uppercase tracking-wide text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td className="border border-[#9a9a9a] px-2 py-1.5 text-center w-9">{i + 1}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5">{l.name}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 font-mono text-[12px]">{l.batch_no || '—'}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{l.qty}</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 w-12">{l.unit}</td>
              {doc.valued && <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{fmt(l.price)}</td>}
              {doc.valued && <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-mono">{fmt(l.value ?? l.qty * (l.price ?? 0))}</td>}
            </tr>
          ))}
          {!doc.lines.length && (
            <tr><td colSpan={cols} className="border border-[#9a9a9a] px-2 py-4 text-center text-[#888]">Brak pozycji</td></tr>
          )}
        </tbody>
        {doc.valued && doc.lines.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={cols - 1} className="border border-[#9a9a9a] px-2 py-1.5 text-right font-bold">Razem</td>
              <td className="border border-[#9a9a9a] px-2 py-1.5 text-right font-bold font-mono">
                {fmt(doc.total_value ?? doc.lines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      <div className="mt-6 text-[12px]">Data wydania: <b>{fmtDatePl(doc.release_date)}</b></div>

      {/* Podpisy */}
      <div className="flex justify-between mt-16">
        {['Wydał', 'Odebrał'].map(s => (
          <div key={s} className="border-t border-[#111] w-[220px] text-center pt-1 text-[12px] text-[#444]">{s}</div>
        ))}
      </div>
    </div>
  )
}
