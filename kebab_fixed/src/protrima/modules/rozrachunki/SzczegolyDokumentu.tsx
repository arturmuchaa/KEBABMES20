import React, { useEffect, useState } from 'react'
import { FileText, History, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { SzkieletBloku } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import { FORMA_SLOWEM, KLASA_TONU, etykietaStanu, mapujSzczegoly, znakSalda, type Dok, type Forma, type SzczegolyDokumentu as Szczegoly } from './model'
import { OdmowaSerwera, naEnter, useZapis } from './wspolne'

const ZRODLO: Record<string, string> = { mes_wz: 'WZ z MES', reczna: 'faktura wpisana ręcznie', subiekt: 'faktura z Subiekta' }
const czas = (iso: string) => { const [d, t] = iso.split('T'); return `${dataPl(d)}${t ? ` ${t.slice(0, 5)}` : ''}` }

type Edycja = { termin: string; forma: string; uwagi: string; powod: string }

/**
 * Szczegóły dokumentu (WZ albo faktura): ile i czym zapłacono, historia zmian,
 * zmiana terminu, formy i uwag; faktura wpisana ręcznie — usunięcie z powodem.
 * Kwotę WZ zmienia się w dokumentach WZ (saldo przelicza się samo).
 */
export function SzczegolyDokumentu({ dokId, waluta, onClose, onZmiana, onWplata }: {
  dokId: string; waluta: string; onClose: () => void
  /** Po zapisie: karta się odświeża, okno zamyka. */
  onZmiana: () => void
  /** „+ Wpłata do tego dokumentu” — okno wpłaty z przypiętym dokumentem. */
  onWplata?: (d: Dok) => void
}) {
  const app = useApp()
  const res = useApi(() => rozliczeniaApi.dokument(dokId).then(mapujSzczegoly), [dokId])
  const d = res.data
  const [e, setE] = useState<Edycja | null>(null)
  const [usuwanie, setUsuwanie] = useState(false)
  const [powodUsuniecia, setPowodUsuniecia] = useState('')
  const zapis = useZapis('Nie udało się zapisać zmian')
  const usun = useZapis('Nie udało się usunąć faktury')

  useEffect(() => {
    if (d && !e) setE({ termin: d.termin ?? '', forma: d.forma, uwagi: d.uwagi, powod: '' })
  }, [d, e])

  const zmiany: Record<string, string> = {}
  if (d && e) {
    if (e.termin && e.termin !== (d.termin ?? '')) zmiany.termin = e.termin
    if (e.forma && e.forma !== d.forma) zmiany.forma = e.forma
    if (e.uwagi.trim() !== d.uwagi) zmiany.uwagi = e.uwagi.trim()
  }
  const blednyTermin = !!(d && e && e.termin && e.termin < d.data)
  const zmienione = Object.keys(zmiany).length > 0
  const ok = zmienione && !blednyTermin
  const reczna = d?.zrodlo === 'reczna'
  const wTrakcie = zapis.busy || usun.busy

  const zapisz = () => {
    if (!d || !e || !ok || wTrakcie) return
    void zapis.zapisz(async () => {
      await rozliczeniaApi.edytujDokument(d.id, { ...zmiany, ...(e.powod.trim() ? { powod: e.powod.trim() } : {}) })
      const co = [zmiany.termin && `termin ${dataPl(zmiany.termin)}`, zmiany.forma && `forma: ${FORMA_SLOWEM[zmiany.forma] ?? zmiany.forma}`,
        'uwagi' in zmiany && (zmiany.uwagi ? `uwagi „${zmiany.uwagi}”` : 'uwagi usunięte')].filter(Boolean).join(' · ')
      app.toast({ kind: 'ok', title: `${d.numer} — zmiany zapisane`, detail: co })
      onZmiana()
    })
  }
  const usunFakture = () => {
    if (!d || !powodUsuniecia.trim() || wTrakcie) return
    void usun.zapisz(async () => {
      await rozliczeniaApi.usunDokument(d.id, powodUsuniecia.trim())
      app.toast({ kind: 'ok', title: `${d.numer} usunięta`, detail: 'saldo przeliczone; wpłaty z tej faktury przeszły na najstarsze otwarte dokumenty' })
      onZmiana()
    })
  }

  const st = d && etykietaStanu(d.stan)
  return (
    <Dialog wide icon={<FileText size={20} />} onClose={onClose}
      title={<>{d?.numer ?? 'Dokument'}{st && <span className={`tag ${KLASA_TONU[st.ton]} rr-dlg-tag`}>{st.tekst}</span>}</>}
      footer={<>
        {d && onWplata && znakSalda(d.zostalo) > 0 && (
          <button type="button" className="btn rr-lewy" onClick={() => onWplata(d)}>+ Wpłata do tego dokumentu</button>
        )}
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || wTrakcie} onClick={zapisz}
          data-tip={ok ? undefined : blednyTermin ? 'Termin przed datą dokumentu' : 'Nic nie zmieniono'}>
          {zapis.busy ? 'Zapisuję…' : 'Zapisz zmiany'}
        </button>
      </>}>
      {res.error && (
        <div className="note crit" role="alert"><FlagIcon level="crit" size={15} />
          <div><b>Nie udało się wczytać dokumentu:</b> {res.error} <button type="button" className="btn sm" onClick={() => void res.refetch()}>Spróbuj ponownie</button></div>
        </div>
      )}
      {!d && !res.error && <SzkieletBloku linie={5} opis="Wczytywanie dokumentu…" />}
      {d && e && (
        <>
          <Fakty d={d} waluta={waluta} />
          {d.brakVat && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Bez VAT — sprawdź wycenę.</b> Klient z polskim NIP, a na WZ nie ma żadnej stawki VAT.</div></div>}

          <div className="rr-edycja">
            <label className="fld"><span className="label">Termin płatności</span>
              <input type="date" className={`field${blednyTermin ? ' invalid' : ''}`} value={e.termin} aria-label="Termin płatności"
                aria-invalid={blednyTermin || undefined} onChange={x => setE({ ...e, termin: x.target.value })} onKeyDown={naEnter(zapisz)} />
              {blednyTermin && <span className="rr-pole-blad">Termin nie może być przed datą dokumentu ({dataPl(d.data)})</span>}
            </label>
            <div className="fld"><span className="label">Forma płatności</span>
              <div className="seg" role="group" aria-label="Forma płatności">
                {(['gotowka', 'przelew'] as Forma[]).map(f => (
                  <button key={f} type="button" aria-pressed={e.forma === f} onClick={() => setE({ ...e, forma: f })}>{FORMA_SLOWEM[f]}</button>
                ))}
              </div>
            </div>
            <label className="fld rr-pole-szerokie"><span className="label">Uwagi</span>
              <input className="field" value={e.uwagi} aria-label="Uwagi" autoFocus placeholder="np. brakuje 426 €, reklamacja"
                onChange={x => setE({ ...e, uwagi: x.target.value })} onKeyDown={naEnter(zapisz)} /></label>
            <label className="fld rr-pole-szerokie"><span className="label">Powód zmiany (opcjonalnie, trafi do historii)</span>
              <input className="field" value={e.powod} aria-label="Powód zmiany" placeholder="np. ustalenie z klientem przez telefon"
                onChange={x => setE({ ...e, powod: x.target.value })} onKeyDown={naEnter(zapisz)} /></label>
          </div>
          {d.zrodlo === 'mes_wz' && <p className="muted rr-dlg-p">Kwotę, numer i datę zmienia się w dokumentach WZ — saldo przeliczy się samo, a zmiana trafi do historii.</p>}
          <OdmowaSerwera blad={zapis.blad} />

          <Pokrycie d={d} waluta={waluta} />
          <HistoriaZmian d={d} />

          {reczna && (
            <div className="rr-usun">
              {!usuwanie
                ? <button type="button" className="btn sm danger" onClick={() => setUsuwanie(true)}><Trash2 size={14} />Usuń fakturę…</button>
                : <>
                    <label className="fld"><span className="label">Powód usunięcia (obowiązkowy, trafi do historii)</span>
                      <input className="field" value={powodUsuniecia} aria-label="Powód usunięcia" autoFocus placeholder="np. faktura wpisana dwa razy"
                        onChange={x => setPowodUsuniecia(x.target.value)} onKeyDown={naEnter(usunFakture)} /></label>
                    <div className="rr-usun-akcje">
                      <button type="button" className="btn sm" onClick={() => { setUsuwanie(false); setPowodUsuniecia('') }}>Nie usuwaj</button>
                      <button type="button" className="btn sm primary danger" disabled={!powodUsuniecia.trim() || wTrakcie} onClick={usunFakture}
                        data-tip={powodUsuniecia.trim() ? undefined : 'Wpisz powód usunięcia'}>
                        <Trash2 size={14} />{usun.busy ? 'Usuwam…' : 'Usuń fakturę'}
                      </button>
                    </div>
                    <p className="muted rr-dlg-p">Faktura zniknie z salda, ale zostanie w historii. Wpłaty, które ją pokryły, przejdą na najstarsze otwarte faktury.</p>
                    <OdmowaSerwera blad={usun.blad} />
                  </>}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

function Fakty({ d, waluta }: { d: Szczegoly; waluta: string }) {
  const fakty: Array<[string, React.ReactNode, string?]> = [
    ['Data', dataPl(d.data)],
    ['Kwota', kwota(d.kwota, waluta), 'num'],
    ['Zapłacono', kwota(d.zaplacono, waluta), 'num'],
    ['Zostało', kwota(d.zostalo, waluta), `num${d.stan.kod === 'po_terminie' ? ' crit-ink' : ''}`],
    ['Termin', d.termin ? dataPl(d.termin) : '—'],
    ['Źródło', ZRODLO[d.zrodlo] ?? d.zrodlo],
  ]
  if (d.zamkniety) fakty.push(['Zapłacona', dataPl(d.zamkniety)])
  return (
    <dl className="rr-fakty">
      {fakty.map(([k, v, cls]) => <div key={k}><dt className="label">{k}</dt><dd className={cls}>{v}</dd></div>)}
    </dl>
  )
}

function Pokrycie({ d, waluta }: { d: Szczegoly; waluta: string }) {
  return (
    <div className="rr-sekcja">
      <span className="label">Wpłaty, które go pokryły</span>
      {d.pokrycie.length === 0
        ? <p className="muted rr-dlg-p">Nic jeszcze nie wpłacono na ten dokument.</p>
        : (
          <table className="tbl rr-mini" aria-label="Pokrycie wpłatami">
            <thead><tr><th>Data</th><th>Forma</th><th className="num">Kwota</th><th>Uwagi</th></tr></thead>
            <tbody>{d.pokrycie.map((p, i) => (
              <tr key={i} className="row">
                <td className="tnum">{dataPl(p.data)}</td>
                <td>{FORMA_SLOWEM[p.forma] ?? (p.forma || '—')}</td>
                <td className="num">{kwota(p.kwota, waluta)}</td>
                <td className="rr-uwagi" title={p.uwagi}>{p.uwagi || <span className="faint">—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
    </div>
  )
}

function HistoriaZmian({ d }: { d: Szczegoly }) {
  return (
    <div className="rr-sekcja">
      <span className="label"><History size={13} /> Historia zmian</span>
      {d.historia.length === 0
        ? <p className="muted rr-dlg-p">Bez zmian od wystawienia.</p>
        : (
          <ul className="rr-hist">
            {d.historia.map((h, i) => (
              <li key={i}><span className="faint tnum">{czas(h.kiedy)}{h.kto ? ` · ${h.kto}` : ''}</span> {h.opis}
                {h.powod && <i className="muted"> — powód: „{h.powod}”</i>}</li>
            ))}
          </ul>
        )}
    </div>
  )
}
