import React, { useMemo, useRef, useState } from 'react'
import { Building2, Plus, X } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, suppliersApi } from '@/lib/api'
import type { Client } from '@/lib/mockApi'
import type { Supplier } from '@/types'
import { PobierzDane } from './PobierzDane'
import { JEZYKI_HDI, bledy, doDtoDostawcy, doDtoKlienta, jezykZKraju, krajDlaFormularza, type Formularz, type Rodzaj } from './model'

type Pole = keyof Formularz

/**
 * Nowy / edycja kontrahenta. U góry pobranie danych po NIP albo VAT UE,
 * niżej karta w sekcjach. Enter w polu albo Ctrl+S — zapis; Esc — zamknij
 * (przy zmianach pyta, czy porzucić).
 */
export function EdytorKontrahenta({ rodzaj, start, id, onClose, onZapisany }: {
  rodzaj: Rodzaj; start: Formularz; id?: string; onClose: () => void; onZapisany: (row: Client | Supplier) => void
}) {
  const [f, setF] = useState<Formularz>(start)
  const [pokazBledy, setPokazBledy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [porzucic, setPorzucic] = useState(false)
  const poczatek = useRef(JSON.stringify(start))
  const zmieniony = JSON.stringify(f) !== poczatek.current
  const odbiorca = rodzaj === 'odbiorcy'
  const recepturyRes = useApi(() => (odbiorca ? recipesApi.list() : Promise.resolve([])), [odbiorca])
  const receptury = useMemo(() => ((recepturyRes.data ?? []) as Array<{ id: string; name: string }>).slice().sort((a, b) => a.name.localeCompare(b.name, 'pl')), [recepturyRes.data])

  const b = bledy(f, rodzaj)
  const pierwszyBlad = (Object.keys(b) as Pole[])[0]
  const ustaw = (p: Partial<Formularz>) => { setF(s => ({ ...s, ...p })); setBlad(null) }

  const zapisz = async () => {
    if (busy) return
    if (pierwszyBlad) { setPokazBledy(true); document.getElementById(`kh-${pierwszyBlad}`)?.focus(); return }
    setBusy(true); setBlad(null)
    try {
      const row = odbiorca
        ? (id ? await clientsApi.update(id, doDtoKlienta(f)) : await clientsApi.create(doDtoKlienta(f)))
        : (id ? await suppliersApi.update(id, doDtoDostawcy(f)) : await suppliersApi.create(doDtoDostawcy(f)))
      onZapisany(row as Client | Supplier)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać kontrahenta')
    } finally { setBusy(false) }
  }
  const zamknij = () => { if (zmieniony && !porzucic) setPorzucic(true); else onClose() }
  const klawisz = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void zapisz() }
  }
  const enterZapisuje = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void zapisz() } }

  const pole = (k: Pole, etykieta: string, opts: { ph?: string; wide?: boolean; hint?: string; upper?: boolean; autoFocus?: boolean } = {}) => {
    const err = pokazBledy ? b[k] : undefined
    return (
      <label className={`fld${opts.wide ? ' kh-wide' : ''}`}>
        <span className="label">{etykieta}</span>
        <input id={`kh-${k}`} className={`field${err ? ' invalid' : ''}`} value={String(f[k] ?? '')} placeholder={opts.ph} aria-label={etykieta} aria-invalid={!!err}
          autoFocus={opts.autoFocus} data-autofocus={opts.autoFocus || undefined}
          onChange={e => ustaw({ [k]: opts.upper ? e.target.value.toUpperCase() : e.target.value } as Partial<Formularz>)} onKeyDown={enterZapisuje} />
        {err ? <span className="fld-err">{err}</span> : opts.hint ? <span className="fld-hint">{opts.hint}</span> : null}
      </label>
    )
  }
  const ptaszek = (k: Pole, etykieta: string, tip?: string) => (
    <label className="kh-cbx" data-tip={tip}><input type="checkbox" className="cbx" checked={!!f[k]} onChange={e => ustaw({ [k]: e.target.checked } as Partial<Formularz>)} />{etykieta}</label>
  )
  const przejmij = (nowe: Formularz) => {
    const kraj = krajDlaFormularza(nowe)
    setF(odbiorca && !nowe.language ? { ...nowe, language: jezykZKraju(kraj) } : nowe)
  }
  const ustawNazweReceptury = (i: number, p: Partial<{ recipeId: string; name: string }>) =>
    ustaw({ hdiRecipeNames: f.hdiRecipeNames.map((n, j) => (j === i ? { ...n, ...p } : n)) })

  const nazwaRodzaju = odbiorca ? 'odbiorcę' : 'dostawcę'
  const tytul = id ? `Edytuj: ${start.displayName || start.name}` : odbiorca ? 'Nowy odbiorca' : 'Nowy dostawca'

  return (
    <Dialog xl title={tytul} icon={<Building2 size={20} />} onClose={zamknij}
      footer={<>
        <span className="muted kh-skroty">Enter / Ctrl+S — zapisz · Esc — zamknij</span>
        <button className="btn" onClick={zamknij}>Anuluj</button>
        <button className="btn primary" onClick={() => void zapisz()} aria-disabled={busy || undefined}>{busy ? 'Zapisuję…' : id ? 'Zapisz zmiany' : 'Zapisz kontrahenta'}</button>
      </>}>
      <div className="kh-edytor" onKeyDown={klawisz}>
        {porzucic && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} />
          <div><b>Porzucić zmiany?</b> Wpisane dane nie zostaną zapisane.
            <div className="row-wrap" style={{ marginTop: 6 }}><button className="btn sm danger" onClick={onClose}>Porzuć zmiany</button><button className="btn sm" data-autofocus onClick={() => setPorzucic(false)}>Wróć do edycji</button></div></div></div>}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie zapisano:</b> {blad}</div></div>}

        <PobierzDane form={f} nowy={!id} onPrzejmij={przejmij} />

        <section className="kh-sekcja" aria-label="Firma"><h3>Firma</h3>
          <div className="kh-siatka">
            {pole('name', 'Pełna nazwa', { wide: true, hint: 'jak w rejestrze — idzie na dokumenty i wykazy HACCP', autoFocus: !id })}
            {pole('displayName', 'Nazwa wyświetlana', { ph: 'np. YALCIN', upper: true, hint: 'krótka nazwa na listach biura' })}
            {pole('nip', odbiorca && krajDlaFormularza(f) !== 'PL' ? 'VAT UE' : 'NIP / VAT UE', { ph: 'PL: 10 cyfr, UE: z kodem kraju' })}
            {pole('regon', 'REGON')}
            {pole('country', 'Kraj', { ph: krajDlaFormularza({ ...f, country: '' }), upper: true, hint: 'dwie litery; puste = z numeru VAT' })}
          </div>
        </section>
        <section className="kh-sekcja" aria-label="Adres"><h3>Adres</h3>
          <div className="kh-siatka">
            {pole('address', 'Ulica i numer', { wide: true, ph: 'np. Długa 69B/3' })}
            {pole('postalCode', 'Kod pocztowy', { ph: krajDlaFormularza(f) === 'PL' ? '00-000' : '' })}
            {pole('city', 'Miasto')}
          </div>
        </section>
        <section className="kh-sekcja" aria-label="Kontakt"><h3>Kontakt</h3>
          <div className="kh-siatka">
            {pole('contactName', 'Osoba kontaktowa')}
            {pole('phone', 'Telefon')}
            {pole('email', 'E-mail')}
          </div>
        </section>

        {odbiorca && <>
          <section className="kh-sekcja" aria-label="Dokumenty"><h3>Dokumenty</h3>
            <div className="kh-siatka">
              <label className="fld"><span className="label">Język HDI</span>
                <select className="field" value={f.language} onChange={e => ustaw({ language: e.target.value })} aria-label="Język HDI">
                  {JEZYKI_HDI.map(j => <option key={j.v} value={j.v}>{j.l}</option>)}</select></label>
              <label className="fld kh-wide"><span className="label">Nazwa pozycji na HDI</span>
                <select className="field" value={f.hdiNameMode} onChange={e => ustaw({ hdiNameMode: e.target.value as Formularz['hdiNameMode'] })} aria-label="Nazwa pozycji na HDI">
                  <option value="type_recipe">Rodzaj i receptura — np. KEBAB UDO BEYAZ AFIYET 20KG</option>
                  <option value="type">Sam rodzaj — np. KEBAB UDO 20KG</option>
                  <option value="recipe">Sama receptura — np. BEYAZ AFIYET 20KG</option>
                </select></label>
            </div>
            <div className="kh-ptaszki">
              {ptaszek('wzUsesHdiNames', 'Te same nazwy na WZ')}
              {ptaszek('halalSupervision', 'Nadzór HALAL', 'Etykieta z kodem nadzoru HALAL')}
              {ptaszek('uslugi', 'Produkcja na usługę', 'W zamówieniu pole „Usługa” przy pozycji')}
            </div>
            <div className="kh-receptury">
              <span className="label">Własne nazwy receptur tego odbiorcy</span>
              {f.hdiRecipeNames.map((n, i) => (
                <div key={i} className="kh-rec-wiersz">
                  <select className="field" value={n.recipeId} onChange={e => ustawNazweReceptury(i, { recipeId: e.target.value })} aria-label={`Receptura ${i + 1}`}>
                    <option value="">— receptura —</option>
                    {receptury.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <input className="field" value={n.name} placeholder="nazwa na dokumencie" onChange={e => ustawNazweReceptury(i, { name: e.target.value.toUpperCase() })} aria-label={`Nazwa na dokumencie ${i + 1}`} />
                  <button type="button" className="btn ghost icon sm danger" onClick={() => ustaw({ hdiRecipeNames: f.hdiRecipeNames.filter((_, j) => j !== i) })} aria-label={`Usuń nazwę ${i + 1}`}><X size={14} /></button>
                </div>))}
              <button type="button" className="btn sm ghost" onClick={() => ustaw({ hdiRecipeNames: [...f.hdiRecipeNames, { recipeId: '', name: '' }] })}><Plus size={14} />Dodaj nazwę receptury</button>
            </div>
          </section>
          <section className="kh-sekcja" aria-label="Miejsce przeznaczenia"><h3>Miejsce przeznaczenia <span className="muted">puste = adres odbiorcy</span></h3>
            <div className="kh-siatka">
              {pole('destName', 'Nazwa miejsca')}
              {pole('destAddress', 'Adres miejsca', { wide: true })}
              {pole('destCity', 'Kod i miasto miejsca')}
            </div>
            <div className="kh-ptaszki">
              {ptaszek('destForHdi', 'Na HDI (rozładunek)')}
              {ptaszek('destForCmr', 'Na CMR (pole 3)')}
            </div>
          </section>
        </>}

        {!odbiorca && <section className="kh-sekcja" aria-label="Weterynaria i HACCP"><h3>Weterynaria i HACCP</h3>
          <div className="kh-siatka">
            {pole('vetNumber', 'Weterynaryjny numer identyfikacyjny (WNI)')}
            {pole('supplyScope', 'Zakres dostaw (karta 1.3.2)', { wide: true, ph: 'np. folie, etykiety, przyprawy' })}
          </div>
        </section>}
        <p className="faint kh-stopka">Zapisujesz {nazwaRodzaju} w kartotece — te same dane widzi stary MES.</p>
      </div>
    </Dialog>
  )
}
