import React, { useState } from 'react'
import { Download, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'
import { companyApi } from '@/lib/api'
import { FlagIcon } from '../../ui/Glyphs'
import { pobraneZGus, pobraneZVies, porownanie, zastosuj, zrodloDlaNumeru, type Formularz, type PolePorownania } from './model'

const ZRODLA: Record<string, string> = { GUS: 'rejestr REGON (GUS)', MF: 'wykaz VAT MF', dataport: 'dataport.pl', VIES: 'VIES (Komisja Europejska)' }

interface Wynik { wiersze: PolePorownania[]; surowy: string; zrodlo: string; vies?: { valid: boolean; requestId: string } }

/**
 * Pobranie danych firmy po NIP (GUS/MF) albo VAT UE (VIES). Wynik to tabela
 * „w karcie / w rejestrze” z ptaszkami: nowy kontrahent — zaznaczone wszystko,
 * istniejący — tylko puste pola. Obok surowy adres ze źródła, żeby było widać,
 * z czego serwer rozpisał ulicę, kod i miasto.
 */
export function PobierzDane({ form, nowy, onPrzejmij }: { form: Formularz; nowy: boolean; onPrzejmij: (f: Formularz) => void }) {
  const [numer, setNumer] = useState(form.nip)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [wynik, setWynik] = useState<Wynik | null>(null)

  const pobierz = async () => {
    if (busy) return
    const zrodlo = zrodloDlaNumeru(numer)
    if (!zrodlo) { setBlad('Wpisz 10 cyfr NIP albo numer VAT UE z kodem kraju (np. DE123456789).'); setWynik(null); return }
    setBusy(true); setBlad(null); setWynik(null)
    try {
      if (zrodlo === 'gus') {
        const d = await companyApi.gus(numer.replace(/\D/g, '').slice(-10))
        setWynik({ wiersze: porownanie(form, pobraneZGus(d), nowy), surowy: d.adres ?? '', zrodlo: ZRODLA[d.zrodlo ?? 'MF'] ?? String(d.zrodlo) })
      } else {
        const d = await companyApi.vies(numer.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        setWynik({ wiersze: porownanie(form, pobraneZVies(d), nowy), surowy: d.traderAddress ?? '', zrodlo: ZRODLA.VIES,
          vies: { valid: d.valid, requestId: d.requestIdentifier ?? '' } })
      }
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się pobrać danych')
    } finally { setBusy(false) }
  }
  const przelacz = (pole: string) => setWynik(w => (w ? { ...w, wiersze: w.wiersze.map(x => (x.pole === pole ? { ...x, przejmij: !x.przejmij } : x)) } : w))
  const zaznaczone = wynik?.wiersze.filter(w => w.przejmij).length ?? 0

  return (
    <section className="kh-pobierz" aria-label="Pobierz dane z rejestru">
      <div className="kh-pobierz-pasek">
        <label className="fld"><span className="label">NIP lub VAT UE</span>
          <input className={`field${blad ? ' invalid' : ''}`} value={numer} placeholder="np. 1112223334 albo ATU12345675" aria-label="NIP lub VAT UE"
            onChange={e => { setNumer(e.target.value); setBlad(null) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void pobierz() } }} /></label>
        <button type="button" className="btn" onClick={() => void pobierz()} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}Pobierz</button>
        <span className="muted kh-pobierz-hint">Polski NIP — GUS / wykaz VAT, numer z kodem kraju — VIES</span>
      </div>
      {blad && <span className="fld-err" role="alert">{blad}</span>}
      {wynik && <div className="kh-porownanie">
        {wynik.vies && (wynik.vies.valid
          ? <div className="vatue ok" data-tip={wynik.vies.requestId ? `Numer potwierdzenia VIES: ${wynik.vies.requestId}` : undefined}><ShieldCheck size={14} /> VAT UE aktywny w VIES</div>
          : <div className="vatue bad"><ShieldAlert size={14} /> VAT UE NIEAKTYWNY w VIES — faktura z VAT</div>)}
        {wynik.wiersze.length === 0
          ? <div className="note"><FlagIcon level="info" size={15} /><div>Dane w karcie zgadzają się z rejestrem — nie ma czego przejmować.</div></div>
          : <table className="tbl kh-por-tbl">
            <thead><tr><th style={{ width: 34 }} /><th>Pole</th><th>W karcie</th><th>W rejestrze</th></tr></thead>
            <tbody>{wynik.wiersze.map(w => (
              <tr key={w.pole} className={`row${w.przejmij ? ' sel' : ''}`} onClick={() => przelacz(w.pole)}>
                <td className="c"><input type="checkbox" className="cbx" checked={w.przejmij} onChange={() => przelacz(w.pole)} onClick={e => e.stopPropagation()} aria-label={`Przejmij: ${w.etykieta}`} /></td>
                <td className="muted">{w.etykieta}</td>
                <td>{w.obecne || <span className="faint">puste</span>}</td>
                <td className="strong">{w.pobrane}</td>
              </tr>))}</tbody>
          </table>}
        <div className="kh-surowy">
          <span className="muted">źródło: {wynik.zrodlo}</span>
          {wynik.surowy && <span className="kh-surowy-adres"><span className="muted">Adres w rejestrze: </span><code>{wynik.surowy}</code></span>}
        </div>
        {wynik.wiersze.length > 0 && <div className="row-wrap">
          <button type="button" className="btn primary sm" disabled={!zaznaczone} onClick={() => { onPrzejmij(zastosuj(form, wynik.wiersze)); setWynik(null) }}>
            Przejmij zaznaczone ({zaznaczone})</button>
          <button type="button" className="btn sm ghost" onClick={() => setWynik(null)}>Pomiń</button>
        </div>}
      </div>}
    </section>
  )
}
