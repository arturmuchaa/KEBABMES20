/**
 * SignatureSamplesScreen — wzory podpisów, ekran serwisowy kiosku rozbioru.
 *
 * Wzór rysuje się TUTAJ, bo to jedyny dotykowy ekran w zakładzie. Kierownik
 * otwiera menu serwisowe raz (przytrzymanie 3 s, kod 0099) i wywołuje po
 * kolei kilka osób — każda wbija swój PIN i podpisuje się palcem.
 *
 * NAKŁADKA NA PEŁNY EKRAN, nie zawartość modalu serwisowego: panel menu ma
 * 380 px, a w polu tej szerokości nikt nie złoży czytelnego podpisu.
 *
 * PIN, nie sam kod 0099: kod otwiera menu, ale nie upoważnia kierownika do
 * narysowania cudzego podpisu.
 */
import { useEffect, useState } from 'react'
import { signaturesApi, usersApi } from '@/lib/apiClient'
import { SignaturePad } from './SignaturePad'

interface Pracownik { id: string; name: string; active?: boolean }

/* Korzystamy z KLIENTA APLIKACJI (`apiClient`), nie własnego `fetch`.
 *
 * Pierwsza wersja strzelała sama, z `credentials: 'include'` — i wywracała
 * się na produkcji jako „Failed to fetch". Produkcja ma CORS z gwiazdką,
 * a żądanie z poświadczeniami przy `Allow-Origin: *` przeglądarka odrzuca
 * (spec CORS; main.py ostrzega o tym wprost). Do tego własny fetch nie
 * dokładał nagłówka `Authorization`, więc `/api/workers` oddałoby 401
 * i pustą listę. Klient aplikacji robi obie te rzeczy poprawnie. */

export function SignatureSamplesScreen({ onClose }: { onClose: () => void }) {
  const [osoby, setOsoby] = useState<Pracownik[] | null>(null)
  const [maWzor, setMaWzor] = useState<Record<string, string>>({})
  const [wybrany, setWybrany] = useState<Pracownik | null>(null)
  const [pin, setPin] = useState('')
  const [png, setPng] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [zapisuje, setZapisuje] = useState(false)

  useEffect(() => {
    usersApi.list()
      .then((w: any[]) => {
        const aktywni = (w ?? []).filter(x => x.active !== false) as Pracownik[]
        setOsoby(aktywni)
        // Miniatury istniejących wzorów — kierownik ma widzieć, kto już ma
        // podpis, żeby nie wywoływać tych samych osób po raz drugi.
        aktywni.forEach(o => {
          signaturesApi.sample(o.id)
            .then((d: any) => setMaWzor(m => ({ ...m, [o.id]: d.png })))
            .catch(() => { /* brak wzoru to normalny stan, nie błąd ekranu */ })
        })
      })
      .catch((e: any) => { setOsoby([]); setBlad(String(e?.message ?? e)) })
  }, [])

  const zapisz = () => {
    if (!wybrany || !png || !pin || zapisuje) return
    setZapisuje(true)
    setBlad(null)
    signaturesApi.saveSample(wybrany.id, png, pin)
      .then(() => {
        setMaWzor(m => ({ ...m, [wybrany.id]: png }))
        setInfo(`Zapisano wzór: ${wybrany.name}`)
        // Powrót do listy, żeby kierownik wywołał następną osobę bez
        // zamykania ekranu.
        setWybrany(null); setPin(''); setPng(null)
      })
      .catch(e => setBlad(String(e?.message ?? e)))
      .finally(() => setZapisuje(false))
  }

  const T = {
    bg: '#E7EAEE', panel: '#FFFFFF', ink: '#0F172A',
    mut: '#5B6472', line: '#D8DEE6', red: '#DC2626',
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col"
         style={{ background: T.bg, color: T.ink }}>
      <div className="flex items-center justify-between px-6 py-4"
           style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}>
        <div>
          <h2 className="text-xl font-extrabold">Wzory podpisów</h2>
          <p className="text-sm" style={{ color: T.mut }}>
            {wybrany
              ? `${wybrany.name} — wpisz PIN i podpisz się palcem`
              : 'Wybierz pracownika. Wzór trafia na dokumenty HACCP.'}
          </p>
        </div>
        <button
          type="button"
          onClick={wybrany ? () => { setWybrany(null); setPin(''); setPng(null) } : onClose}
          className="px-5 py-3 text-base font-bold"
          style={{ borderRadius: 10, border: `1px solid ${T.line}`, background: T.bg }}
        >
          {wybrany ? 'Wstecz' : 'Zamknij'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {blad && (
          <p className="mb-4 text-base font-semibold" style={{ color: T.red }}>{blad}</p>
        )}
        {info && !wybrany && (
          <p className="mb-4 text-base font-semibold" style={{ color: '#15803D' }}>{info}</p>
        )}

        {!wybrany && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
            {(osoby ?? []).map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { setWybrany(o); setInfo(null); setBlad(null) }}
                className="flex items-center gap-3 p-4 text-left"
                style={{ borderRadius: 12, background: T.panel, border: `1px solid ${T.line}` }}
              >
                <span className="text-lg font-bold">{o.name}</span>
                {maWzor[o.id]
                  ? <img src={maWzor[o.id]} alt="" className="ml-auto h-10 w-auto max-w-[140px] object-contain" />
                  : <span className="ml-auto text-sm" style={{ color: T.mut }}>brak wzoru</span>}
              </button>
            ))}
            {osoby !== null && osoby.length === 0 && (
              <p style={{ color: T.mut }}>Brak aktywnych pracowników.</p>
            )}
          </div>
        )}

        {wybrany && (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="p-5" style={{ borderRadius: 12, background: T.panel, border: `1px solid ${T.line}` }}>
              <label className="mb-2 block text-base font-bold" htmlFor="wzor-pin">
                PIN pracownika
              </label>
              <input
                id="wzor-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={e => { setPin(e.target.value); setBlad(null) }}
                className="w-48 px-4 py-3 text-2xl tracking-[0.4em]"
                style={{ borderRadius: 10, border: `1px solid ${T.line}` }}
                placeholder="••••"
              />
              <p className="mt-2 text-sm" style={{ color: T.mut }}>
                PIN wpisuje osoba podpisująca — kod serwisowy jej nie zastępuje.
              </p>
            </div>

            <div className="p-5" style={{ borderRadius: 12, background: T.panel, border: `1px solid ${T.line}` }}>
              <SignaturePad onChange={setPng} height={260} />
            </div>

            <button
              type="button"
              onClick={zapisz}
              disabled={!png || !pin || zapisuje}
              className="w-full py-5 text-xl font-extrabold disabled:opacity-40"
              style={{ borderRadius: 12, background: T.ink, color: '#FFFFFF' }}
            >
              {zapisuje ? 'Zapisuję…' : 'Zapisz wzór'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
