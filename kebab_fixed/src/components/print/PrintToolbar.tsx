import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { drukuj } from '@/lib/print'

/**
 * Pasek nad dokumentem: powrót i ręczny druk.
 *
 * POWÓD ISTNIENIA: strony wydruku (plan masowania, wypłaty, karty HACCP,
 * WZ, CMR) to samodzielne widoki bez sidebara. W przeglądarce dało się cofnąć
 * strzałką, ale w aplikacji desktopowej nie ma paska przeglądarki — operator
 * zostawał na wydruku i **musiał zamknąć całego MES-a**, żeby z niego wyjść.
 *
 * Drugi przycisk jest dlatego, że auto-druk potrafi nie zadziałać (blokada
 * okienek, anulowanie okna drukarki) — bez niego jedynym wyjściem był Ctrl+P.
 *
 * Pasek znika przy druku (`@media print`), więc nie brudzi dokumentu.
 */
export function PrintToolbar({ powrot }: {
  /** Dokąd wrócić, gdy nie ma historii (np. okno otwarte bezpośrednio). */
  powrot?: string
}) {
  const navigate = useNavigate()
  const [sp] = useSearchParams()

  // ?pdf=1 = render przez headless Chrome do pliku PDF. Pasek jest ukryty
  // w @media print, ale renderer bywa konfigurowany na ekranowy CSS — a pasek
  // w gotowym dokumencie WZ czy CMR byłby wpadką nie do naprawienia po fakcie.
  if (sp.get('pdf') === '1') return null

  const wroc = () => {
    // window.history.length > 1 znaczy, że jest dokąd wracać. Gdy dokument
    // otwarto wprost (nowe okno, link), cofanie zostawiłoby pustą kartę.
    if (window.history.length > 1) navigate(-1)
    else navigate(powrot ?? '/office')
  }

  return (
    <>
      <style>{`@media print { .print-toolbar { display: none !important } }`}</style>
      <div className="print-toolbar" style={{
        position: 'sticky', top: 0, zIndex: 50, display: 'flex', gap: 8,
        alignItems: 'center', padding: '8px 12px', marginBottom: 8,
        background: '#fff', borderBottom: '1px solid #d8dee6',
      }}>
        <button type="button" onClick={wroc}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 38,
            padding: '0 14px', borderRadius: 8, border: '1px solid #d8dee6',
            background: '#fff', color: '#0f172a', fontWeight: 600, cursor: 'pointer',
          }}>
          <ArrowLeft size={16} /> Wróć
        </button>
        <button type="button" onClick={() => { void drukuj() }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, height: 38,
            padding: '0 16px', borderRadius: 8, border: 'none',
            background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer',
          }}>
          <Printer size={16} /> Drukuj
        </button>
      </div>
    </>
  )
}
