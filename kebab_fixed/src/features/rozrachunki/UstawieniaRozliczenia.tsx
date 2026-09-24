/**
 * Włączanie rozliczenia kontrahentowi: waluta i podstawa.
 *
 * Luka złapana w przeglądzie 24.09.2026: moduł nie dawał się włączyć nikomu
 * inaczej niż SQL-em w bazie, a ekran radził „włącz w kartotece kontrahenta"
 * — takiego pola w kartotece nie było.
 *
 * Siedzi TUTAJ, a nie w kartotece, bo tu jest kontekst: obok widać saldo
 * i listę rozliczanych. Kartoteka kontrahenta opisuje firmę (NIP, adres,
 * nazwy na dokumentach), a to jest decyzja o sposobie rozliczania.
 */
import { useEffect, useState } from 'react'
import { clientsApi } from '@/lib/api'

type Podstawa = 'both' | 'wz' | 'invoice'

const OPIS_PODSTAWY: Record<Podstawa, string> = {
  both: 'WZ i faktury (domyślnie)',
  wz: 'tylko WZ',
  invoice: 'tylko faktury',
}

export function UstawieniaRozliczenia({ onZmiana }: { onZmiana: () => void }) {
  const [klienci, setKlienci] = useState<{ id: string; name: string; displayName?: string }[]>([])
  const [klient, setKlient] = useState('')
  const [waluta, setWaluta] = useState('PLN')
  const [podstawa, setPodstawa] = useState<Podstawa>('both')
  const [blad, setBlad] = useState('')
  const [zajety, setZajety] = useState(false)

  useEffect(() => {
    clientsApi.list().then(setKlienci).catch(() => setKlienci([]))
  }, [])

  async function wlacz() {
    if (!klient) { setBlad('Wybierz kontrahenta'); return }
    setZajety(true); setBlad('')
    try {
      await clientsApi.ustawRozliczenie(klient, true, waluta, podstawa)
      setKlient('')
      onZmiana()
    } catch (e) {
      // Backend odmawia zmiany waluty przy niezerowym saldzie — to zdanie
      // trzeba pokazać, a nie zastąpić ogólnikiem.
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać')
    } finally {
      setZajety(false)
    }
  }

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Dodaj kontrahenta do rozrachunków
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px]">Kontrahent
          <select data-testid="wybor-klienta" value={klient}
            onChange={e => setKlient(e.target.value)}
            className="block h-8 w-56 rounded-[3px] border px-2 text-sm">
            <option value="">— wybierz —</option>
            {klienci.map(k => (
              <option key={k.id} value={k.id}>{k.displayName || k.name}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">Waluta rozliczeń
          <select data-testid="wybor-waluty" value={waluta}
            onChange={e => setWaluta(e.target.value)}
            className="block h-8 w-24 rounded-[3px] border px-2 text-sm">
            <option value="PLN">PLN</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="text-[11px]">Co obciąża saldo
          <select data-testid="wybor-podstawy" value={podstawa}
            onChange={e => setPodstawa(e.target.value as Podstawa)}
            className="block h-8 w-52 rounded-[3px] border px-2 text-sm">
            {(Object.keys(OPIS_PODSTAWY) as Podstawa[]).map(p => (
              <option key={p} value={p}>{OPIS_PODSTAWY[p]}</option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="wlacz-rozliczenie" disabled={zajety}
          onClick={() => void wlacz()}
          className="h-8 rounded-[3px] border border-ink bg-ink px-3 text-[12px] font-semibold text-white disabled:opacity-50">
          Włącz rozliczenie
        </button>
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        Waluta jest <b>jedna na kontrahenta</b> — saldo nie miesza złotówek
        z euro. Przy niezerowym saldzie nie da się jej zmienić, bo kwoty nie
        są przeliczane.
      </div>
      {blad && <div className="mt-1.5 text-[11.5px] text-red-700">{blad}</div>}
    </div>
  )
}
