import React, { useEffect, useState } from 'react'
import { Users, Plus, Trash2 } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { clientGroupsApi, type ClientGroup } from '@/lib/api'
import type { Client } from '@/lib/mockApi'

const etykieta = (c: { name: string; displayName?: string }) => (c.displayName && c.displayName !== c.name ? `${c.displayName} — ${c.name}` : c.name)

/**
 * Grupy odbiorców (port okna ze starego MES): spółki w jednej grupie dzielą
 * pulę wyrobu gotowego — przy pokryciu i przy zdejmowaniu na dokumenty.
 * Dokument zostaje przy konkretnej spółce. Spółka najwyżej w jednej grupie.
 */
export function GrupyDialog({ klienci, onClose }: { klienci: Client[]; onClose: () => void }) {
  const [grupy, setGrupy] = useState<ClientGroup[] | null>(null)
  const [nowa, setNowa] = useState('')
  const [edytowana, setEdytowana] = useState<string | null>(null)
  const [sklad, setSklad] = useState<Set<string>>(new Set())
  const [rozwiaz, setRozwiaz] = useState<ClientGroup | null>(null)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const wczytaj = () => clientGroupsApi.list().then(setGrupy).catch(() => setGrupy([]))
  useEffect(() => { void wczytaj() }, [])
  const posortowani = klienci.slice().sort((a, b) => etykieta(a).localeCompare(etykieta(b), 'pl'))

  const dzialaj = async (fn: () => Promise<unknown>) => {
    setBusy(true); setBlad(null)
    try { await fn(); await wczytaj() } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać') } finally { setBusy(false) }
  }
  const dodaj = () => { if (nowa.trim()) void dzialaj(async () => { await clientGroupsApi.create(nowa.trim()); setNowa('') }) }
  const otworz = (g: ClientGroup) => { setEdytowana(e => (e === g.id ? null : g.id)); setSklad(new Set(g.members.map(m => m.id))) }
  const wInnej = (id: string) => (grupy ?? []).find(g => g.id !== edytowana && g.members.some(m => m.id === id))
  const przelacz = (id: string) => setSklad(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <Dialog wide title="Grupy odbiorców" icon={<Users size={20} />} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Zamknij</button>}>
      <p className="muted" style={{ marginTop: 0 }}>Spółki w jednej grupie dzielą zapas wyrobu — towar zrobiony dla jednej pokryje zamówienie drugiej. Dokumenty zostają przy konkretnej firmie.</p>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <input className="field" style={{ flex: 1 }} value={nowa} placeholder="Nazwa grupy, np. WROCŁAW" aria-label="Nazwa nowej grupy" data-autofocus
          onChange={e => setNowa(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); dodaj() } }} />
        <button className="btn" disabled={busy || !nowa.trim()} onClick={dodaj}><Plus size={14} />Nowa grupa</button>
      </div>
      {grupy === null && <p className="muted">Wczytuję…</p>}
      {grupy?.length === 0 && <p className="muted">Nie ma jeszcze żadnej grupy. Załóż ją i wskaż spółki, które mają dzielić zapas.</p>}
      <div className="kh-grupy">
        {grupy?.map(g => (
          <div key={g.id} className="box kh-grupa">
            <div className="kh-grupa-h">
              <b>{g.name}</b><span className="muted">{g.members.length ? g.members.map(m => m.name).join(', ') : 'brak spółek'}</span>
              <span style={{ marginLeft: 'auto' }} className="row-wrap">
                <button className="btn sm" disabled={busy} onClick={() => otworz(g)} aria-label={`Skład: ${g.name}`}>{edytowana === g.id ? 'Zwiń' : 'Skład'}</button>
                <button className="btn sm ghost danger icon" disabled={busy} onClick={() => setRozwiaz(g)} aria-label={`Rozwiąż grupę ${g.name}`}><Trash2 size={14} /></button>
              </span>
            </div>
            {rozwiaz?.id === g.id && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} /><div>
              <b>Rozwiązać grupę „{g.name}”?</b> Spółki zostaną w kartotece i wrócą do własnych pul wyrobu.
              <div className="row-wrap" style={{ marginTop: 6 }}><button className="btn sm danger" onClick={() => { setRozwiaz(null); void dzialaj(() => clientGroupsApi.remove(g.id)) }}>Rozwiąż</button><button className="btn sm" onClick={() => setRozwiaz(null)}>Wróć</button></div></div></div>}
            {edytowana === g.id && <div className="kh-grupa-sklad">
              {posortowani.map(c => {
                const inna = wInnej(c.id)
                return (
                  <label key={c.id} className={`kh-cbx${inna ? ' faint' : ''}`}>
                    <input type="checkbox" className="cbx" checked={sklad.has(c.id)} disabled={!!inna} onChange={() => przelacz(c.id)} aria-label={etykieta(c)} />
                    {etykieta(c)}{inna && <span className="sub"> {`w grupie ${inna.name}`}</span>}
                  </label>)
              })}
              <div className="row-wrap"><button className="btn sm primary" disabled={busy} onClick={() => void dzialaj(async () => { await clientGroupsApi.setMembers(g.id, [...sklad]); setEdytowana(null) })}>Zapisz skład</button></div>
            </div>}
          </div>))}
      </div>
    </Dialog>
  )
}
