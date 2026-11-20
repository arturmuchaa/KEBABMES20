/**
 * Okno druku — jak w Subiekcie: drukarka i wszystkie opcje jej sterownika
 * (zasobnik, kolor, dwustronnie, papier, opcje Konica), zapamiętane dla
 * rodzaju dokumentu na tym komputerze. Spec: 2026-11-19-okno-druku-design.md
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { natywny } from './natywny'
import { NAZWA_RODZAJU, type RodzajDruku } from './rodzaje'
import type { Drukarka, Funkcja } from './typy'
import { czytajUstawienia, zapiszDokument, zapiszKolor } from './ustawienia'
import './okno-druku.css'

export type ZrodloDruku = { typ: 'strona' } | { typ: 'pdf'; pdfBase64: string }
export type WynikOkna =
  | { wydrukowano: true; drukarka: string; zasobnik: string; kopie: number; stron: number }
  | { wydrukowano: false }
  | { systemowe: true }

const NA_GORZE = ['PageInputBin', 'JobInputBin', 'PageOutputColor', 'JobDuplexAllDocumentsContiguously', 'PageMediaSize', 'PageMediaType']
const lokalna = (id: string) => id.slice(id.lastIndexOf('}') + 1)
const jestZasobnik = (f: Funkcja) => ['PageInputBin', 'JobInputBin'].includes(lokalna(f.id))
const tekstBledu = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function OknoDruku({ rodzaj, tytul, zrodlo, onZamknij }: {
  rodzaj: RodzajDruku; tytul: string; zrodlo: ZrodloDruku; onZamknij: (w: WynikOkna) => void
}) {
  const [drukarki, setDrukarki] = useState<Drukarka[]>([])
  const [drukarka, setDrukarka] = useState('')
  const [ticket, setTicket] = useState('')
  const [funkcje, setFunkcje] = useState<Funkcja[]>([])
  const [kopie, setKopie] = useState('1')
  const [kopieMax, setKopieMax] = useState(999)
  const [zakres, setZakres] = useState<'wszystkie' | 'od-do'>('wszystkie')
  const [od, setOd] = useState('1')
  const [doStr, setDoStr] = useState('')
  const [zapamietaj, setZapamietaj] = useState(true)
  const [kolory, setKolory] = useState<Record<string, Record<string, string>>>({})
  const [uwaga, setUwaga] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajete, setZajete] = useState<string | null>('Wczytywanie drukarek…')
  const pierwszy = useRef<HTMLSelectElement>(null)

  /** Wczytaj możliwości drukarki; przy pierwszym użyciu ustaw zasobnik 1 i czarno-biały. */
  async function wczytaj(nazwa: string, t: string | null, domyslne: boolean) {
    setZajete('Odczyt ustawień drukarki…')
    try {
      const m = await natywny.mozliwosci(nazwa, t)
      let tk = m.ticket
      let fs = m.funkcje
      const ustaw = async (fid: string, oid: string) => {
        tk = await natywny.ustawOpcje(tk, fid, oid)
        fs = fs.map(f => (f.id === fid ? { ...f, wybrana: oid } : f))
      }
      if (domyslne) {
        if (m.zasobnikDomyslny) await ustaw(m.zasobnikDomyslny[0], m.zasobnikDomyslny[1])
        const kolor = fs.find(f => lokalna(f.id) === 'PageOutputColor')
        const mono = kolor?.opcje.find(o => /Monochrome|Grayscale/.test(lokalna(o.id)))
        if (kolor && mono) await ustaw(kolor.id, mono.id)
      }
      setTicket(tk); setFunkcje(fs); setKopieMax(m.kopieMax || 999); setBlad(null)
    } catch (e) {
      setFunkcje([]); setBlad(`Nie można odczytać ustawień drukarki: ${tekstBledu(e)}`)
    } finally { setZajete(null) }
  }

  useEffect(() => {
    let zyje = true
    ;(async () => {
      try {
        const [lista, u] = await Promise.all([natywny.drukarki(), czytajUstawienia()])
        if (!zyje) return
        setDrukarki(lista); setKolory(u.koloryZasobnikow)
        const zapis = u.dokumenty[rodzaj]
        const domyslna = lista.find(d => d.domyslna)?.nazwa ?? lista[0]?.nazwa ?? ''
        const jest = zapis && lista.some(d => d.nazwa === zapis.drukarka)
        if (zapis && !jest) setUwaga(`Zapisana drukarka „${zapis.drukarka}” jest niedostępna — wybrano domyślną`)
        const nazwa = jest ? zapis!.drukarka : domyslna
        if (jest) setKopie(String(zapis!.kopie || 1))
        setDrukarka(nazwa)
        if (!nazwa) { setBlad('W tym komputerze nie ma żadnej drukarki'); setZajete(null); return }
        await wczytaj(nazwa, jest ? zapis!.ticket : null, !jest)
      } catch (e) {
        if (zyje) { setBlad(`Nie można odczytać drukarek: ${tekstBledu(e)}`); setZajete(null) }
      }
    })()
    return () => { zyje = false }
  }, [rodzaj]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!zajete) pierwszy.current?.focus() }, [zajete])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !zajete) onZamknij({ wydrukowano: false }) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [zajete, onZamknij])

  const [gora, reszta] = useMemo(() => [
    funkcje.filter(f => NA_GORZE.includes(lokalna(f.id))),
    funkcje.filter(f => !NA_GORZE.includes(lokalna(f.id))),
  ], [funkcje])
  const zasobnik = funkcje.find(jestZasobnik)
  const wybranyZasobnik = zasobnik?.opcje.find(o => o.id === zasobnik.wybrana)
  const koloryDrukarki = kolory[drukarka] ?? {}

  async function zmienOpcje(f: Funkcja, oid: string) {
    try {
      const t = await natywny.ustawOpcje(ticket, f.id, oid)
      setTicket(t)
      setFunkcje(fs => fs.map(x => (x.id === f.id ? { ...x, wybrana: oid } : x)))
    } catch (e) { setBlad(`Nie można zmienić ustawienia: ${tekstBledu(e)}`) }
  }

  async function zmienDrukarke(nazwa: string) {
    setDrukarka(nazwa); setUwaga(null)
    const u = await czytajUstawienia().catch(() => null)
    const zapis = u?.dokumenty[rodzaj]
    const tenSam = zapis?.drukarka === nazwa
    await wczytaj(nazwa, tenSam ? zapis!.ticket : null, !tenSam)
  }

  async function ustawieniaSterownika() {
    try {
      const t = await natywny.ustawieniaSterownika(drukarka, ticket)
      await wczytaj(drukarka, t, false)
    } catch (e) { setBlad(`Okno ustawień drukarki nie otworzyło się: ${tekstBledu(e)}`) }
  }

  async function zapiszKolorZasobnika(opcjaId: string, kolor: string) {
    try {
      await zapiszKolor(drukarka, opcjaId, kolor)
      setKolory(k => {
        const m = { ...(k[drukarka] ?? {}) }
        if (kolor.trim()) m[opcjaId] = kolor.trim(); else delete m[opcjaId]
        return { ...k, [drukarka]: m }
      })
    } catch { /* kolor to wygoda — błąd zapisu nie przerywa druku */ }
  }

  async function drukuj(e?: React.FormEvent) {
    e?.preventDefault()
    if (zajete || !drukarka) return
    const n = Math.max(1, Math.min(kopieMax, Math.floor(Number(kopie) || 1)))
    setBlad(null); setZajete('Drukowanie…')
    try {
      const pdf = zrodlo.typ === 'pdf' ? zrodlo.pdfBase64 : await natywny.stronaPdf()
      // Kartki palet zawsze w całości: rejestr oznacza palety, nie strony (przegląd I8).
      const zakresStron = zakres === 'od-do' && rodzaj !== 'kartki-palet'
        ? { od: Number(od) || undefined, do: doStr.trim() ? Number(doStr) : undefined } : {}
      const stron = await natywny.drukujPdf({ drukarka, pdfBase64: pdf, ticket, kopie: n, tytul, ...zakresStron })
      if (zapamietaj) await zapiszDokument(rodzaj, { drukarka, ticket, kopie: n }).catch(() => {})
      onZamknij({ wydrukowano: true, drukarka, zasobnik: wybranyZasobnik?.nazwa ?? '', kopie: n, stron })
    } catch (err) {
      setBlad(`Nie udało się wydrukować: ${tekstBledu(err)}`)
      setZajete(null)
    }
  }

  const pole = (f: Funkcja, i: number) => {
    const id = `druk-f-${i}`
    const kolorOpcji = (oid: string) => (jestZasobnik(f) ? koloryDrukarki[oid] : undefined)
    return (
      <div className="od-pole" key={f.id}>
        <label htmlFor={id}>{f.nazwa}</label>
        <div className="od-wiersz">
          <select id={id} value={f.wybrana ?? ''} onChange={ev => void zmienOpcje(f, ev.target.value)} disabled={!!zajete}>
            {!f.wybrana && <option value="">— jak w sterowniku —</option>}
            {f.opcje.map(o => <option key={o.id} value={o.id}>{kolorOpcji(o.id) ? `${o.nazwa} – ${kolorOpcji(o.id)}` : o.nazwa}</option>)}
          </select>
          {jestZasobnik(f) && f.wybrana && (
            <input key={`${drukarka}|${f.wybrana}`} className="od-kolor" defaultValue={koloryDrukarki[f.wybrana] ?? ''}
              placeholder="kolor papieru" aria-label={`Kolor papieru w zasobniku „${wybranyZasobnik?.nazwa ?? ''}”`}
              onBlur={ev => void zapiszKolorZasobnika(f.wybrana!, ev.target.value)} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="okno-druku-tlo" role="presentation">
      <div className="okno-druku" role="dialog" aria-modal="true" aria-labelledby="okno-druku-tytul">
        <header><h2 id="okno-druku-tytul">Drukuj: {tytul}</h2></header>
        <form aria-label="Ustawienia wydruku" onSubmit={drukuj}>
          {uwaga && <p className="od-uwaga" role="status">{uwaga}</p>}
          <div className="od-pole">
            <label htmlFor="druk-drukarka">Drukarka</label>
            <select id="druk-drukarka" ref={pierwszy} value={drukarka} disabled={!!zajete && !funkcje.length && !drukarki.length}
              onChange={ev => void zmienDrukarke(ev.target.value)}>
              {drukarki.map(d => <option key={d.nazwa} value={d.nazwa}>{d.nazwa}{d.domyslna ? ' (domyślna)' : ''}</option>)}
            </select>
          </div>
          {gora.map((f, i) => pole(f, i))}
          <div className="od-dwa">
            <div className="od-pole">
              <label htmlFor="druk-kopie">Kopie</label>
              <input id="druk-kopie" type="number" min={1} max={kopieMax} inputMode="numeric" value={kopie} onChange={ev => setKopie(ev.target.value)} />
            </div>
            {rodzaj !== 'kartki-palet' && <fieldset className="od-pole od-strony">
              <legend>Strony</legend>
              <label><input type="radio" name="druk-zakres" checked={zakres === 'wszystkie'} onChange={() => setZakres('wszystkie')} /> wszystkie</label>
              <label><input type="radio" name="druk-zakres" checked={zakres === 'od-do'} onChange={() => setZakres('od-do')} /> od</label>
              <input aria-label="Od strony" type="number" min={1} value={od} disabled={zakres !== 'od-do'} onChange={ev => setOd(ev.target.value)} />
              <span>do</span>
              <input aria-label="Do strony" type="number" min={1} value={doStr} disabled={zakres !== 'od-do'} onChange={ev => setDoStr(ev.target.value)} />
            </fieldset>}
          </div>
          {reszta.length > 0 && (
            <details className="od-wiecej">
              <summary>Więcej ustawień drukarki</summary>
              {reszta.map((f, i) => pole(f, gora.length + i))}
            </details>
          )}
          {blad && (
            <div className="od-blad" role="alert">
              <p>{blad}</p>
              <button type="button" className="od-btn" onClick={() => onZamknij({ systemowe: true })}>Drukuj oknem systemowym</button>
            </div>
          )}
          <footer>
            <button type="button" className="od-btn" onClick={() => void ustawieniaSterownika()} disabled={!!zajete || !drukarka}>Ustawienia drukarki…</button>
            <label className="od-zapamietaj"><input type="checkbox" checked={zapamietaj} onChange={ev => setZapamietaj(ev.target.checked)} />
              {` Zapamiętaj dla „${NAZWA_RODZAJU[rodzaj]}”`}</label>
            <span className="od-odstep" />
            {zajete && <span className="od-zajete" role="status">{zajete}</span>}
            <button type="button" className="od-btn" onClick={() => onZamknij({ wydrukowano: false })} disabled={zajete === 'Drukowanie…'}>Anuluj</button>
            <button type="submit" className="od-btn od-glowny" disabled={!!zajete || !drukarka}>Drukuj</button>
          </footer>
        </form>
      </div>
    </div>
  )
}
