import React, { useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import { FORMA_SLOWEM, FORMY, dni, doGroszy, dodajDni, dzisIso, formaDomyslna, kilogramy, liczba, type Forma, type Karta } from './model'
import { OdmowaSerwera, PoleKwoty, Segment, kwotaZPola, naEnter, useZapis } from './wspolne'

const normNumer = (t: string) => t.trim().replace(/\s+/g, ' ').toUpperCase()

/**
 * Faktura wpisana ręcznie do księgi faktur (z Subiekta przepisuje ją biuro).
 * Termin liczy się sam z daty i terminu FV klienta, dopóki biuro go nie zmieni.
 * Kwota ujemna = faktura korygująca.
 */
export function FakturaDialog({ karta, onClose, onZapisano }: { karta: Karta; onClose: () => void; onZapisano: () => void }) {
  const app = useApp()
  const w = karta.klient.waluta
  const terminFv = karta.klient.terminFv
  const [numer, setNumer] = useState('')
  const [data, setData] = useState(dzisIso)
  const [tekst, setTekst] = useState('')
  const [termin, setTermin] = useState(() => dodajDni(dzisIso(), terminFv))
  const [terminReczny, setTerminReczny] = useState(false)
  const [forma, setForma] = useState<Forma>(() => formaDomyslna(karta.klient.formaFv, 'fv'))
  const [uwagi, setUwagi] = useState('')
  const [kgTekst, setKgTekst] = useState('')
  const zapis = useZapis('Nie udało się dodać faktury')

  const zmienDate = (d: string) => { setData(d); if (!terminReczny) setTermin(dodajDni(d, terminFv)) }
  const kw = kwotaZPola(tekst)
  const kwR = Number.isFinite(kw) ? doGroszy(kw) : NaN
  const okKwota = Number.isFinite(kwR) && kwR !== 0
  const bladKwoty = tekst.trim() && !okKwota ? 'Wpisz kwotę różną od zera (ujemna = korekta)' : null
  const duplikat = numer.trim() ? karta.dokumenty.fv.find(d => !d.otwarcie && normNumer(d.numer) === normNumer(numer)) : undefined
  const bladNumeru = duplikat ? `Faktura ${duplikat.numer} jest już na karcie tego klienta` : null
  const bladDaty = !data ? 'Wpisz datę wystawienia'
    : data < karta.start ? `Faktura sprzed startu rozliczeń (${dataPl(karta.start)}) — wpisz ją w saldzie otwarcia` : null
  const bladTerminu = termin && data && termin < data ? 'Termin nie może być przed datą wystawienia' : null
  const kgL = kgTekst.trim() ? liczba(kgTekst) : null
  const bladKg = kgL !== null && !(Number.isFinite(kgL) && kgL >= 0) ? 'Wpisz liczbę kilogramów (0 lub więcej)' : null
  const ok = !!numer.trim() && okKwota && !bladNumeru && !bladDaty && !bladTerminu && !bladKg
  const tip = !numer.trim() ? 'Wpisz numer faktury' : !okKwota ? 'Wpisz kwotę brutto' : bladNumeru ?? bladDaty ?? bladTerminu ?? bladKg ?? undefined
  const korekta = okKwota && kwR < 0

  const zapisz = () => {
    if (!ok) return
    const nr = numer.trim().replace(/\s+/g, ' ')
    void zapis.zapisz(async () => {
      const kg = kgL === null ? {} : { kg: Math.round(kgL * 1000) / 1000 }
      await rozliczeniaApi.dodajFakture(karta.klient.id, { numer: nr, data, kwota: kwR, termin: termin || null, forma, uwagi: uwagi.trim(), ...kg })
      app.toast({
        kind: 'ok', title: `${korekta ? 'Korekta' : 'Faktura'} ${nr} dodana — ${kwota(kwR, w)}`,
        detail: [korekta ? 'zmniejsza dług w księdze faktur' : `termin ${termin ? dataPl(termin) : `za ${dni(terminFv)}`} · ${FORMA_SLOWEM[forma]}`,
          kgL !== null ? kilogramy(kgL) : ''].filter(Boolean).join(' · '),
      })
      onZapisano()
    })
  }

  return (
    <Dialog icon={<FilePlus2 size={20} />} onClose={onClose}
      title={<>Faktura <span className="rr-dlg-klient">{karta.klient.nazwa}</span></>}
      footer={<>
        <span className="left"><span className="kbd">Enter</span> zapisuje</span>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={tip} onClick={zapisz}>
          {zapis.busy ? 'Zapisuję…' : korekta ? 'Dodaj korektę' : 'Dodaj fakturę'}
        </button>
      </>}>
      <div className="rr-form">
        <label className="fld"><span className="label">Numer</span>
          <input className={`field${bladNumeru ? ' invalid' : ''}`} value={numer} aria-label="Numer" autoComplete="off"
            aria-invalid={bladNumeru ? true : undefined} onChange={e => setNumer(e.target.value)} onKeyDown={naEnter(zapisz)} data-autofocus />
          {bladNumeru && <span className="rr-pole-blad">{bladNumeru}</span>}
        </label>
        <label className="fld"><span className="label">Data wystawienia</span>
          <input type="date" className={`field${bladDaty ? ' invalid' : ''}`} value={data} min={karta.start} aria-label="Data wystawienia"
            aria-invalid={bladDaty ? true : undefined} onChange={e => zmienDate(e.target.value)} onKeyDown={naEnter(zapisz)} />
          {bladDaty && <span className="rr-pole-blad">{bladDaty}</span>}
        </label>
        <div className="fld"><span className="label">Kwota brutto ({w})</span>
          <PoleKwoty label="Kwota brutto" value={tekst} onChange={setTekst} waluta={w} blad={bladKwoty} onEnter={zapisz} duze />
          {!bladKwoty && <span className="rr-pole-pod">ujemna = faktura korygująca</span>}
        </div>
        <label className="fld"><span className="label">Termin</span>
          <input type="date" className={`field${bladTerminu ? ' invalid' : ''}`} value={termin} min={data || undefined} aria-label="Termin"
            aria-invalid={bladTerminu ? true : undefined} onChange={e => { setTermin(e.target.value); setTerminReczny(true) }} onKeyDown={naEnter(zapisz)} />
          {bladTerminu
            ? <span className="rr-pole-blad">{bladTerminu}</span>
            : terminReczny
              ? <span className="rr-pole-pod">zmieniony ręcznie · <button type="button" className="rr-link"
                  onClick={() => { setTerminReczny(false); setTermin(dodajDni(data, terminFv)) }}>{`wróć do ${dni(terminFv)}`}</button></span>
              : <span className="rr-pole-pod">{`data wystawienia + ${dni(terminFv)} (ustawienia klienta)`}</span>}
        </label>
        <div className="fld"><span className="label">Forma</span>
          <Segment label="Forma" value={forma} opcje={FORMY} onChange={setForma} />
        </div>
        <label className="fld"><span className="label">Kilogramy (opcjonalnie)</span>
          <span className="rr-kwota-pole">
            <input className={`field num${bladKg ? ' invalid' : ''}`} inputMode="decimal" autoComplete="off" value={kgTekst} aria-label="Kilogramy"
              aria-invalid={bladKg ? true : undefined} onChange={e => setKgTekst(e.target.value)} onKeyDown={naEnter(zapisz)} />
            <span className="rr-sfx" aria-hidden="true">kg</span>
          </span>
          {bladKg ? <span className="rr-pole-blad">{bladKg}</span> : <span className="rr-pole-pod">wchodzi do „Sprzedane kg”</span>}
        </label>
        <label className="fld rr-form-cala"><span className="label">Uwagi</span>
          <input className="field" value={uwagi} aria-label="Uwagi"
            onChange={e => setUwagi(e.target.value)} onKeyDown={naEnter(zapisz)} />
        </label>
      </div>
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}
