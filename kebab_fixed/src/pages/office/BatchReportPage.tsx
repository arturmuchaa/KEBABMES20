import { useParams } from 'react-router-dom'
import { traceabilityApi } from '@/lib/apiClient'
import { useApi } from '@/hooks/useApi'
import { fmtKg, fmtDatePl } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  single: 'Partia pojedyncza',
  mixer: 'Partia łączona w mieszalniku (PP)',
  production: 'Partia łączona na produkcji (PPP)',
}

export function BatchReportPage() {
  const { batchNo = '' } = useParams()
  const decoded = decodeURIComponent(batchNo)
  const res = useApi(() => traceabilityApi.batchReport(decoded), [decoded])
  const d: any = res.data || {}
  const tr: any = d.trace || {}

  return (
    <div className="bg-white p-6 text-sm text-slate-900">
      <div className="mb-4 border-b border-black pb-2">
        <div className="text-lg font-black">RAPORT IDENTYFIKOWALNOŚCI PARTII</div>
        <div className="font-mono text-base font-bold">{d.batchNo || decoded}</div>
        <div className="text-xs">
          {TYPE_LABEL[d.batchType] || '—'} · wydruk {fmtDatePl(new Date().toISOString())}
        </div>
      </div>

      {res.loading && <div>Ładowanie…</div>}

      {!res.loading && (
        <>
          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Skład partii (z czego powstała)</div>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="border border-black p-1 text-left">Partia wsadowa</th>
                <th className="border border-black p-1 text-right">kg</th>
                <th className="border border-black p-1 text-right">szt.</th>
              </tr></thead>
              <tbody>
                {(d.composition || []).map((c: any, i: number) => (
                  <tr key={i}>
                    <td className="border border-black p-1 font-mono">{c.batch_no}</td>
                    <td className="border border-black p-1 text-right">{c.kg != null ? fmtKg(c.kg, 1) : '—'}</td>
                    <td className="border border-black p-1 text-right">{c.pieces != null ? c.pieces : '—'}</td>
                  </tr>
                ))}
                {(d.composition || []).length === 0 && (
                  <tr><td colSpan={3} className="border border-black p-1 text-slate-500">Partia pojedyncza — bez łączenia.</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Trasa: ćwiartka → wyrób</div>
            <div className="text-xs space-y-1">
              <div><b>Ćwiartki:</b> {(tr.rawBatches || []).map((r: any) => `${r.internal_batch_no}${r.supplier_name ? ' (' + r.supplier_name + ')' : ''}${r.slaughter_date ? ', ubój ' + fmtDatePl(r.slaughter_date) : ''}`).join('; ') || '—'}</div>
              <div><b>Rozbiór:</b> {(tr.deboning || []).map((x: any) => x.sessionNo || x.session_no).filter(Boolean).join('; ') || '—'}</div>
              <div><b>Masowanie:</b> {(tr.mixingOrders || []).map((m: any) => m.order_no).join('; ') || '—'}</div>
              <div><b>Mięso przyprawione:</b> {(tr.seasonedBatches || []).map((s: any) => s.batch_no).join('; ') || '—'}</div>
              <div><b>Wyrób gotowy:</b> {(tr.finishedGoods || []).map((f: any) => f.batch_no).join('; ') || '—'}</div>
            </div>
          </section>

          <section className="mb-4">
            <div className="font-bold uppercase text-xs mb-1">Bilans masy partii zamarynowanych</div>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead><tr>
                <th className="border border-black p-1 text-left">Partia</th>
                <th className="border border-black p-1 text-right">Wyprodukowano</th>
                <th className="border border-black p-1 text-right">Zużyto</th>
                <th className="border border-black p-1 text-right">Dostępne</th>
              </tr></thead>
              <tbody>
                {(d.seasonedBalance || []).map((b: any, i: number) => (
                  <tr key={i}>
                    <td className="border border-black p-1 font-mono">{b.batch_no}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_produced || 0), 1)}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_used || 0), 1)}</td>
                    <td className="border border-black p-1 text-right">{fmtKg(Number(b.kg_available || 0), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
