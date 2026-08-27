/**
 * Uzasadnienie prognozy zakończenia.
 *
 * Sama godzina na pasku dnia to za mało: liczba bez uzasadnienia na ścianie
 * hali zostaje zignorowana albo obwiniona o pierwszą pomyłkę. Panel pokazuje,
 * z czego wyszła — i mówi wprost, kiedy prognozy nie ma i dlaczego.
 */
import type { Forecast } from '../finishForecast'

export function ForecastPanel({ forecast, crew, onClose }: {
  forecast: Forecast
  crew: number
  onClose: () => void
}) {
  const wiersz = (testId: string, etykieta: string, wartosc: string) => (
    <div key={testId} data-testid={testId} className="flex items-baseline justify-between"
      style={{ padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="text-[15px] font-semibold" style={{ color: 'var(--mut)' }}>{etykieta}</span>
      <b className="hmi-v10-mono text-[19px] font-extrabold">{wartosc}</b>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-4 p-6" style={{
        width: 620, maxWidth: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)',
        boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>
          Przewidywane zakończenie
        </h3>

        {forecast.kind === 'eta' && (
          <>
            <div className="hmi-v10-mono text-[64px] font-extrabold leading-none text-center py-2"
              style={{ color: 'var(--accent)' }}>{forecast.hhmm}</div>
            {wiersz('prognoza-zostalo', 'Zostało do zrobienia', `${forecast.remainingKg} kg`)}
            {wiersz('prognoza-zaloga',  'Układa teraz',         `${crew} os.`)}
            {wiersz('prognoza-tempo',   'Tempo',                `${forecast.rateUsed} kg/h na osobę`)}
            {wiersz('prognoza-przerwa', 'Doliczona przerwa',    `${forecast.breakAddedMin} min`)}
          </>
        )}

        {forecast.kind === 'ready' && (
          <div className="text-[19px] font-bold" style={{ color: 'var(--success)' }}>
            Plan dnia zrobiony w całości.
          </div>
        )}

        {forecast.kind === 'unknown' && (
          <div className="text-[17px] font-semibold" style={{ color: 'var(--mut)' }}>
            {forecast.reason === 'brak-zalogi'
              ? 'Nikt jeszcze nie liczy sztuk — nie ma z czego liczyć tempa.'
              : 'Za mało pracy, żeby liczyć uczciwie. Prognoza pojawi się po ok. 20 minutach.'}
          </div>
        )}

        <button type="button" onClick={onClose} className="text-base font-bold self-end"
          style={{ height: 56, padding: '0 28px', borderRadius: 10,
                   border: '1px solid var(--line)', color: 'var(--ink)' }}>
          Zamknij
        </button>
      </div>
    </div>
  )
}
