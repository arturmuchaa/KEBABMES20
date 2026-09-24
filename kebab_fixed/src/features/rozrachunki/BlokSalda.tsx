/**
 * Blok „niezapłacone" drukowany NA dokumencie wydania.
 *
 * Właściciel 24.09.2026: „do każdej WZ i do faktury drukowało się saldo
 * niezapłaconych FV lub WZ; będę podpinał klientowi do dokumentów".
 *
 * Trzy rzeczy, które ten blok musi robić dobrze:
 *
 * 1. **Dokument bieżący nie liczy się sam do siebie** jako zaległość —
 *    klient dostawałby WZ i widział je w „niezapłaconych" tego samego
 *    papieru. Stąd saldo w dwóch liczbach: przed i po tym dokumencie.
 * 2. **Saldo jest z chwili WYDRUKU**, nie wystawienia — stąd data
 *    i godzina pod blokiem.
 * 3. **Milczy, gdy nie ma czego pokazać.** Kontrahent bez włączonych
 *    rozrachunków albo bez salda otwarcia nie dostaje bloku w ogóle:
 *    backend odmawia, a dokument ma się wydrukować normalnie. Blok jest
 *    dodatkiem do papieru, nie warunkiem jego powstania.
 */
import { useEffect, useState } from 'react'
import { rozrachunkiApi } from '@/lib/api'
import { fmtSaldo } from './rozrachunkiView'

interface Pozycja {
  number: string; doc_date: string; amount: number; dni_po_terminie?: number
}
interface Blok {
  waluta: string
  pozycje: Pozycja[]
  saldo_przed: number
  saldo_po: number
  policzono: string
}

function data(iso: string): string {
  if (!iso) return ''
  const [r, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && r ? `${d}.${m}.${r}` : String(iso)
}

export function BlokSalda({ wzId }: { wzId: string }) {
  const [blok, setBlok] = useState<Blok | null>(null)

  useEffect(() => {
    let porzucone = false
    rozrachunkiApi.naDokumencie(wzId)
      .then((b: Blok) => { if (!porzucone) setBlok(b) })
      // Cicho: brak rozrachunków dla tego kontrahenta to normalny stan,
      // a nie błąd dokumentu.
      .catch(() => { if (!porzucone) setBlok(null) })
    return () => { porzucone = true }
  }, [wzId])

  if (!blok) return null

  return (
    <div data-testid="blok-salda" className="mt-3"
         style={{ border: '1px solid #9a9a9a', fontSize: 10.5 }}>
      <div className="px-2.5 py-1 font-bold"
           style={{ background: '#d7d7d7', borderBottom: '1px solid #9a9a9a' }}>
        Rozrachunki — stan na dziś
      </div>
      <div className="px-2.5 py-1.5">
        {blok.pozycje.length === 0 ? (
          <div>Brak niezapłaconych dokumentów z poprzednich dostaw.</div>
        ) : (
          <table className="w-full">
            <tbody>
              {blok.pozycje.map((p, i) => (
                <tr key={`${p.number}-${i}`}>
                  <td className="py-0.5 font-mono">{data(p.doc_date)}</td>
                  <td className="py-0.5 font-mono">{p.number}</td>
                  <td className="py-0.5 text-right font-mono">
                    {fmtSaldo(Math.abs(p.amount), blok.waluta)}
                  </td>
                  <td className="py-0.5 text-right">
                    {(p.dni_po_terminie ?? 0) > 0 ? <b>{p.dni_po_terminie} dni po terminie</b> : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-1 flex justify-between border-t pt-1">
          <span>Zaległość przed tym dokumentem</span>
          <span className="font-mono">{fmtSaldo(Math.abs(blok.saldo_przed), blok.waluta)}</span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Razem po tym dokumencie</span>
          <span className="font-mono">{fmtSaldo(Math.abs(blok.saldo_po), blok.waluta)}</span>
        </div>
        <div className="mt-1 text-[9px]" style={{ color: '#555' }}>
          Saldo policzone {String(blok.policzono).replace('T', ' ')}.
        </div>
      </div>
    </div>
  )
}
