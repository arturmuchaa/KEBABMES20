/**
 * Karta rozrachunków kontrahenta — zastępuje jedną zakładkę arkusza
 * `PŁATNOŚCI08.04.xlsx`.
 *
 * Trzy rzeczy musi robić dobrze:
 *
 * 1. **Saldo w walucie klienta**, jedną liczbą. Waluta jest per kontrahent
 *    („w zależności od klienta jest albo euro albo PLN"), więc nie ma tu
 *    dwóch równoległych sald jak w arkuszu.
 * 2. **Powiedzieć, OD KIEDY liczy.** Saldo otwarcia jest odcięciem —
 *    bez tej daty biuro szukałoby w MES dokumentów sprzed wdrożenia.
 * 3. **Nie udawać zera**, gdy salda otwarcia nikt nie wpisał. „Nie
 *    skonfigurowano" i „nic nie jest winien" to dwie różne rzeczy.
 */
import { useCallback, useEffect, useState } from 'react'
import { rozrachunkiApi, type RozrachunkiKarta } from '@/lib/api'
import { fmtSaldo, stanSalda } from './rozrachunkiView'

const KOLOR: Record<string, string> = {
  dlug: 'text-red-700',
  nadplata: 'text-green-700',
  zero: 'text-ink',
}

function data(iso: string): string {
  if (!iso) return ''
  const [r, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && r ? `${d}.${m}.${r}` : String(iso)
}

export function KartaRozrachunkow({ clientId }: { clientId: string }) {
  const [karta, setKarta] = useState<RozrachunkiKarta | null>(null)
  const [blad, setBlad] = useState('')

  const wczytaj = useCallback(() => {
    setBlad('')
    return rozrachunkiApi.karta(clientId)
      .then(setKarta)
      .catch(() => setBlad('Nie udało się wczytać rozrachunków'))
  }, [clientId])

  useEffect(() => { void wczytaj() }, [wczytaj])

  if (blad) return <div className="p-4 text-[12.5px] text-red-700">{blad}</div>
  if (!karta) return <div className="p-4 text-[12.5px] text-muted-foreground">Wczytuję…</div>

  const stan = stanSalda(karta.saldo.saldo)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-lg border bg-background p-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Saldo — {karta.client.name}
        </div>
        {karta.saldo.skonfigurowane ? (
          <>
            <div className={`text-2xl font-bold tabular-nums ${KOLOR[stan]}`}>
              {fmtSaldo(karta.saldo.saldo, karta.waluta)}
            </div>
            {/* Data odcięcia na wierzchu: bez niej biuro szuka w MES
                dokumentów sprzed wdrożenia i dziwi się, że ich nie ma. */}
            <div className="text-[11.5px] text-muted-foreground">
              Saldo otwarcia {fmtSaldo(karta.otwarcie?.amount ?? 0, karta.waluta)}
              {' '}na dzień <b>{data(karta.otwarcie?.as_of_date ?? '')}</b> — wcześniejsze
              dokumenty zawierają się w tej kwocie.
            </div>
          </>
        ) : (
          <div className="text-[12.5px] text-amber-700">
            <b>Wpisz saldo otwarcia</b> — bez niego rozrachunki nie mają od czego liczyć.
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Obciążenia
          </div>
          {karta.obciazenia.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Brak od daty odcięcia.</div>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {karta.obciazenia.map((o, i) => (
                  <tr key={o.id ?? `${o.number}-${i}`}
                      data-numer={o.number}
                      data-po-terminie={o.dni_po_terminie ?? 0}
                      className="border-t first:border-t-0">
                    <td className="py-1 font-mono tabular-nums text-muted-foreground">
                      {data(o.doc_date)}
                    </td>
                    <td className="py-1 font-mono font-bold">{o.number}</td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {fmtSaldo(o.amount, karta.waluta)}
                    </td>
                    <td className="py-1 pl-2 text-[11px]">
                      {(o.dni_po_terminie ?? 0) > 0
                        ? <span className="font-bold text-red-700">
                            {o.dni_po_terminie} dni po terminie
                          </span>
                        : <span className="text-muted-foreground">
                            termin {data(o.termin ?? '')}
                          </span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Wpłaty
          </div>
          {karta.wplaty.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">Brak od daty odcięcia.</div>
          ) : (
            <table className="w-full text-[12px]">
              <tbody>
                {karta.wplaty.map(w => (
                  <tr key={w.id} className="border-t first:border-t-0">
                    <td className="py-1 font-mono tabular-nums text-muted-foreground">
                      {data(w.paid_date)}
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {fmtSaldo(Math.abs(w.amount), karta.waluta)}
                    </td>
                    {/* Uwaga zostaje polem tekstowym — biuro pisze tam
                        „2850 28.07" albo „1264+1500 husain". */}
                    <td className="py-1 pl-2 text-[11px] text-muted-foreground">{w.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
