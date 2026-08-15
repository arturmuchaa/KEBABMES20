import { useEffect, useState } from 'react'
import { PrintToolbar } from '@/components/print/PrintToolbar'
import { PASKI_CSS, buildPaySlipsSheets, KLUCZ_PASKOW } from '@/lib/paySlipPrint'

/**
 * Paski wypłaty jako strona aplikacji.
 *
 * POWÓD ISTNIENIA: paski szły jako osobny dokument (blob) z własnymi
 * przyciskami `onclick="history.back()"` i `onclick="window.print()"`.
 * W zbudowanej aplikacji desktopowej Tauri dokłada do CSP nonce, a wtedy
 * przeglądarka **przestaje honorować `'unsafe-inline'`** — inline'owe
 * handlery i skrypt auto-druku są blokowane. Przyciski się rysowały i nie
 * reagowały, a operator zostawał w dokumencie bez wyjścia.
 *
 * Tu paski są normalną stroną aplikacji, więc powrót robi router, a druk —
 * natywna komenda okna (`PrintToolbar`). Układ kartek pozostaje ten sam,
 * bo style i treść pochodzą z tego samego generatora co wydruk w przeglądarce.
 *
 * Dane idą przez sessionStorage, a nie przez adres: pasków bywa kilkadziesiąt
 * i nie zmieściłyby się w URL-u.
 */
export function PaySlipsPrintPage() {
  const [sheets, setSheets] = useState('')
  const [blad, setBlad] = useState('')

  useEffect(() => {
    try {
      const surowe = sessionStorage.getItem(KLUCZ_PASKOW)
      if (!surowe) {
        setBlad('Brak danych do wydruku — wróć i kliknij „Drukuj paski" jeszcze raz.')
        return
      }
      setSheets(buildPaySlipsSheets(JSON.parse(surowe)))
    } catch {
      setBlad('Nie udało się wczytać pasków do wydruku.')
    }
  }, [])

  return (
    <>
      <style>{PASKI_CSS}</style>
      <PrintToolbar powrot="/office/wyplaty" />
      {blad
        ? <div style={{ padding: 24, fontFamily: 'Arial, sans-serif' }}>{blad}</div>
        : <div dangerouslySetInnerHTML={{ __html: sheets }} />}
    </>
  )
}
