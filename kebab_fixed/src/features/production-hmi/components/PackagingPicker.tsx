/**
 * Zmiana tulei pozycji z poziomu hali.
 *
 * Metalowe potrafią skończyć się w połowie dnia i pozycja jedzie dalej na
 * kartonowych. Do tej pory poprawiało to biuro po fakcie — teraz robi to
 * operator jednym dotknięciem, a magazyn od razu się zgadza.
 *
 * Braku tulei na stanie NIE traktujemy jako blokady: hala widzi, co ma
 * fizycznie w ręce, a stan w kartotece bywa nieaktualny (biuro przyjmuje
 * dostawę wieczorem). Pokazujemy ostrzeżenie i pozwalamy wybrać.
 */
import { packagingOptions, type PackagingItem } from '../packagingOptions'
import type { PlanLineView } from './PlanList'

export interface PackagingPickerProps {
  line: PlanLineView
  /** Tuleja stojąca teraz na pozycji. */
  packagingId: string
  packaging: PackagingItem[]
  /** Ile tulei już zeszło ze stanu na tej pozycji — tyle wróci na magazyn. */
  used?: number
  onPick: (packagingId: string) => void
  onClose: () => void
  busy?: boolean
}

export function PackagingPicker({
  line, packagingId, packaging, used = 0, onPick, onClose, busy,
}: PackagingPickerProps) {
  const zostalo = Math.max(0, (line?.qty ?? 0) - (line?.qtyDone ?? 0))
  const opcje = packagingOptions(packaging, packagingId, zostalo)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-5 p-6" style={{
        width: 720, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--accentSoft)', border: '1px solid #C7CCFB', color: 'var(--accent)',
          }}>⌾</div>
          <div>
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Zmień tuleję</h3>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
              {line?.recipeName || 'Pozycja'} · zostało <span className="hmi-v10-mono">{zostalo}</span> szt.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        {used > 0 && (
          <div data-testid="tuleje-do-oddania" className="text-[15px] font-semibold" style={{
            padding: '12px 14px', borderRadius: 10,
            background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)',
          }}>
            <span className="hmi-v10-mono font-extrabold">{used}</span> tulei zeszło już z tej pozycji — wróci na magazyn,
            a z nowej zejdzie tyle samo.
          </div>
        )}

        <div className="flex flex-col gap-2 overflow-auto" style={{ maxHeight: 420 }}>
          {opcje.map(o => (
            <button key={o.id} type="button" data-testid={`tuleja-opcja-${o.id}`} disabled={!!busy}
              onClick={() => onPick(o.id)}
              className="flex items-center gap-4 text-left"
              style={{
                padding: '16px 18px', borderRadius: 10, background: o.current ? 'var(--accentSoft)' : 'var(--panel)',
                border: `1.5px solid ${o.current ? 'var(--accent)' : 'var(--line)'}`, opacity: busy ? .5 : 1,
              }}>
              <span className="text-[19px] font-extrabold flex-1">{o.name}</span>
              {o.current && (
                <span className="text-[10px] font-bold uppercase" style={{
                  padding: '3px 9px', borderRadius: 6, letterSpacing: '.06em',
                  background: 'var(--accent)', color: '#fff',
                }}>obecna</span>
              )}
              {!o.enough && (
                <span className="text-[10px] font-bold uppercase" style={{
                  padding: '3px 9px', borderRadius: 6, letterSpacing: '.06em',
                  background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)',
                }}>nie starczy</span>
              )}
              <span className="hmi-v10-mono text-[17px] font-bold" style={{
                minWidth: 96, textAlign: 'right', color: o.available === 0 ? 'var(--red)' : 'var(--mut)',
              }}>
                {o.available} szt.
              </span>
            </button>
          ))}
          {opcje.length === 0 && (
            <div className="text-[15px]" style={{ color: 'var(--mut)' }}>
              Kartoteka nie ma żadnej tulei. Zgłoś to biuru.
            </div>
          )}
        </div>

        <button type="button" onClick={onClose} className="text-base font-bold"
          style={{ height: 56, borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
          Anuluj
        </button>
      </div>
    </div>
  )
}
