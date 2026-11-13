import React, { useMemo, useRef, useState } from 'react'
import { BookOpen, ArrowUp, ArrowDown, X, Plus, Droplets } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { recipesApi, type RecipeUsage } from '@/lib/api'
import type { Ingredient, Recipe } from '@/features/ingredients/types'
import type { ProductType } from '@/features/products/types'
import {
  bledy, dawka, doDto, liczba, nowyKlucz, odcisk, pierwszyBrak, podsumowanieFormularza, proc1, przesun,
  wodaNaKoniec, wodaNieNaKoncu, wypelniony, zOgonem, type Formularz, type WierszSkladu,
} from './model'

export interface MaterialType { id: string; name: string }

/**
 * Nowa / edycja / kopia receptury. Siatka składników pisana z klawiatury jak
 * edytor zamówienia: wpisz „van”, Enter → dawka, Enter → następny składnik.
 * Ostatni wiersz zawsze pusty, więc nie ma przycisku „Dodaj składnik”.
 */
export function EdytorReceptury({ start, edytowana, lista, skladniki, rodzaje, mieso, uzycie, onClose, onZapisana }: {
  start: Formularz
  /** Receptura edytowana (brak = nowa albo kopia). */
  edytowana?: Recipe
  /** Wszystkie aktywne receptury — do sprawdzenia, czy nazwa nie jest zajęta. */
  lista: Recipe[]
  skladniki: Ingredient[]
  rodzaje: ProductType[]
  mieso: MaterialType[]
  uzycie?: RecipeUsage
  onClose: () => void
  onZapisana: (r: Recipe) => void
}) {
  const [f, setF] = useState<Formularz>(start)
  const [pokazBledy, setPokazBledy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [porzucic, setPorzucic] = useState(false)
  const [pokazKomp, setPokazKomp] = useState(start.komponenty.length > 0)
  const poczatek = useRef(odcisk(start))
  const zmieniony = odcisk(f) !== poczatek.current

  const mapa = useMemo(() => new Map(skladniki.map(i => [i.id, i])), [skladniki])
  // Składnik wycofany z magazynu, a wciąż w recepturze — zostaje na liście, inaczej pole pokazałoby pustkę.
  const items = useMemo<WyborItem[]>(() => {
    const aktywne = skladniki.filter(i => i.active || f.wiersze.some(w => w.ingredientId === i.id))
    return aktywne.sort((a, b) => a.name.localeCompare(b.name, 'pl')).map(i => ({
      id: i.id, label: i.name,
      sub: [i.code, i.isUnlimited ? 'bez stanu (woda)' : i.unit, i.active ? null : 'wycofany z magazynu'].filter(Boolean).join(' · '),
    }))
  }, [skladniki, f.wiersze])
  const rodzajItems = useMemo<WyborItem[]>(() => rodzaje.filter(p => p.active !== false || p.id === f.rodzajId)
    .map(p => ({ id: p.id, label: p.name, sub: (p.components?.length ?? 0) > 1 ? p.components.map(c => `${c.pct}% ${c.name}`).join(' + ') : undefined })), [rodzaje, f.rodzajId])
  const rodzaj = rodzaje.find(p => p.id === f.rodzajId)
  const skladZRodzaju = (rodzaj?.components?.length ?? 0) > 1

  const zajete = useMemo(() => new Set(lista.filter(r => r.id !== edytowana?.id).map(r => r.name.trim().toLocaleLowerCase('pl'))), [lista, edytowana])
  const b = bledy(f, { nazwyZajete: zajete, skladniki: mapa })
  const brak = pierwszyBrak(b, f)
  const pods = podsumowanieFormularza(f)
  const woda = wodaNieNaKoncu(f, mapa)
  const pelne = f.wiersze.filter(wypelniony)
  const zmianaNazwy = !!edytowana && f.nazwa.trim() !== edytowana.name
  const wToku = (uzycie?.openOrders ?? 0) + (uzycie?.plannedMixing ?? 0) > 0

  const ustaw = (p: Partial<Formularz>) => { setF(s => ({ ...s, ...p })); setBlad(null) }
  const ustawWiersz = (klucz: string, p: Partial<WierszSkladu>) =>
    setF(s => ({ ...s, wiersze: zOgonem(s.wiersze.map(w => w.klucz === klucz ? { ...w, ...p } : w)) }))
  const usunWiersz = (klucz: string) => setF(s => ({ ...s, wiersze: zOgonem(s.wiersze.filter(w => w.klucz !== klucz)) }))
  // Skok od razu, nie w rAF — w rAF szybko wpisana cyfra lądowała w poprzednim polu (ta sama pułapka co w edytorze zamówienia).
  // rAF tylko wtedy, gdy pola jeszcze nie ma w DOM.
  const fokus = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    if (el) el.focus(); else requestAnimationFrame(() => (document.getElementById(id) as HTMLInputElement | null)?.focus())
  }
  const naNastepny = (klucz: string) => {
    // Enter w dawce → składnik następnego wiersza. Ogon istnieje już od wyboru składnika w tym wierszu.
    const i = f.wiersze.findIndex(x => x.klucz === klucz)
    const nast = f.wiersze[i + 1]
    if (nast) fokus(`rc-skl-${nast.klucz}`)
    else { const w = zOgonem(f.wiersze); setF(s => ({ ...s, wiersze: zOgonem(s.wiersze) })); fokus(`rc-skl-${w[w.length - 1].klucz}`) }
  }

  const zapisz = async () => {
    if (busy) return
    if (brak) { setPokazBledy(true); fokus(brak.pole); return }
    setBusy(true); setBlad(null)
    try {
      const dto = doDto(f, rodzaj?.name ?? '')
      const r = edytowana ? await recipesApi.update(edytowana.id, dto) : await recipesApi.create(dto)
      onZapisana(r)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać receptury')
    } finally { setBusy(false) }
  }
  const zamknij = () => { if (zmieniony && !porzucic) setPorzucic(true); else onClose() }
  const klawisz = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void zapisz() }
  }

  const blS = (k: string) => (pokazBledy ? b.wiersze[k] : undefined)
  const tytul = edytowana ? `Edytuj recepturę: ${edytowana.name}` : start.wiersze.some(wypelniony) ? 'Nowa receptura (kopia składu)' : 'Nowa receptura'

  return (
    <Dialog xl title={tytul} icon={<BookOpen size={20} />} onClose={zamknij}
      footer={<>
        <span className="rc-skroty muted">Enter — dalej · Alt+↑↓ — kolejność · Ctrl+S — zapisz · Esc — zamknij</span>
        <button className="btn" onClick={zamknij}>Anuluj</button>
        <button className="btn primary" aria-disabled={!!brak || busy || undefined} data-tip={brak ? brak.tekst : undefined}
          onClick={() => void zapisz()}>{busy ? 'Zapisuję…' : edytowana ? 'Zapisz zmiany' : 'Zapisz recepturę'}</button>
      </>}>
      <div className="rc-edytor" onKeyDown={klawisz}>
        {porzucic && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} />
          <div><b>Porzucić zmiany w recepturze?</b> Wpisane składniki i dawki nie zostaną zapisane.
            <div className="rc-akcje-notki"><button className="btn sm danger" onClick={onClose}>Porzuć zmiany</button><button className="btn sm" data-autofocus onClick={() => setPorzucic(false)}>Wróć do edycji</button></div></div></div>}

        <div className="rc-glowa">
          <label className="fld rc-f-nazwa"><span className="label">Nazwa receptury</span>
            <input id="rc-nazwa" className={`field${pokazBledy && b.nazwa ? ' invalid' : ''}`} value={f.nazwa} autoFocus data-autofocus
              onChange={e => ustaw({ nazwa: e.target.value })} placeholder="np. KIRMIZI" aria-label="Nazwa receptury" aria-invalid={!!(pokazBledy && b.nazwa)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fokus('rc-rodzaj') } }} />
            {pokazBledy && b.nazwa && <span className="fld-err">{b.nazwa}</span>}
            {!pokazBledy && b.nazwa && f.nazwa.trim() && <span className="fld-err">{b.nazwa}</span>}</label>
          <label className="fld rc-f-rodzaj"><span className="label">Rodzaj produktu</span>
            <Wybor id="rc-rodzaj" label="Rodzaj produktu" items={rodzajItems} value={f.rodzajId} noneLabel="— bez przypisania —"
              onChange={v => ustaw({ rodzajId: v })} onDalej={() => fokus('rc-termin')} placeholder="Wpisz rodzaj…" /></label>
          <label className="fld rc-f-krotkie"><span className="label">Termin przydatności</span>
            <span className="rc-jedn"><input id="rc-termin" className={`field num${pokazBledy && b.termin ? ' invalid' : ''}`} inputMode="numeric" value={f.termin}
              onChange={e => ustaw({ termin: e.target.value.replace(/[^\d]/g, '') })} aria-label="Termin przydatności (dni)"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fokus('rc-minuty') } }} /><span>dni</span></span>
            {pokazBledy && b.termin && <span className="fld-err">{b.termin}</span>}</label>
          <label className="fld rc-f-krotkie"><span className="label">Czas masowania</span>
            <span className="rc-jedn"><input id="rc-minuty" className={`field num${b.minuty ? ' invalid' : ''}`} inputMode="numeric" value={f.minuty} placeholder="50"
              onChange={e => ustaw({ minuty: e.target.value.replace(/[^\d]/g, '') })} aria-label="Czas masowania (min)"
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fokus(`rc-skl-${f.wiersze[0]?.klucz}`) } }} /><span>min</span></span>
            {b.minuty ? <span className="fld-err">{b.minuty}</span> : <span className="fld-hint">puste = standardowe 50 min</span>}</label>
        </div>

        <div className="rc-uklad">
          <section className="rc-sklad" aria-label="Składniki na 100 kg mięsa">
            <div className="rc-sekcja"><h3>Składniki <span className="muted">na 100 kg mięsa</span></h3>
              {woda && <button type="button" className="btn sm" onClick={() => setF(s => wodaNaKoniec(s, mapa))} data-tip="Woda zawsze ostatnia — w tej kolejności operator dodaje składniki z wydruku planu masowania"><Droplets size={14} />Przenieś wodę na koniec</button>}
            </div>
            {woda && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Woda nie jest ostatnia. Operator dodaje składniki w kolejności z wydruku planu masowania — woda zawsze na końcu.</div></div>}
            <table className="tbl rc-siatka">
              <thead><tr><th className="c" style={{ width: 34 }}>Lp.</th><th>Składnik z magazynu</th><th className="num" style={{ width: 130 }}>Dawka</th><th style={{ width: 44 }}>Jedn.</th><th className="num" style={{ width: 88 }}>Udział</th><th style={{ width: 96 }} /></tr></thead>
              <tbody>
                {f.wiersze.map((w, i) => {
                  const ing = mapa.get(w.ingredientId)
                  const e = blS(w.klucz)
                  const ogon = !wypelniony(w) && i === f.wiersze.length - 1
                  const poz = pelne.findIndex(x => x.klucz === w.klucz)
                  return (
                    <tr key={w.klucz} className={`row${ogon ? ' rc-ogon' : ''}`}
                      onKeyDown={ev => { if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ogon) { ev.preventDefault(); setF(s => przesun(s, w.klucz, ev.key === 'ArrowUp' ? -1 : 1)) } }}>
                      <td className="c muted tnum">{ogon ? <Plus size={13} aria-hidden /> : i + 1}</td>
                      <td className={e?.skladnik ? 'rc-blad' : undefined}>
                        <Wybor id={`rc-skl-${w.klucz}`} label={`Składnik ${i + 1}`} items={items} value={w.ingredientId}
                          onChange={v => ustawWiersz(w.klucz, { ingredientId: v })} onDalej={() => fokus(`rc-dawka-${w.klucz}`)}
                          placeholder={ogon ? (pelne.length ? 'Następny składnik…' : 'Wpisz nazwę składnika…') : 'Wybierz składnik…'} invalid={!!e?.skladnik}
                          pusto={skladniki.length ? 'Nic nie pasuje' : 'Brak składników w magazynie przypraw'} />
                        {e?.skladnik && <span className="fld-err">{e.skladnik}</span>}
                      </td>
                      <td className={`num${e?.dawka ? ' rc-blad' : ''}`}>
                        <input id={`rc-dawka-${w.klucz}`} className={`field num${e?.dawka ? ' invalid' : ''}`} inputMode="decimal" value={w.dawka} placeholder={ogon ? '' : '0,000'}
                          onChange={ev => ustawWiersz(w.klucz, { dawka: ev.target.value.replace(/[^\d.,]/g, '') })} aria-label={`Dawka ${i + 1}`} aria-invalid={!!e?.dawka}
                          onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); naNastepny(w.klucz) } }} />
                        {e?.dawka && <span className="fld-err">{e.dawka}</span>}
                      </td>
                      <td className="muted">{ing ? ing.unit : ''}</td>
                      <td className="num muted">{wypelniony(w) && liczba(w.dawka) > 0 ? proc1(pods.udzialy[w.klucz] ?? 0) : ''}</td>
                      <td className="r rc-wiersz-akcje">{!ogon && <>
                        <button type="button" className="btn ghost icon sm" tabIndex={-1} disabled={poz <= 0} onClick={() => setF(s => przesun(s, w.klucz, -1))} aria-label={`Wyżej: wiersz ${i + 1}`} data-tip="Wyżej (Alt+↑)"><ArrowUp size={14} /></button>
                        <button type="button" className="btn ghost icon sm" tabIndex={-1} disabled={poz >= pelne.length - 1} onClick={() => setF(s => przesun(s, w.klucz, 1))} aria-label={`Niżej: wiersz ${i + 1}`} data-tip="Niżej (Alt+↓)"><ArrowDown size={14} /></button>
                        <button type="button" className="btn ghost icon sm danger" tabIndex={-1} onClick={() => usunWiersz(w.klucz)} aria-label={`Usuń wiersz ${i + 1}`} data-tip="Usuń składnik"><X size={14} /></button>
                      </>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {pokazBledy && b.sklad && <div className="fld-err" role="alert">{b.sklad}</div>}
          </section>

          <aside className="rc-bilans" aria-label="Bilans receptury">
            <h3>Bilans na 100 kg mięsa</h3>
            <dl>
              <div><dt>Mięso</dt><dd>100 kg</dd></div>
              <div><dt>Składniki ({pelne.filter(w => liczba(w.dawka) > 0).length})</dt><dd>+ {dawka(pods.suma)} kg</dd></div>
              <div className="rc-razem"><dt>Półprodukt</dt><dd>{dawka(pods.polprodukt)} kg</dd></div>
            </dl>
            <p className="muted rc-przyrost">Przyrost masy <b>{proc1(pods.przyrost)}</b> — tyle kg więcej niż mięsa idzie z masownicy.</p>
            {edytowana && Math.abs(pods.polprodukt - edytowana.totalOutputPer100kg) > 0.0005 && (
              <p className="muted">Było {dawka(edytowana.totalOutputPer100kg)} kg ({pods.polprodukt > edytowana.totalOutputPer100kg ? '+' : '−'}{dawka(Math.abs(pods.polprodukt - edytowana.totalOutputPer100kg))} kg).</p>
            )}
          </aside>
        </div>

        <section className="rc-komp" id="rc-komponenty" tabIndex={-1} aria-label="Skład produkcyjny">
          {skladZRodzaju ? (
            <div className="note"><FlagIcon level="info" size={15} /><div><b>Skład produkcyjny bierzemy z rodzaju „{rodzaj!.name}”:</b> {rodzaj!.components.map(c => `${c.pct}% ${c.name}`).join(' + ')}. Zmienia się go w kartotece rodzajów, nie w recepturze.</div></div>
          ) : !pokazKomp ? (
            <button type="button" className="btn sm ghost" onClick={() => { setPokazKomp(true); ustaw({ komponenty: [{ klucz: nowyKlucz(), materialTypeId: '', materialName: '', pct: '' }] }) }}>
              <Plus size={14} />Skład z kilku rodzajów mięsa (np. 70% mięso z/s + 30% filet)</button>
          ) : (<>
            <div className="rc-sekcja"><h3>Skład produkcyjny <span className="muted">komponenty mięsa</span></h3>
              <button type="button" className="btn sm ghost" onClick={() => ustaw({ komponenty: [...f.komponenty, { klucz: nowyKlucz(), materialTypeId: '', materialName: '', pct: '' }] })}><Plus size={14} />Komponent</button></div>
            <div className="rc-komp-lista">
              {f.komponenty.map((k, i) => (
                <div key={k.klucz} className="rc-komp-w">
                  <select className="field" value={k.materialTypeId} aria-label={`Komponent ${i + 1}`}
                    onChange={e => { const m = mieso.find(x => x.id === e.target.value); ustaw({ komponenty: f.komponenty.map(x => x.klucz === k.klucz ? { ...x, materialTypeId: e.target.value, materialName: m?.name ?? '' } : x) }) }}>
                    <option value="">Rodzaj mięsa…</option>
                    {mieso.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <span className="rc-jedn"><input className="field num" inputMode="decimal" value={k.pct} aria-label={`Udział komponentu ${i + 1}`}
                    onChange={e => ustaw({ komponenty: f.komponenty.map(x => x.klucz === k.klucz ? { ...x, pct: e.target.value.replace(/[^\d.,]/g, '') } : x) })} /><span>%</span></span>
                  <button type="button" className="btn ghost icon sm danger" onClick={() => { const n = f.komponenty.filter(x => x.klucz !== k.klucz); ustaw({ komponenty: n }); if (!n.length) setPokazKomp(false) }} aria-label={`Usuń komponent ${i + 1}`}><X size={14} /></button>
                </div>
              ))}
            </div>
            {b.komponenty && <span className="fld-err">{b.komponenty}</span>}
            <p className="muted rc-przyrost">Partie każdego komponentu dobiera system (FEFO); wyrób dostaje partię łączoną, np. „120626 355/356”.</p>
          </>)}
        </section>

        <label className="fld"><span className="label">Uwagi</span>
          <textarea className="field" rows={2} value={f.uwagi} onChange={e => ustaw({ uwagi: e.target.value })} placeholder="np. dla klienta VATAN, próbka" aria-label="Uwagi" /></label>

        {edytowana && wToku && <div className="note"><FlagIcon level="info" size={15} /><div>
          Receptura jest w użyciu{uzycie!.openOrders ? ` — ${uzycie!.openOrders} otwartych zamówień` : ''}{uzycie!.plannedMixing ? `, ${uzycie!.plannedMixing} niedokończonych masowań` : ''}.
          Nowe dawki obejmą zaplanowane masowania i zapotrzebowanie na przyprawy. Partie już zmasowane zostają bez zmian.</div></div>}
        {zmianaNazwy && wToku && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Zmiana nazwy nie zmienia jej w już złożonych zamówieniach i wystawionych dokumentach — tam zostaje „{edytowana!.name}”.</div></div>}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      </div>
    </Dialog>
  )
}
