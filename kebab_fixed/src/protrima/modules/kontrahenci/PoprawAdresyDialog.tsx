import React, { useEffect, useState } from 'react'
import { MapPin, ArrowRight } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { kontrahenciApi, type AdresKartoteki, type PropozycjaAdresu } from '@/lib/api'

const linie = (a: AdresKartoteki) => [a.address, [a.postal_code, a.city].filter(x => x && x.trim()).join(' ')].filter(x => x && x.trim())

/**
 * Propozycje poprawy zapisanych adresów (wielkie litery, spacje, kod w formacie
 * kraju) — liczone z kartoteki, bez pytania rejestrów. Wszystko domyślnie
 * zaznaczone; biuro odznacza, czego nie chce, i zatwierdza.
 */
export function PoprawAdresyDialog({ onClose, onZastosowano }: { onClose: () => void; onZastosowano: () => void }) {
  const app = useApp()
  const [lista, setLista] = useState<PropozycjaAdresu[] | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [odznaczone, setOdznaczone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => { kontrahenciApi.propozycjeAdresow().then(setLista).catch(e => { setBlad(e instanceof Error ? e.message : 'Nie udało się policzyć propozycji'); setLista([]) }) }, [])
  const klucz = (p: PropozycjaAdresu) => `${p.rodzaj}:${p.id}`
  const wybrane = (lista ?? []).filter(p => !odznaczone.has(klucz(p)))
  const przelacz = (k: string) => setOdznaczone(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const zastosuj = async () => {
    if (busy || !wybrane.length) return
    setBusy(true); setBlad(null)
    try {
      const r = await kontrahenciApi.zastosujAdresy(wybrane.map(p => ({ rodzaj: p.rodzaj, id: p.id, ...p.proponowane })))
      app.toast({ kind: 'ok', title: `Poprawiono adresy: ${r.zmieniono}`, detail: 'Nowe dokumenty pójdą już z poprawionym adresem.' })
      onZastosowano()
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać') } finally { setBusy(false) }
  }

  return (
    <Dialog xl title="Popraw adresy w kartotece" icon={<MapPin size={20} />} onClose={onClose}
      footer={<>
        <span className="muted kh-skroty">Wystawione dokumenty zostają bez zmian — poprawka dotyczy następnych.</span>
        <button className="btn" onClick={onClose}>Zamknij</button>
        {!!lista?.length && <button className="btn primary" disabled={busy || !wybrane.length} onClick={() => void zastosuj()}>{busy ? 'Zapisuję…' : `Zastosuj zaznaczone (${wybrane.length})`}</button>}
      </>}>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
      {lista === null && <p className="muted">Liczę propozycje…</p>}
      {lista?.length === 0 && !blad && <div className="note"><FlagIcon level="info" size={15} /><div><b>Wszystkie adresy wyglądają dobrze</b><br />
        Brakujące dane (np. sama ulica bez kodu) uzupełnisz przez „Pobierz” w karcie kontrahenta.</div></div>}
      {!!lista?.length && <table className="tbl kh-adresy">
        <thead><tr><th style={{ width: 34 }} /><th>Kontrahent</th><th>Teraz w kartotece</th><th style={{ width: 24 }} /><th>Po poprawce</th></tr></thead>
        <tbody>{lista.map(p => {
          const k = klucz(p), on = !odznaczone.has(k)
          return (
            <tr key={k} className={`row${on ? ' sel' : ''}`} onClick={() => przelacz(k)}>
              <td className="c"><input type="checkbox" className="cbx" checked={on} onChange={() => przelacz(k)} onClick={e => e.stopPropagation()} aria-label={`Popraw: ${p.nazwa}`} /></td>
              <td><b>{p.nazwa}</b> <span className="tag outline">{p.rodzaj}</span>{p.pelna !== p.nazwa && <div className="sub">{p.pelna}</div>}</td>
              <td className="muted">{linie(p.obecne).map((l, i) => <div key={i}><code>{l}</code></div>)}{p.obecne.country !== p.proponowane.country && <div>kraj: {p.obecne.country || 'puste'}</div>}</td>
              <td className="c faint"><ArrowRight size={14} /></td>
              <td className="strong">{linie(p.proponowane).map((l, i) => <div key={i}>{l}</div>)}{p.obecne.country !== p.proponowane.country && <div>kraj: {p.proponowane.country}</div>}</td>
            </tr>)
        })}</tbody>
      </table>}
    </Dialog>
  )
}
