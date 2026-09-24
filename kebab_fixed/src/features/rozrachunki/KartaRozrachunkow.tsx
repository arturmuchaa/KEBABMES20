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

/** Biuro pisze kwoty po polsku, z przecinkiem. */
function liczba(tekst: string): number {
  return Number(String(tekst).replace(/\s/g, '').replace(',', '.')) || 0
}

function dzisiaj(): string {
  return new Date().toISOString().slice(0, 10)
}

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
  const [otwarty, setOtwarty] = useState<'otwarcie' | 'faktura' | 'wplata' | null>(null)
  const [bladZapisu, setBladZapisu] = useState('')
  const [form, setForm] = useState({ kwota: '', data: '', numer: '', uwaga: '' })

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
  const innaWaluta = karta.ostrzezenia?.inna_waluta ?? 0

  async function zapisz(co: 'otwarcie' | 'faktura' | 'wplata') {
    try {
      if (co === 'otwarcie') {
        await rozrachunkiApi.otwarcie(clientId, {
          amount: liczba(form.kwota), as_of_date: form.data || dzisiaj(),
          note: form.uwaga,
        })
      } else if (co === 'faktura') {
        // Numer jest obowiązkowy — backend i tak odmówi, ale lepiej nie
        // wysyłać żądania, które na pewno wróci błędem.
        if (!form.numer.trim()) { setBladZapisu('Podaj numer faktury'); return }
        await rozrachunkiApi.faktura(clientId, {
          number: form.numer.trim(), doc_date: form.data || dzisiaj(),
          amount: liczba(form.kwota), note: form.uwaga,
        })
      } else {
        await rozrachunkiApi.wplata(clientId, {
          paid_date: form.data || dzisiaj(), amount: liczba(form.kwota),
          note: form.uwaga,
        })
      }
      setOtwarty(null)
      setForm({ kwota: '', data: '', numer: '', uwaga: '' })
      setBladZapisu('')
      await wczytaj()
    } catch (e) {
      setBladZapisu(e instanceof Error ? e.message : 'Nie udało się zapisać')
    }
  }

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

      {/* Dokumenty w INNEJ walucie niż kartoteka odpadają z salda. Ciche
          pominięcie byłoby drugim błędem — należność znikałaby bez śladu. */}
      {innaWaluta > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <b>{innaWaluta} dokument(y) w innej walucie</b> niż rozliczeniowa
          ({karta.waluta}) — nie wchodzą do salda. Popraw walutę na dokumencie
          albo w kartotece kontrahenta.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" data-testid="pokaz-otwarcie"
          onClick={() => { setOtwarty(otwarty === 'otwarcie' ? null : 'otwarcie'); setBladZapisu('') }}
          className="rounded-[3px] border px-2.5 py-1 text-[12px] hover:bg-muted">
          Saldo otwarcia
        </button>
        <button type="button" data-testid="pokaz-fakture"
          onClick={() => { setOtwarty(otwarty === 'faktura' ? null : 'faktura'); setBladZapisu('') }}
          className="rounded-[3px] border px-2.5 py-1 text-[12px] hover:bg-muted">
          Dodaj fakturę
        </button>
        <button type="button" data-testid="pokaz-wplate"
          onClick={() => { setOtwarty(otwarty === 'wplata' ? null : 'wplata'); setBladZapisu('') }}
          className="rounded-[3px] border px-2.5 py-1 text-[12px] hover:bg-muted">
          Dodaj wpłatę
        </button>
      </div>

      {otwarty && (
        <div className="rounded-lg border bg-background p-3">
          <div className="flex flex-wrap items-end gap-2">
            {otwarty === 'faktura' && (
              <label className="text-[11px]">Numer faktury
                <input data-testid="faktura-numer" value={form.numer}
                  onChange={e => setForm(f => ({ ...f, numer: e.target.value }))}
                  placeholder="FS 12/09/2026"
                  className="block h-8 w-44 rounded-[3px] border px-2 text-sm" />
              </label>
            )}
            <label className="text-[11px]">
              {/* Właściciel 24.09.2026: kwoty w rozrachunkach są NETTO. */}
              Kwota {otwarty === 'wplata' ? '' : 'netto'} ({karta.waluta})
              <input data-testid={`${otwarty}-kwota`} value={form.kwota}
                onChange={e => setForm(f => ({ ...f, kwota: e.target.value }))}
                inputMode="decimal" placeholder="0,00"
                className="block h-8 w-32 rounded-[3px] border px-2 text-sm" />
            </label>
            <label className="text-[11px]">
              {otwarty === 'otwarcie' ? 'Na dzień' : otwarty === 'wplata' ? 'Data wpłaty' : 'Data dostawy'}
              <input data-testid={`${otwarty}-data`} type="date" value={form.data}
                onChange={e => setForm(f => ({ ...f, data: e.target.value }))}
                className="block h-8 w-36 rounded-[3px] border px-2 text-sm" />
            </label>
            <label className="flex-1 text-[11px]">Uwaga
              <input data-testid={`${otwarty}-uwaga`} value={form.uwaga}
                onChange={e => setForm(f => ({ ...f, uwaga: e.target.value }))}
                placeholder={otwarty === 'wplata' ? 'np. 2850 28.07' : ''}
                className="block h-8 w-full rounded-[3px] border px-2 text-sm" />
            </label>
            <button type="button" data-testid={`${otwarty}-zapisz`}
              onClick={() => void zapisz(otwarty)}
              className="h-8 rounded-[3px] border border-ink bg-ink px-3 text-[12px] font-semibold text-white">
              Zapisz
            </button>
          </div>
          {/* Znak nakłada serwis — biuro wpisuje, ile klient jest winien. */}
          {otwarty === 'otwarcie' && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Wpisz, <b>ile klient jest nam winien</b> — bez minusa. Dokumenty
              sprzed tej daty zawierają się w tej kwocie i nie liczą się osobno.
            </div>
          )}
          {bladZapisu && (
            <div className="mt-1.5 text-[11.5px] text-red-700">{bladZapisu}</div>
          )}
        </div>
      )}

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
