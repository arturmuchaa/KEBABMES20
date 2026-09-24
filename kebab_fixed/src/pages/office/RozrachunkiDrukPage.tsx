/**
 * Zestawienie niezapłaconych dla kontrahenta — wydruk A4.
 *
 * Właściciel 24.09.2026: „chciałbym móc ładnie wydrukować zestawienie dla
 * klienta (…) będę podpinał klientowi do dokumentów".
 *
 * Saldo jest z CHWILI WYDRUKU, nie z chwili wystawienia dokumentów —
 * dlatego na dole jest data i godzina. Bez niej dwa wydruki tego samego
 * zestawienia pokazują różne kwoty i nikt nie wie, który jest aktualny.
 *
 * Wydruk jest STRONĄ APLIKACJI, nie oknem `window.open`: w Tauri okna
 * i skrypty inline nie działają.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { rozrachunkiApi, type RozrachunkiKarta } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'
import { fmtSaldo, stanSalda } from '@/features/rozrachunki/rozrachunkiView'

function data(iso: string): string {
  if (!iso) return ''
  const [r, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && r ? `${d}.${m}.${r}` : String(iso)
}

export function RozrachunkiDrukPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [karta, setKarta] = useState<RozrachunkiKarta | null>(null)
  const [blad, setBlad] = useState('')

  useEffect(() => {
    rozrachunkiApi.karta(id)
      .then(setKarta)
      .catch(() => setBlad('Nie udało się wczytać rozrachunków'))
  }, [id])

  if (blad) return <div className="p-6 text-sm text-red-700">{blad}</div>
  if (!karta) return <div className="p-6 text-sm text-muted-foreground">Wczytuję…</div>

  // Bez salda otwarcia zestawienie pokazałoby całą historię jako zaległość
  // — na papierze jadącym do kontrahenta to nieprawda.
  if (!karta.saldo.skonfigurowane) {
    return (
      <div className="p-6 text-sm text-amber-700">
        {karta.client.name}: nie ma wpisanego salda otwarcia. Bez niego
        zestawienie pokazałoby całą historię jako zaległość. Wpisz saldo
        otwarcia w Rozrachunkach.
      </div>
    )
  }

  const stan = stanSalda(karta.saldo.saldo)

  return (
    <div className="mx-auto max-w-3xl p-6 text-[13px]">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 12mm }
        .bez-druku { display: none !important }
      }`}</style>

      <div className="bez-druku mb-4 flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer size={14} /> Drukuj
        </Button>
      </div>

      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-lg font-bold">{karta.client.name}</div>
          {karta.client.nip && <div className="text-[11px]">NIP {karta.client.nip}</div>}
        </div>
        <div className="text-right text-[11px]">
          <div className="text-[15px] font-bold">Zestawienie niezapłaconych</div>
          <div>na dzień {data(karta.na_dzien)}</div>
        </div>
      </div>

      {karta.obciazenia.length === 0 ? (
        <div className="rounded border p-4 text-center">
          Brak niezapłaconych dokumentów.
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b text-[10.5px] uppercase tracking-wider text-muted-foreground">
              <th className="py-1 text-left">Data</th>
              <th className="py-1 text-left">Dokument</th>
              <th className="py-1 text-right">Kwota</th>
              <th className="py-1 text-right">Termin</th>
              <th className="py-1 text-right">Po terminie</th>
            </tr>
          </thead>
          <tbody>
            {karta.obciazenia.map((o, i) => (
              <tr key={o.id ?? `${o.number}-${i}`} className="border-b"
                  data-po-terminie={o.dni_po_terminie ?? 0}>
                <td className="py-1 font-mono tabular-nums">{data(o.doc_date)}</td>
                <td className="py-1 font-mono">{o.number}</td>
                <td className="py-1 text-right font-mono tabular-nums">
                  {fmtSaldo(Math.abs(o.amount), karta.waluta)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums">
                  {data(o.termin ?? '')}
                </td>
                <td className="py-1 text-right font-mono tabular-nums">
                  {(o.dni_po_terminie ?? 0) > 0 ? <b>{o.dni_po_terminie} dni</b> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-4 flex items-baseline justify-end gap-3 border-t-2 pt-2">
        <span className="text-[15px] font-bold">
          {stan === 'nadplata'
            ? <>Nadpłata <span className="font-normal text-muted-foreground">/ AVANS</span></>
            : <>Do zapłaty <span className="font-normal text-muted-foreground">/ TOPLAM</span></>}
        </span>
        <span className="font-mono text-[17px] font-bold tabular-nums">
          {fmtSaldo(Math.abs(karta.saldo.saldo), karta.waluta)}
        </span>
      </div>

      <div className="mt-6 text-[10px] text-muted-foreground">
        Saldo liczone od dnia {data(karta.otwarcie?.as_of_date ?? '')};
        wcześniejsze dokumenty zawierają się w saldzie otwarcia.
        Zestawienie sporządzono {data(karta.na_dzien)}.
      </div>
    </div>
  )
}
