/**
 * OrderPrintPage — kartka, z którą magazynier chodzi po chłodni.
 *
 * To NIE jest dokument handlowy (od tego jest WZ), tylko lista do
 * skompletowania. Musi nieść wszystko, co potrzebne przy zbieraniu towaru —
 * rodzaj, receptura, tuleja, sztuki, waga, ile już zrobione i ile ZOSTAŁO —
 * i mieć kratkę do odhaczenia ręką. Bez kratki magazynier znaczy po pamięci
 * albo pisze po marginesie (zgłoszenie z biura 26.08.2026).
 *
 * Gęstość i styl jak w WZ: monochrom, hairline, dane monospace.
 *
 * Trasa: /office/zamowienia/:id/druk
 * Renderowana POZA OfficeLayout (bez sidebara) — pełne okno do druku.
 *
 * @media print:
 *   - ukrywa pasek akcji (.no-print)
 *   - usuwa wszystkie tła i cienie
 *   - automatycznie dopasowuje rozmiar strony
 */
import { useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, orderPalletsApi, settingsApi, type OrderPallet } from '@/lib/apiClient'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { Printer, ArrowLeft } from 'lucide-react'
import { useClientNames } from '@/lib/clientNames'
import { drukuj } from '@/lib/print'

export function OrderPrintPage() {
  const clientDisplay = useClientNames()
  const { id = '' } = useParams<{ id: string }>()

  const orderRes   = useApi(() => clientOrdersApi.byId(id), [id])
  const palletsRes = useApi(() => orderPalletsApi.list(id), [id])
  const companyRes = useApi(() => settingsApi.getCompany(), [])

  const order   = orderRes.data
  const pallets = palletsRes.data ?? []
  const company = companyRes.data

  // ── Mapa: orderLineId → [{palletNo, qty}] ──
  const palletsByLine = useMemo(() => {
    const m: Record<string, Array<{ palletNo: number; qty: number }>> = {}
    pallets.forEach((p: OrderPallet) =>
      p.items.forEach(it => {
        m[it.orderLineId] = m[it.orderLineId] ?? []
        m[it.orderLineId].push({ palletNo: p.palletNo, qty: it.qty })
      }),
    )
    return m
  }, [pallets])

  const totalPallets = pallets.length
  // Sumy liczone Z WIERSZY, nie z pól zamówienia: kartka, której podsumowanie
  // nie zgadza się z tym, co na niej wydrukowano, jest gorsza niż bez sumy.
  const totalKg = (order?.lines ?? []).reduce(
    (sum: number, l: any) => sum + (Number(l.totalKg) || (Number(l.qty) || 0) * (Number(l.kgPerUnit) || 0)), 0)
  const totalUnits = (order?.lines ?? []).reduce((sum: number, l: any) => sum + (Number(l.qty) || 0), 0)

  // Auto-focus print button: użytkownik klika "Drukuj" świadomie.
  useEffect(() => { document.title = order ? `Zamówienie nr ${order.orderNo}` : 'Wydruk zamówienia' }, [order])

  if (orderRes.loading) {
    return (
      <div className="p-10 text-center text-muted-foreground">Ładowanie zamówienia…</div>
    )
  }

  if (orderRes.error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Nie udało się otworzyć wydruku</div>
          <div className="text-sm text-slate-700">{orderRes.error}</div>
          <div className="mt-5">
            <Link
              to="/office/zamowienia"
              className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <ArrowLeft size={14} /> Wróć do zamówień
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-slate-900">Nie znaleziono zamówienia</div>
          <div className="text-sm text-slate-700">Wybrane zamówienie nie istnieje albo zostało usunięte.</div>
          <div className="mt-5">
            <Link
              to="/office/zamowienia"
              className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <ArrowLeft size={14} /> Wróć do zamówień
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white min-h-screen text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body, html { background: white !important; }
          @page { size: A4; margin: 12mm 10mm; }
          /* Kartka bywa na dwie strony — nagłówek tabeli ma się powtórzyć,
             a wiersz nie może się przełamać w pół. */
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
        @media screen {
          .print-page { max-width: 210mm; margin: 16px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
        }
      `}</style>

      {/* Pasek akcji (ukryty na druku) */}
      <div className="no-print sticky top-0 z-10 bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center justify-between">
        <Link to="/office/zamowienia" className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> Wróć do zamówień
        </Link>
        <button
          onClick={() => void drukuj()}
          className="flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-white text-sm font-semibold px-4 py-1.5 rounded"
        >
          <Printer size={14} /> Drukuj
        </button>
      </div>

      <div className="print-page p-8">

        {/* Nagłówek: firma + dokument */}
        <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-black">
          <div className="text-sm">
            {company?.name && <div className="font-bold text-base">{company.name}</div>}
            {company?.address && <div>{company.address}</div>}
            {(company?.postalCode || company?.city) && (
              <div>{[company.postalCode, company.city].filter(Boolean).join(' ')}</div>
            )}
            {company?.nip   && <div>NIP: {company.nip}</div>}
            {company?.regon && <div>REGON: {company.regon}</div>}
            {company?.phone && <div>tel. {company.phone}</div>}
            {company?.email && <div>{company.email}</div>}
            {!company?.name && (
              <div className="text-slate-500 italic text-xs">
                Skonfiguruj dane firmy w „Ustawienia firmy"
              </div>
            )}
          </div>
          <div className="text-right text-sm">
            <div className="text-xl font-black tracking-wide">ZAMÓWIENIE NR {order.orderNo}</div>
            <div className="text-xs text-slate-600 mt-2">Data zamówienia: {fmtDatePl(order.orderDate)}</div>
            {order.deliveryDate && (
              <div className="text-xs text-slate-600">Termin dostawy: {fmtDatePl(order.deliveryDate)}</div>
            )}
          </div>
        </div>

        {/* Odbiorca */}
        <div className="mb-5 text-sm">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Odbiorca</div>
          <div className="font-bold text-base">{clientDisplay(order.clientName)}</div>
        </div>

        {/* Tabela pozycji — kolejność jak przy zbieraniu: co, ile, ile zostało. */}
        <table className="w-full border-collapse text-[12px]">
          <thead className="table-header-group">
            <tr>
              {[
                ['Lp', 'w-8 text-center'],
                ['Rodzaj · receptura · tuleja', 'text-left'],
                ['Szt.', 'w-14 text-right'],
                ['kg/szt.', 'w-16 text-right'],
                ['Razem kg', 'w-20 text-right'],
                ['Zrobione', 'w-16 text-right'],
                ['Zostało', 'w-16 text-right'],
                ['Gotowe', 'w-14 text-center'],
              ].map(([h, cls]) => (
                <th key={h} className={`border border-black bg-surface-3 px-1.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] ${cls}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l: any, i: number) => {
              const pal = palletsByLine[l.id] ?? []
              const zrobione = Math.max(0, Number(l.qtyDone) || 0)
              const zostalo = Math.max(0, (Number(l.qty) || 0) - zrobione)
              const kgSzt = Number.isInteger(Number(l.kgPerUnit))
                ? fmtKg(l.kgPerUnit, 0) : fmtKg(l.kgPerUnit, 1)
              return (
                <tr key={l.id} data-testid={`pozycja-${l.id}`} className="break-inside-avoid">
                  <td className="border border-black px-1.5 py-1 text-center tabular-nums">{i + 1}</td>
                  <td className="border border-black px-1.5 py-1">
                    <span className="font-bold">{l.productTypeName || '—'}</span>
                    {l.recipeName ? <span> · {l.recipeName}</span> : null}
                    {l.packagingName ? <span className="text-ink-3"> · {l.packagingName}</span> : null}
                    {pal.length > 0 && (
                      <span className="ml-1 text-[10px] text-ink-3">
                        [{pal.map(p => `P${p.palletNo}` + (p.qty < l.qty ? `(${p.qty})` : '')).join(', ')}]
                      </span>
                    )}
                  </td>
                  <td className="border border-black px-1.5 py-1 text-right font-mono font-bold tabular-nums">{l.qty}</td>
                  <td className="border border-black px-1.5 py-1 text-right font-mono tabular-nums">{kgSzt}</td>
                  <td className="border border-black px-1.5 py-1 text-right font-mono font-bold tabular-nums">{fmtKg(l.totalKg, 0)}</td>
                  <td data-testid={`zrobione-${l.id}`}
                    className="border border-black px-1.5 py-1 text-right font-mono tabular-nums">
                    {zrobione > 0 ? zrobione : '—'}
                  </td>
                  {/* „Zostało" to jedyna liczba, po którą magazynier sięga
                      w chłodni — dlatego jest wytłuszczona, a zero znika. */}
                  <td data-testid={`zostalo-${l.id}`}
                    className="border border-black px-1.5 py-1 text-right font-mono font-bold tabular-nums">
                    {zostalo > 0 ? zostalo : '—'}
                  </td>
                  <td className="border border-black px-1.5 py-1 text-center">
                    {/* Kratka rysowana ramką, nie znakiem — pusty kwadrat
                        z fontu bywa niewidoczny na wydruku termicznym. */}
                    <span data-testid={`kratka-${l.id}`}
                      className="mx-auto block h-[4mm] w-[4mm] border border-black" />
                  </td>
                </tr>
              )
            })}
            <tr data-testid="podsumowanie" className="font-bold">
              <td className="border border-black px-1.5 py-1" />
              <td className="border border-black px-1.5 py-1 text-right uppercase text-[10px] tracking-[0.05em]">Razem</td>
              <td className="border border-black px-1.5 py-1 text-right font-mono tabular-nums">{totalUnits}</td>
              <td className="border border-black px-1.5 py-1" />
              <td className="border border-black px-1.5 py-1 text-right font-mono tabular-nums">{fmtKg(totalKg, 0)}</td>
              <td className="border border-black px-1.5 py-1" colSpan={3} />
            </tr>
          </tbody>
        </table>

        {/* Sekcja palet (szczegół) */}
        {pallets.length > 0 && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Szczegół palet</div>
            <div className="grid grid-cols-2 gap-2">
              {pallets.map(p => {
                const palKg = p.items.reduce((s, it) => {
                  const ln = order.lines.find((l: any) => l.id === it.orderLineId)
                  return s + it.qty * (ln?.kgPerUnit ?? 0)
                }, 0)
                const palQty = p.items.reduce((s, it) => s + it.qty, 0)
                return (
                  <div key={p.id ?? p.palletNo} className="border border-slate-400 p-2 text-xs">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-black text-sm">PALETA P{p.palletNo}</span>
                      <span className="font-bold tabular-nums">{fmtKg(palKg, 1)} kg · {palQty} szt</span>
                    </div>
                    <div className="space-y-0.5">
                      {p.items.map((it, idx) => {
                        const ln = order.lines.find((l: any) => l.id === it.orderLineId)
                        return (
                          <div key={idx} className="flex justify-between">
                            <span className="truncate pr-2">
                              <span className="font-bold tabular-nums">{it.qty}× </span>
                              {ln ? `${ln.kgPerUnit} kg — ${ln.recipeName || ln.productTypeName || ''}` : '—'}
                            </span>
                            <span className="text-slate-600 tabular-nums flex-shrink-0">
                              {fmtKg(it.qty * (ln?.kgPerUnit ?? 0), 1)} kg
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {p.notes && <div className="mt-1 italic text-slate-600">{p.notes}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Podsumowanie + uwagi */}
        <div className="grid grid-cols-2 gap-6 mt-8">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Podsumowanie</div>
            <table className="text-sm">
              <tbody>
                <tr><td className="pr-4">Liczba pozycji:</td><td className="font-bold tabular-nums">{order.lines.length}</td></tr>
                <tr><td className="pr-4">Łączna liczba szt:</td><td className="font-bold tabular-nums">{totalUnits}</td></tr>
                <tr><td className="pr-4">Łączna liczba palet:</td><td className="font-bold tabular-nums">{totalPallets}</td></tr>
                <tr><td className="pr-4">Łączna waga:</td><td className="font-bold tabular-nums text-base">{fmtKg(totalKg, 1)} kg</td></tr>
              </tbody>
            </table>
          </div>
          {order.notes && (
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">Uwagi</div>
              <div className="text-sm whitespace-pre-wrap">{order.notes}</div>
            </div>
          )}
        </div>

        {/* Podpisy — kartkę zamyka ten, kto skompletował. */}
        <div data-testid="podpisy" className="mt-10 grid grid-cols-3 gap-6 text-[11px]">
          <div className="text-center">
            <div className="mt-10 border-t border-black pt-1">Skompletował (podpis)</div>
          </div>
          <div className="text-center">
            <div className="mt-10 border-t border-black pt-1">Data i godzina</div>
          </div>
          <div className="text-center">
            <div className="mt-10 border-t border-black pt-1">Sprawdził (podpis)</div>
          </div>
        </div>

      </div>
    </div>
  )
}
