import React, { useMemo, useRef, useState } from 'react'
import { BellRing, Check, NotebookPen } from 'lucide-react'
import { useApp } from '../../shell/context'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl } from '@/features/rozliczenia/druk'
import { dzisIso, uporzadkujDziennik, type WpisDziennika } from './model'
import { OdmowaSerwera, naEnter, tekstBledu, useZapis } from './wspolne'

const kiedy = (iso: string) => dataPl(iso.slice(0, 10))

/**
 * Dziennik ustaleń z klientem: „05.11 dzwoniłem, obiecał zapłacić do 10.11”.
 * Wpis z datą przypomnienia wyróżnia klienta na liście od tego dnia,
 * dopóki ktoś go nie odhaczy. Nieodhaczone przypomnienia są na górze.
 */
export function Dziennik({ clientId, wpisy, onZmiana }: { clientId: string; wpisy: WpisDziennika[]; onZmiana: () => void }) {
  const app = useApp()
  const [tresc, setTresc] = useState('')
  const [przypomnij, setPrzypomnij] = useState('')
  const [bladOdhaczenia, setBladOdhaczenia] = useState<string | null>(null)
  const [odhaczam, setOdhaczam] = useState<string | null>(null)
  const { busy, blad, zapisz } = useZapis('Nie udało się dodać wpisu')
  const poleRef = useRef<HTMLInputElement>(null)
  const dzis = dzisIso()
  const lista = useMemo(() => uporzadkujDziennik(wpisy, dzis), [wpisy, dzis])
  const ok = !!tresc.trim()

  const dodaj = () => {
    if (!ok || busy) return
    void zapisz(async () => {
      await rozliczeniaApi.dodajWpis(clientId, tresc.trim(), przypomnij || null)
      app.toast({ kind: 'ok', title: 'Wpis dodany do dziennika', detail: przypomnij ? `przypomnienie ${dataPl(przypomnij)} — klient będzie wyróżniony na liście` : undefined })
      setTresc(''); setPrzypomnij('')
      onZmiana()
      poleRef.current?.focus()
    })
  }
  const odhacz = async (w: WpisDziennika) => {
    if (odhaczam) return
    setOdhaczam(w.id); setBladOdhaczenia(null)
    try {
      await rozliczeniaApi.odhaczWpis(w.id)
      app.toast({ kind: 'ok', title: 'Przypomnienie odhaczone', detail: w.tresc })
      onZmiana()
    } catch (e) {
      setBladOdhaczenia(tekstBledu(e, 'Nie udało się odhaczyć przypomnienia'))
    } finally { setOdhaczam(null) }
  }

  return (
    <section className="box rr-panel rr-dziennik" aria-label="Dziennik ustaleń">
      <div className="rr-panel-h"><h3><NotebookPen size={16} />Dziennik ustaleń</h3></div>
      <div className="rr-dziennik-form">
        <input ref={poleRef} className="field" value={tresc} onChange={e => setTresc(e.target.value)} onKeyDown={naEnter(dodaj)}
          aria-label="Treść ustalenia" placeholder="np. dzwoniłem, obiecał zapłacić do piątku" />
        <label className="rr-przypomnij" data-tip="Opcjonalnie: od tego dnia klient będzie wyróżniony na liście, dopóki nie odhaczysz wpisu">
          <BellRing size={14} /><span className="label">Przypomnij</span>
          <input type="date" className="field" value={przypomnij} min={dzis} onChange={e => setPrzypomnij(e.target.value)} onKeyDown={naEnter(dodaj)}
            aria-label="Przypomnij" />
        </label>
        <button type="button" className="btn primary" disabled={!ok || busy} onClick={dodaj} data-tip={ok ? undefined : 'Wpisz treść ustalenia'}>
          {busy ? 'Dodaję…' : 'Dodaj wpis'}
        </button>
      </div>
      <div className="rr-panel-b">
        <OdmowaSerwera blad={blad ?? bladOdhaczenia} />
        {lista.length === 0
          ? <p className="muted rr-dlg-p">Nic jeszcze nie zapisano. Zanotuj tu rozmowy i obietnice klienta — z datą przypomnienia, jeśli trzeba wrócić do sprawy.</p>
          : (
            <ul className="rr-wpisy">
              {lista.map(w => {
                const czeka = !!w.przypomnij && !w.odhaczono
                return (
                  <li key={w.id} data-id={w.id} className={`rr-wpis${w.zalegle ? ' zalegle' : ''}${w.odhaczono ? ' odhaczony' : ''}`}>
                    <div className="rr-wpis-t">
                      <span className="faint tnum">{kiedy(w.kiedy)}{w.kto ? ` · ${w.kto}` : ''}</span>
                      <span className="rr-wpis-tresc">{w.tresc}</span>
                    </div>
                    <div className="rr-wpis-a">
                      {w.przypomnij && (w.odhaczono
                        ? <span className="tag outline"><Check size={12} />odhaczono {kiedy(w.odhaczono)}</span>
                        : <span className={`tag ${w.zalegle ? 'warn' : 'neutral'}`}><BellRing size={12} />{w.zalegle && w.przypomnij < dzis ? 'zaległe od' : 'przypomnienie'} {dataPl(w.przypomnij)}</span>)}
                      {czeka && (
                        <button type="button" className="btn sm" disabled={odhaczam === w.id} onClick={() => void odhacz(w)}
                          data-tip="Sprawa załatwiona — klient przestanie być wyróżniony na liście">Odhacz</button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </section>
  )
}
