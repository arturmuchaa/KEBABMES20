/**
 * Ustawienia drukarki etykiet masowni — w menu serwisowym (kod 0099).
 *
 * Powstało po zgłoszeniu z hali: „etykiety się rozjechały, drukują od połowy
 * i się nie mieszczą" przy ZPL-u, który w testach układu jest czysty. Takie
 * objawy dają trzy rzeczy PO STRONIE DRUKARKI i wszystkie trzy da się teraz
 * sprawdzić przy maszynie, bez wydawania nowej wersji:
 *
 *  • zła rozdzielczość — ta sama etykieta na 300 dpi wychodzi w dwóch trzecich
 *    rozmiaru, bo punkt jest fizycznie mniejszy;
 *  • nieskalibrowane media — drukarka nie wie, gdzie zaczyna się etykieta,
 *    i zjeżdża na przerwę między nimi;
 *  • przesunięcie góry etykiety zapisane w pamięci drukarki.
 *
 * Etykieta testowa rysuje ramkę pola zadruku i podziałkę co 10 mm: jeśli ramka
 * nie trafia w krawędzie albo podziałka nie zgadza się z linijką, wiadomo, że
 * winna jest drukarka, a nie treść wydruku.
 */
import { useState } from 'react'
import { CALIBRATE_ZPL } from '@/features/deboning/labelPrinterSetup'
import { LABEL_DPI_KEY, labelDpi, labelTestZpl } from '../mixingLabelZpl'

export function PrinterPanel({ onSend }: {
  /** Wysyła ZPL na drukarkę; zwraca komunikat do pokazania operatorowi. */
  onSend: (zpl: string, komunikat: string) => Promise<void> | void
}) {
  const [dpi, setDpi] = useState(() => labelDpi())
  const [msg, setMsg] = useState<string | null>(null)

  const ustawDpi = (nowe: number) => {
    try {
      localStorage.setItem(LABEL_DPI_KEY, String(nowe))
    } catch {
      /* prywatne okno — ustawienie nie przeżyje restartu, ale działa teraz */
    }
    setDpi(nowe)
    setMsg(`Rozdzielczość: ${nowe} dpi. Wydrukuj test i sprawdź linijką.`)
  }

  const wyslij = async (zpl: string, komunikat: string) => {
    setMsg(komunikat)
    await onSend(zpl, komunikat)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold uppercase" style={{ color: 'var(--svcMut)', letterSpacing: '.1em' }}>
        Drukarka etykiet (100 × 150 mm)
      </span>

      <div className="flex gap-2">
        {[203, 300].map(d => (
          <button key={d} type="button" onClick={() => ustawDpi(d)}
            className="h-12 flex-1 text-sm font-bold"
            style={{
              borderRadius: 10,
              border: `2px solid ${dpi === d ? 'var(--svcInk)' : 'var(--svcLine)'}`,
              background: dpi === d ? 'var(--svcInk)' : 'var(--svcBg)',
              color: dpi === d ? '#fff' : 'var(--svcInk)',
            }}>
            {d} dpi
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button type="button"
          onClick={() => void wyslij(CALIBRATE_ZPL, 'Kalibracja uruchomiona — drukarka wypuści kilka etykiet')}
          className="h-12 flex-1 text-sm font-bold"
          style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
          Kalibruj etykiety
        </button>
        <button type="button"
          onClick={() => void wyslij(labelTestZpl({ dpi }), 'Etykieta testowa wysłana')}
          className="h-12 flex-1 text-sm font-bold"
          style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
          Wydruk testowy
        </button>
      </div>

      <p className="text-[11px] leading-snug m-0" style={{ color: 'var(--svcMut)' }}>
        Ramka testu ma trafić w krawędzie etykiety, a podziałka zgadzać się z linijką.
        Jeśli wydruk zjeżdża albo wychodzi poza taśmę — najpierw kalibracja, potem
        sprawdź rozdzielczość drukarki.
      </p>

      {msg ? (
        <div className="text-xs font-semibold px-3 py-2"
          style={{ borderRadius: 8, background: 'var(--svcBg)', border: '1px solid var(--svcLine)' }}>
          {msg}
        </div>
      ) : null}
    </div>
  )
}
