import React, { useMemo, useRef, useState } from 'react'
import { BellRing, Check, NotebookPen, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl } from '@/features/rozliczenia/druk'
import { dzisIso, uporzadkujDziennik, type WpisDziennika } from './model'
import { OdmowaSerwera, naEnter, tekstBledu, useZapis } from './wspolne'

const kiedy = (iso: string) => dataPl(iso.slice(0, 10))

/**
 * Notatki o rozmowach z klientem (D8, dawniej „Dziennik ustaleń”): „05.11 dzwoniłem,
 * obiecał zapłacić do 10.11”. Notatka z datą przypomnienia wyróżnia klienta na liście
 * od tego dnia, dopóki ktoś jej nie odhaczy. Notatkę można usunąć (zostaje w historii zmian).
 */
export function Notatki({ clientId, wpisy, onZmiana }: { clientId: string; wpisy: WpisDziennika[]; onZmiana: () => void }) {
  const app = useApp()
  const [tresc, setTresc] = useState('')
  const [przypomnij, setPrzypomnij] = useState('')
  const [bladOdhaczenia, setBladOdhaczenia] = useState<string | null>(null)
  const [odhaczam, setOdhaczam] = useState<string | null>(null)
  const [usun, setUsun] = useState<WpisDziennika | null>(null)
  const { busy, blad, zapisz } = useZapis('Nie udało się dodać notatki')
  const poleRef = useRef<HTMLInputElement>(null)
  const dzis = dzisIso()
  const lista = useMemo(() => uporzadkujDziennik(wpisy, dzis), [wpisy, dzis])
  const ok = !!tresc.trim()

  const dodaj = () => {
    if (!ok || busy) return
    void zapisz(async () => {
      await rozliczeniaApi.dodajWpis(clientId, tresc.trim(), przypomnij || null)
      app.toast({ kind: 'ok', title: 'Notatka dodana', detail: przypomnij ? `przypomnienie ${dataPl(przypomnij)} — klient będzie wyróżniony na liście` : undefined })
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
    <section className="box rr-panel rr-dziennik" aria-label="Notatki">
      <div className="rr-panel-h"><h3><NotebookPen size={16} />Notatki</h3></div>
      <div className="rr-dziennik-form">
        <label className="fld rr-notatki-tresc"><span className="label">Nowa notatka</span>
          <input ref={poleRef} className="field" value={tresc} onChange={e => setTresc(e.target.value)} onKeyDown={naEnter(dodaj)}
            aria-label="Treść notatki" />
        </label>
        <label className="rr-przypomnij" data-tip="Opcjonalnie: od tego dnia klient będzie wyróżniony na liście, dopóki nie odhaczysz notatki">
          <BellRing size={14} /><span className="label">Przypomnij</span>
          <input type="date" className="field" value={przypomnij} min={dzis} onChange={e => setPrzypomnij(e.target.value)} onKeyDown={naEnter(dodaj)}
            aria-label="Przypomnij" />
        </label>
        <button type="button" className="btn primary" disabled={!ok || busy} onClick={dodaj} data-tip={ok ? undefined : 'Wpisz treść notatki'}>
          {busy ? 'Dodaję…' : 'Dodaj notatkę'}
        </button>
      </div>
      <div className="rr-panel-b">
        <OdmowaSerwera blad={blad ?? bladOdhaczenia} />
        {lista.length === 0
          ? <p className="muted rr-dlg-p">Brak notatek. Zapisuj tu rozmowy i obietnice klienta — z datą przypomnienia, jeśli trzeba wrócić do sprawy.</p>
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
                      <button type="button" className="btn sm ghost icon danger" onClick={() => setUsun(w)}
                        aria-label={`Usuń notatkę: ${w.tresc}`} data-tip="Usuń notatkę (zostanie w historii zmian)"><Trash2 size={15} /></button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
      {usun && <UsunNotatke w={usun} onClose={() => setUsun(null)} onUsunieto={() => { setUsun(null); onZmiana() }} />}
    </section>
  )
}

/** Potwierdzenie usunięcia notatki — powód opcjonalny (trafia do historii zmian). */
function UsunNotatke({ w, onClose, onUsunieto }: { w: WpisDziennika; onClose: () => void; onUsunieto: () => void }) {
  const app = useApp()
  const [powod, setPowod] = useState('')
  const { busy, blad, zapisz } = useZapis('Nie udało się usunąć notatki')
  const usun = () => {
    if (busy) return
    void zapisz(async () => {
      await rozliczeniaApi.usunWpis(w.id, powod.trim())
      app.toast({ kind: 'ok', title: 'Notatka usunięta', detail: w.tresc })
      onUsunieto()
    })
  }
  return (
    <Dialog title="Usuń notatkę" icon={<Trash2 size={20} />} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary danger" disabled={busy} onClick={usun}>{busy ? 'Usuwam…' : 'Usuń notatkę'}</button>
      </>}>
      <div className="rr-dlg-info">
        <span className="faint tnum">{kiedy(w.kiedy)}{w.kto ? ` · ${w.kto}` : ''}</span>
        <div className="rr-wpis-tresc">{w.tresc}</div>
      </div>
      <label className="fld"><span className="label">Powód (opcjonalnie, trafi do historii)</span>
        <input className="field" value={powod} onChange={e => setPowod(e.target.value)} onKeyDown={naEnter(usun)} aria-label="Powód" data-autofocus /></label>
      <p className="muted rr-dlg-p">Notatka zniknie z karty, ale zostanie w historii zmian klienta.</p>
      <OdmowaSerwera blad={blad} />
    </Dialog>
  )
}
