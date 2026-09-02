/**
 * SignDialog — złożenie podpisu pod dokumentem, z biura.
 *
 * Biuro wybiera osobę z listy uprawnionych, a ta osoba podchodzi i wbija
 * SWÓJ PIN. Sam wybór z listy nie wystarcza: bez PIN-u biuro przykładałoby
 * cudzy podpis pod dokumentem, o czym podpisujący mógłby nie wiedzieć —
 * a to wywraca sens podpisu.
 *
 * Wzór rysuje się osobno, na HMI rozbioru (menu serwisowe, kod 0099).
 * Osoba bez wzoru nie pojawia się na liście, więc dialog musi powiedzieć
 * wprost, gdzie ten wzór narysować.
 */
import { useEffect, useState } from 'react'
import { signaturesApi } from '@/lib/apiClient'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Uprawniony { id: string; name: string; png: string }

const ROLA_OPIS: Record<string, string> = {
  wykonal: 'Wykonał — kto przyjął dostawę',
  sprawdzil: 'Sprawdził — kierownik albo technolog',
}

export function SignDialog({ docType, docId, role, juzPodpisal, onSigned, onClose }: {
  docType: string
  docId: string
  /** 'wykonal' (kol. l) albo 'sprawdzil' (kol. m) karty 1.1.1. */
  role: 'wykonal' | 'sprawdzil'
  /** Kto podpisał drugą rolę tego dokumentu — do ostrzeżenia. */
  juzPodpisal?: string
  onSigned: () => void
  onClose: () => void
}) {
  const [osoby, setOsoby] = useState<Uprawniony[] | null>(null)
  const [wybrany, setWybrany] = useState<Uprawniony | null>(null)
  const [pin, setPin] = useState('')
  const [blad, setBlad] = useState<string | null>(null)
  const [wysyla, setWysyla] = useState(false)

  useEffect(() => {
    let zywe = true
    signaturesApi.eligible(role)
      .then((d: any) => { if (zywe) setOsoby(d ?? []) })
      .catch((e: any) => { if (zywe) { setOsoby([]); setBlad(e?.message ?? 'Nie udało się wczytać listy') } })
    return () => { zywe = false }
  }, [role])

  const podpisz = () => {
    if (!wybrany || !pin || wysyla) return
    setWysyla(true)
    setBlad(null)
    signaturesApi.sign({ docType, docId, role, workerId: wybrany.id, pin })
      .then(() => { onSigned(); onClose() })
      .catch((e: any) => setBlad(e?.message ?? 'Nie udało się złożyć podpisu'))
      .finally(() => setWysyla(false))
  }

  const taSamaOsoba = !!wybrany && !!juzPodpisal && wybrany.id === juzPodpisal

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-4">
        <div>
          <h3 className="text-base font-bold">Podpis elektroniczny</h3>
          <p className="text-sm text-ink-3">{ROLA_OPIS[role]}</p>
        </div>

        {osoby === null && <p className="text-sm text-ink-3">Wczytywanie…</p>}

        {osoby !== null && osoby.length === 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Brak osób z wzorem podpisu i uprawnieniem do tej roli.
            <br />
            Wzór rysuje się na HMI rozbioru: przytrzymaj tytuł ekranu 3 sekundy,
            wpisz kod <strong>0099</strong>, wejdź w „Wzory podpisów".
            Uprawnienie nadaje się w kartotece pracowników.
          </div>
        )}

        {osoby !== null && osoby.length > 0 && (
          <>
            <div className="space-y-1.5">
              <Label>Kto podpisuje</Label>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {osoby.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setWybrany(o); setBlad(null) }}
                    className={[
                      'flex w-full items-center gap-3 rounded border px-3 py-2 text-left',
                      wybrany?.id === o.id ? 'border-ink bg-surface-2' : 'border-ink-5',
                    ].join(' ')}
                  >
                    <span className="text-sm font-semibold">{o.name}</span>
                    <img
                      src={o.png}
                      alt=""
                      className="ml-auto h-8 w-auto max-w-[120px] object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>

            {taSamaOsoba && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                Uwaga: ta sama osoba podpisze wykonanie i sprawdzenie.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="sign-pin">PIN podpisującego</Label>
              <Input
                id="sign-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={e => { setPin(e.target.value); setBlad(null) }}
                onKeyDown={e => { if (e.key === 'Enter') podpisz() }}
                placeholder="••••"
              />
              <p className="text-xs text-ink-3">
                PIN wpisuje osoba podpisująca, nie biuro.
              </p>
            </div>
          </>
        )}

        {blad && <p className="text-sm text-red-700">{blad}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>Anuluj</Button>
          <Button
            type="button"
            onClick={podpisz}
            disabled={!wybrany || !pin || wysyla}
          >
            {wysyla ? 'Podpisuję…' : 'Podpisz'}
          </Button>
        </div>
      </div>
    </div>
  )
}
