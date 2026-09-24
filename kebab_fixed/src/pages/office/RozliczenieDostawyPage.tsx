/**
 * Rozliczenie dostawy — kartka dla klienta, do druku.
 *
 * Zastępuje to, co właściciel wypisuje dziś długopisem (zdjęcie z 24.09.2026,
 * TRUVA): grupy wyrobów z rozbiciem na gramatury, kilogramy razy cena,
 * suma za dostawę, zadłużenie z poprzednich dostaw i RAZEM.
 *
 * Dwie rzeczy z oryginału, które muszą zostać:
 *
 * 1. **Rozbicie na gramatury** („30 × 25 kg = 750 kg"). Klient sprawdza
 *    dostawę po pojemnikach, nie po kilogramach — samo „3250 kg" byłoby
 *    krokiem wstecz wobec kartki pisanej ręcznie.
 * 2. **Cena per grupa** (na oryginale 3,20 / 3,40 / 3,20 na jednej dostawie).
 *
 * Wydruk jest STRONĄ APLIKACJI, nie oknem `window.open` — w Tauri okna
 * i skrypty inline nie działają (patrz `tauri-okna-i-inline-skrypty`).
 *
 * Podpisy dwujęzyczne: papier jedzie do tureckiego odbiorcy, a `borçlar`
 * to po turecku „długi" — stąd ta linia na oryginale.
 */
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { rozrachunkiApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Printer } from 'lucide-react'
import { fmtSaldo } from '@/features/rozrachunki/rozrachunkiView'

interface Pozycja { qty: number; kg_per_unit: number; kg: number }
interface Grupa { nazwa: string; kg: number; cena: number; wartosc: number; pozycje: Pozycja[] }
interface Rozliczenie {
  klient: { name: string; nip: string }
  waluta: string
  order_no: string
  dokument: string
  data_dostawy: string
  grupy: Grupa[]
  kg_razem: number
  za_dostawe: number
  saldo_przed: number
  razem: number
  policzono: string
}

function data(iso: string): string {
  if (!iso) return ''
  const [r, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && r ? `${d}.${m}.${r}` : String(iso)
}

export function RozliczenieDostawyPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [dane, setDane] = useState<Rozliczenie | null>(null)
  const [blad, setBlad] = useState('')
  const [ceny, setCeny] = useState<Record<string, string>>({})

  const wczytaj = useCallback((stawki: Record<string, number>) => {
    setBlad('')
    return rozrachunkiApi.dostawa(id, stawki)
      .then((d: Rozliczenie) => setDane(d))
      .catch(() => setBlad('Nie udało się wczytać rozliczenia dostawy'))
  }, [id])

  useEffect(() => { void wczytaj({}) }, [wczytaj])

  function przelicz() {
    const stawki: Record<string, number> = {}
    for (const [k, v] of Object.entries(ceny)) {
      const n = Number(String(v).replace(',', '.'))
      if (n > 0) stawki[k] = n
    }
    void wczytaj(stawki)
  }

  if (blad) return <div className="p-6 text-sm text-red-700">{blad}</div>
  if (!dane) return <div className="p-6 text-sm text-muted-foreground">Wczytuję…</div>

  return (
    <div className="mx-auto max-w-3xl p-6 text-[13px]">
      <style>{`@media print {
        @page { size: A4 portrait; margin: 12mm }
        .bez-druku { display: none !important }
      }`}</style>

      <div className="bez-druku mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="text-[11px] text-muted-foreground">
          Ceny za kilogram — osobno dla każdej grupy, tak jak na kartce.
        </div>
        {dane.grupy.map(g => (
          <label key={g.nazwa} className="text-[11px]">
            {g.nazwa}
            <Input className="h-8 w-24 text-sm"
              value={ceny[g.nazwa] ?? (g.cena || '')}
              placeholder="3,20"
              onChange={e => setCeny(c => ({ ...c, [g.nazwa]: e.target.value }))} />
          </label>
        ))}
        <Button size="sm" variant="outline" onClick={przelicz}>Przelicz</Button>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={() => window.print()}>
          <Printer size={14} /> Drukuj
        </Button>
      </div>

      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-lg font-bold">{dane.klient.name}</div>
          {dane.klient.nip && <div className="text-[11px]">NIP {dane.klient.nip}</div>}
        </div>
        <div className="text-right text-[11px]">
          <div>Rozliczenie dostawy · <b>{dane.order_no}</b></div>
          <div>Dokument {dane.dokument}</div>
          <div>Data dostawy {data(dane.data_dostawy)}</div>
        </div>
      </div>

      <table className="w-full">
        <tbody>
          {dane.grupy.map(g => (
            <tr key={g.nazwa} className="border-t align-top">
              <td className="py-2 font-bold">{g.nazwa}</td>
              <td className="py-2">
                {/* Rozbicie na gramatury zostaje — klient sprawdza dostawę
                    po pojemnikach, nie po kilogramach. */}
                {g.pozycje.map((p, i) => (
                  <div key={i} className="font-mono tabular-nums">
                    {p.qty} × {p.kg_per_unit} kg = {p.kg} kg
                  </div>
                ))}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                <b>{g.kg} kg</b>
                {g.cena > 0 && <> × {fmtSaldo(g.cena, dane.waluta)}</>}
              </td>
              <td className="py-2 pl-3 text-right font-mono font-bold tabular-nums">
                {fmtSaldo(g.wartosc, dane.waluta)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td colSpan={2} className="py-1.5 font-bold">
              Za dostawę <span className="font-normal text-muted-foreground">/ TESLİMAT</span>
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums">{dane.kg_razem} kg</td>
            <td className="py-1.5 pl-3 text-right font-mono font-bold tabular-nums">
              {fmtSaldo(dane.za_dostawe, dane.waluta)}
            </td>
          </tr>
          <tr>
            <td colSpan={3} className="py-1.5">
              Zadłużenie z poprzednich dostaw{' '}
              <span className="text-muted-foreground">/ BORÇLAR</span>
            </td>
            <td className="py-1.5 pl-3 text-right font-mono tabular-nums">
              {fmtSaldo(Math.abs(dane.saldo_przed), dane.waluta)}
            </td>
          </tr>
          <tr className="border-t-2">
            <td colSpan={3} className="py-2 text-[15px] font-bold">
              RAZEM <span className="font-normal text-muted-foreground">/ TOPLAM</span>
            </td>
            <td className="py-2 pl-3 text-right font-mono text-[15px] font-bold tabular-nums">
              {fmtSaldo(Math.abs(dane.razem), dane.waluta)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Saldo jest z CHWILI WYDRUKU — bez tej daty dwa wydruki tego samego
          rozliczenia pokazują różne kwoty i nikt nie wie, który jest
          aktualny. */}
      <div className="mt-6 text-[10px] text-muted-foreground">
        Saldo policzone {String(dane.policzono).replace('T', ' ')}.
      </div>
    </div>
  )
}
