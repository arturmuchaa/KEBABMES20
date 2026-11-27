/**
 * Zwrot końcówki palety — kg z wagi paletowej w chłodni (plan produkcji, 26.11.2026).
 *
 * Końcówka zawsze wraca do chłodni i jest ważona; system zakłada z niej nową
 * paletę tej samej partii. Nowej etykiety nie ma — na końcówce zostaje
 * etykieta z masowni, a jej skan następnego dnia bierze końcówkę. „Zużyta do zera"
 * zamyka paletę bez końcówki. Bez zwrotu każdej wywiezionej palety biuro nie
 * potwierdzi planu — stąd lista palet, które są jeszcze na hali.
 */
import { useEffect, useState } from 'react'
import { seasonedPalletsApi } from '@/lib/api'

interface PaletaNaHali { id: string; qr: string; palletNo: number; batchNo: string; recipeName: string; kgWeighed: number }

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',')

export function ZwrotKoncowki({ planId, onZamknij, onZwrocono }: {
  planId: string
  onZamknij: () => void
  onZwrocono: (wynik: any) => void
}) {
  const [palety, setPalety] = useState<PaletaNaHali[] | null>(null)
  const [wybrana, setWybrana] = useState<PaletaNaHali | null>(null)
  const [kg, setKg] = useState('')
  const [zapis, setZapis] = useState(false)
  const [blad, setBlad] = useState('')

  useEffect(() => {
    let zywy = true
    seasonedPalletsApi.list('on_hall', planId)
      .then(r => { if (zywy) setPalety(r as PaletaNaHali[]) })
      .catch(e => { if (zywy) { setPalety([]); setBlad(e?.message ?? 'Nie udało się wczytać palet') } })
    return () => { zywy = false }
  }, [planId])

  const liczba = kg === '' ? NaN : Number(kg.replace(',', '.'))
  const zaDuzo = wybrana != null && Number.isFinite(liczba) && liczba > wybrana.kgWeighed
  const mozna = wybrana != null && Number.isFinite(liczba) && liczba >= 0 && !zaDuzo && !zapis

  const oddaj = async (ile: number) => {
    if (!wybrana) return
    setZapis(true); setBlad('')
    try {
      const wynik = await seasonedPalletsApi.return(wybrana.qr, ile)
      onZwrocono(wynik)
    } catch (e: any) {
      setBlad(e?.message ?? 'Nie udało się zapisać zwrotu')
    } finally {
      setZapis(false)
    }
  }

  const klawisz = { borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }
  const wcisnij = (c: string) => setKg(k => (c === '⌫' ? k.slice(0, -1) : c === ',' ? (k.includes(',') ? k : (k || '0') + ',') : (k + c).replace(/^0(\d)/, '$1')).slice(0, 7))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div data-testid="okno-zwrotu" className="flex flex-col gap-5 p-6" style={{
        width: 820, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div>
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Zwrot końcówki do chłodni</h3>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
              Zważ końcówkę na wadze paletowej i wpisz kg. Etykieta z masowni zostaje na końcówce. Pustą paletę oznacz „Zużyta do zera”.
            </p>
          </div>
          <button type="button" onClick={onZamknij} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <div className="flex gap-3 flex-wrap">
          {palety === null && <span className="text-[15px]" style={{ color: 'var(--mut)' }}>Wczytuję palety…</span>}
          {palety?.length === 0 && <span className="text-[15px]" style={{ color: 'var(--mut)' }}>Na hali nie ma palet z tego planu.</span>}
          {palety?.map(p => {
            const w = wybrana?.id === p.id
            return (
              <button key={p.id} type="button" onClick={() => { setWybrana(p); setKg(''); setBlad('') }}
                className="text-left" style={{ ...klawisz, padding: '12px 18px',
                  background: w ? 'var(--accent)' : 'var(--panel)', borderColor: w ? 'var(--accent)' : 'var(--line)', color: w ? '#fff' : 'var(--ink)' }}>
                <div className="text-[17px] font-extrabold">Paleta {p.palletNo}</div>
                <div className="text-[13px] font-bold">partia {p.batchNo} · {p.recipeName} · wyjechało {fmt(p.kgWeighed)} kg</div>
              </button>
            )
          })}
        </div>

        {wybrana && (
          <div className="flex gap-6 items-start">
            <div className="flex flex-col gap-2" style={{ minWidth: 260 }}>
              <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>Końcówka z wagi</div>
              <b data-testid="kg-koncowki" className="hmi-v10-mono text-[58px] font-extrabold leading-none">{kg || '0'} <span className="text-[22px]">kg</span></b>
              {zaDuzo && <span className="text-[14px] font-bold" style={{ color: '#B91C1C' }}>To więcej niż wyjechało ({fmt(wybrana.kgWeighed)} kg)</span>}
              <button type="button" onClick={() => oddaj(0)} disabled={zapis} className="text-[16px] font-bold mt-2"
                style={{ height: 52, borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--bg)' }}>
                Zużyta do zera
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 flex-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(c => (
                <button key={c} type="button" onClick={() => wcisnij(c)} aria-label={c === '⌫' ? 'Cofnij' : c}
                  className="text-[26px] font-extrabold" style={{ ...klawisz, height: 64 }}>{c}</button>
              ))}
            </div>
          </div>
        )}

        {blad && <div role="alert" className="text-[15px] font-bold px-4 py-3" style={{ borderRadius: 10, background: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FCA5A5' }}>{blad}</div>}

        <div className="flex gap-3">
          <button type="button" onClick={() => mozna && oddaj(liczba)} disabled={!mozna}
            className="flex-1 text-[19px] font-bold"
            style={{ height: 60, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff', opacity: mozna ? 1 : .4 }}>
            {zapis ? 'Zapisuję…' : `Zatwierdź${wybrana && Number.isFinite(liczba) ? ` ${fmt(liczba)} kg` : ''}`}
          </button>
          <button type="button" onClick={onZamknij} className="text-base font-bold"
            style={{ height: 60, padding: '0 24px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  )
}
