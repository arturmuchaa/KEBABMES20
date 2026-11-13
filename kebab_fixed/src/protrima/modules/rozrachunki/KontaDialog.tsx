import React, { useEffect, useState } from 'react'
import { Landmark } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { rozliczeniaApi, type KontaDoWplat, type RachunekBankowy } from '@/lib/api'
import { numerRachunku } from '@/features/rozliczenia/KontoDoWplat'
import { OdmowaSerwera, naEnter, useZapis } from './wspolne'

const PUSTE: KontaDoWplat = { pln: { numer: '', bank: '', swift: '' }, eur: { numer: '', bank: '', swift: '' } }
const czysty = (n: string) => n.replace(/\s+/g, '').toUpperCase()
/** Numer: litery i cyfry, 10–42 znaki bez spacji (NRB 26 cyfr albo IBAN). Pusty = nie podano. */
export const bladNumeru = (n: string) => (!n.trim() || /^[A-Z0-9]{10,34}$/.test(czysty(n)) ? null : 'Numer rachunku: same litery i cyfry (NRB 26 cyfr albo IBAN)')
export const bladSwift = (s: string) => (!s.trim() || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(czysty(s)) ? null : 'SWIFT/BIC ma 8 albo 11 znaków')

/**
 * Rachunki bankowe do wpłat — osobno PLN i EUR. Klient widzi rachunek w swojej
 * walucie na zestawieniu należności, historii rozliczeń i pod WZ
 * (właściciel 13.11.2026: „aby na dokumencie klient widział numer rachunku do wpłat”).
 */
export function KontaDialog({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [k, setK] = useState<KontaDoWplat | null>(null)
  const [bladWczytania, setBladWczytania] = useState<string | null>(null)
  const zapis = useZapis('Nie udało się zapisać rachunków')
  useEffect(() => {
    let zywe = true
    rozliczeniaApi.konta().then(x => { if (zywe) setK({ ...PUSTE, ...x }) })
      .catch(e => { if (zywe) setBladWczytania(e instanceof Error ? e.message : 'Nie udało się wczytać rachunków') })
    return () => { zywe = false }
  }, [])
  const ustaw = (w: 'pln' | 'eur', pole: keyof RachunekBankowy, v: string) => setK(s => (s ? { ...s, [w]: { ...s[w], [pole]: v } } : s))
  const bledy = k ? (['pln', 'eur'] as const).flatMap(w => [bladNumeru(k[w].numer), bladSwift(k[w].swift)]).filter(Boolean) : []
  const ok = !!k && bledy.length === 0
  const zapisz = () => {
    if (!ok || !k) return
    void zapis.zapisz(async () => {
      await rozliczeniaApi.ustawKonta({ pln: { ...k.pln, numer: czysty(k.pln.numer) }, eur: { ...k.eur, numer: czysty(k.eur.numer) } })
      app.toast({ kind: 'ok', title: 'Rachunki do wpłat zapisane', detail: 'Pojawią się na dokumentach dla klienta od następnego wydruku.' })
      onClose()
    })
  }
  const sekcja = (w: 'pln' | 'eur', tytul: string, podp: string) => {
    if (!k) return null
    const bn = bladNumeru(k[w].numer), bs = bladSwift(k[w].swift)
    return (
      <fieldset className="rr-konto" aria-label={tytul}>
        <legend>{tytul}</legend>
        <div className="rr-form">
          <label className="fld rr-form-cala"><span className="label">Numer rachunku</span>
            <input className={`field code${bn ? ' invalid' : ''}`} value={k[w].numer} autoComplete="off" spellCheck={false} aria-label={`Numer rachunku ${w.toUpperCase()}`}
              aria-invalid={bn ? true : undefined} placeholder={podp} onChange={e => ustaw(w, 'numer', e.target.value)}
              onBlur={() => !bn && ustaw(w, 'numer', numerRachunku(k[w].numer))} onKeyDown={naEnter(zapisz)} data-autofocus={w === 'pln' ? true : undefined} />
            {bn ? <span className="rr-pole-blad">{bn}</span> : <span className="rr-pole-pod">puste = rachunek {w.toUpperCase()} nie drukuje się na dokumentach</span>}
          </label>
          <label className="fld"><span className="label">Bank</span>
            <input className="field" value={k[w].bank} aria-label={`Bank ${w.toUpperCase()}`} onChange={e => ustaw(w, 'bank', e.target.value)} onKeyDown={naEnter(zapisz)} />
          </label>
          <label className="fld"><span className="label">SWIFT / BIC</span>
            <input className={`field code${bs ? ' invalid' : ''}`} value={k[w].swift} autoComplete="off" spellCheck={false} aria-label={`SWIFT ${w.toUpperCase()}`}
              aria-invalid={bs ? true : undefined} onChange={e => ustaw(w, 'swift', e.target.value.toUpperCase())} onKeyDown={naEnter(zapisz)} />
            {bs && <span className="rr-pole-blad">{bs}</span>}
          </label>
        </div>
      </fieldset>
    )
  }
  return (
    <Dialog icon={<Landmark size={20} />} title="Rachunki do wpłat" onClose={onClose}
      footer={<>
        <span className="left"><span className="kbd">Enter</span> zapisuje</span>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={bledy[0] ?? undefined} onClick={zapisz}>{zapis.busy ? 'Zapisuję…' : 'Zapisz rachunki'}</button>
      </>}>
      <div className="note info"><FlagIcon level="info" size={15} /><div>Klient zobaczy rachunek w walucie swoich rozliczeń na <b>zestawieniu należności</b>, <b>historii rozliczeń</b> i w tabelce salda pod <b>WZ</b>.</div></div>
      {bladWczytania && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{bladWczytania}</div></div>}
      {!k && !bladWczytania && <p className="muted">Wczytuję…</p>}
      {sekcja('pln', 'Rachunek w złotówkach (PLN)', 'np. 61 1090 1014 0000 0712 1981 2874')}
      {sekcja('eur', 'Rachunek w euro (EUR)', 'np. PL61 1090 1014 0000 0712 1981 2874')}
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}
