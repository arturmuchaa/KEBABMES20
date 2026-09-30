/**
 * WYDANIE, poziom 2 — które auto.
 *
 * Ta warstwa jest sednem projektu: pierwsza wersja panelu wchodziła od razu
 * w JEDNO auto wbite na sztywno, a rano przy rampie stoją dwa.
 *
 * Nie ma tu wołania „auto stoi na rampie" — nikt tej informacji nie wprowadza,
 * a magazynier widzi auto przez okno (spec §4).
 */
import { useEffect, useState } from 'react'
import { vehiclesApi, type Vehicle } from '@/lib/api'

const TYP: Record<string, string> = { dostawczy: 'dostawczy', tir: 'TIR', solo: 'solówka', inny: '' }

export function EkranWyboruAuta({ onWybor }: { onWybor: (vehicleId: string) => void }) {
  const [pojazdy, setPojazdy] = useState<Vehicle[]>([])
  const [blad, setBlad] = useState('')
  const [ladowanie, setLadowanie] = useState(true)

  useEffect(() => {
    let zywy = true
    const wczytaj = () => vehiclesApi.list()
      .then(r => { if (zywy) { setPojazdy(r.filter(v => v.active).sort((a, b) => a.sortOrder - b.sortOrder)); setBlad('') } })
      .catch(() => { if (zywy) setBlad('Nie udało się wczytać listy aut — sprawdź sieć. Ponawiam…') })
      .finally(() => { if (zywy) setLadowanie(false) })
    void wczytaj()
    const timer = setInterval(wczytaj, 10000)
    return () => { zywy = false; clearInterval(timer) }
  }, [])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 px-6">
      {blad ? (
        <div className="mb-3 rounded-xl p-3 text-sm"
          style={{ background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' }}>{blad}</div>
      ) : null}
      {/* Właściciel 30.09.2026: „lista nieczytelna, ucina numery". Dwa duże
          kafle w rzędzie, nazwa auta zawija się (bez ucinania), numer
          rejestracyjny osobną, dużą linią. */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {pojazdy.map(v => (
          <button key={v.id} type="button" onClick={() => onWybor(v.id)} data-testid="kafel-auta"
            className="flex min-h-[132px] items-center gap-4 rounded-2xl px-6 py-5 text-left transition active:scale-[0.99]"
            style={{ background: 'var(--panel)', border: '2px solid var(--line)', color: 'var(--ink)' }}>
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[26px] font-extrabold leading-tight"
                style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {v.name}
              </span>
              {v.plate ? (
                <span className="hmi-v10-mono mt-2 inline-block rounded-lg px-3 py-1 text-[22px] font-bold leading-none tracking-wide"
                  style={{ background: 'var(--bg)', border: '1.5px solid var(--line)' }}>
                  {v.plate}
                </span>
              ) : null}
              <span className="mt-2 block text-[14px]" style={{ color: 'var(--mut)' }}>
                {v.kind === 'own' ? 'auto własne' : 'spedycja'}{TYP[v.vehicleType] ? ` · ${TYP[v.vehicleType]}` : ''}
              </span>
            </span>
            <span className="grid shrink-0 place-items-center rounded-2xl text-[30px] font-bold"
              style={{ width: 60, height: 60, background: 'var(--accentSoft)', color: 'var(--accent)',
                       border: '1.5px solid var(--accentLine)' }} aria-hidden>→</span>
          </button>
        ))}
      </div>
      {!pojazdy.length && !blad && !ladowanie ? (
        <div className="rounded-xl p-6 text-center text-[15px]"
          style={{ border: '1.5px dashed var(--line)', color: 'var(--mut)' }}>
          Brak aktywnych aut. Biuro dodaje je w kartotece Samochody.
        </div>
      ) : null}
    </div>
  )
}
