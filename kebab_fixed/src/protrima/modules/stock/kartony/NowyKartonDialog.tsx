import { useEffect, useMemo, useRef, useState } from 'react'
import { PackagePlus, Plus, Trash2 } from 'lucide-react'
import { Dialog } from '../../../shell/context'
import { FlagIcon } from '../../../ui/Glyphs'
import { Wybor } from '../../../ui/Wybor'
import { kg, num as fmtNum } from '../../../data/model'
import type { StockPos } from '../../../data/stock'
import { useApi } from '@/hooks/useApi'
import { clientsApi, packagingApi, productTypesApi, recipesApi, stockCartonsApi, type StockCarton } from '@/lib/api'
import { num } from '@/features/orders/order-entry/model'
import { bledyKartonu, doUtworzenia, pozycjaZMagazynu, pustaPoz, pustaPozycja, type FormKartonu, type PozycjaKartonu } from './model'

export interface StartKartonu { clientName?: string; z?: StockPos }

/**
 * Nowy karton magazynowy — dla jednego klienta albo „na magazyn — bez klienta”,
 * jednorodny albo mieszany (wiele pozycji). Serwer nadaje globalny numer kartonu;
 * po zapisie od razu kartka do druku (magazynier pakuje do kartonu sztuki).
 * Klienta i zamówienie można przypiąć później — w zamówieniu: Pokrycie → Kartony z magazynu.
 */
export function NowyKartonDialog({ start, wolne, onClose, onUtworzony }: {
  start?: StartKartonu; wolne: StockPos[]; onClose: () => void; onUtworzony: (c: StockCarton) => void
}) {
  const clientsRes = useApi(() => clientsApi.list())
  const typesRes = useApi(() => productTypesApi.list())
  const recipesRes = useApi(() => recipesApi.list())
  const packRes = useApi(() => packagingApi.list())
  const s = useMemo(() => ({
    clients: ((clientsRes.data ?? []) as Array<{ id: string; name: string; displayName?: string; city?: string; active?: boolean }>).filter(c => c.active !== false)
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl')),
    productTypes: ((typesRes.data ?? []) as Array<{ id: string; name: string; active?: boolean }>).filter(t => t.active !== false),
    recipes: ((recipesRes.data ?? []) as Array<{ id: string; name: string; productTypeId?: string; active?: boolean }>).filter(r => r.active !== false),
    packaging: ((packRes.data ?? []) as Array<{ id: string; name: string }>),
  }), [clientsRes.data, typesRes.data, recipesRes.data, packRes.data])
  const ready = !!clientsRes.data && !!typesRes.data && !!recipesRes.data && !!packRes.data
  const loadError = clientsRes.error || typesRes.error || recipesRes.error || packRes.error

  const [f, setF] = useState<FormKartonu>({ clientId: '', pozycje: [pustaPozycja()] })
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)

  // „Karton z tej pozycji” — klient i pozycja z wiersza magazynu, gdy kartoteki już są.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !ready || !start) return
    seeded.current = true
    const norm = (x?: string) => (x ?? '').trim().toLowerCase()
    const c = start.clientName ? s.clients.find(k => norm(k.name) === norm(start.clientName) || norm(k.displayName) === norm(start.clientName)) : undefined
    setF({ clientId: c?.id ?? '', pozycje: [start.z ? pozycjaZMagazynu(start.z, s.packaging) : pustaPozycja()] })
  }, [ready, start, s])

  const setPoz = (i: number, patch: Partial<PozycjaKartonu>) => setF(x => ({ ...x, pozycje: x.pozycje.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
  const dodajPoz = (p: PozycjaKartonu = pustaPozycja()) => setF(x => {
    const wolna = x.pozycje.findIndex(pustaPoz)
    return { ...x, pozycje: wolna >= 0 ? x.pozycje.map((q, j) => (j === wolna ? p : q)) : [...x.pozycje, p] }
  })
  const usunPoz = (i: number) => setF(x => ({ ...x, pozycje: x.pozycje.length > 1 ? x.pozycje.filter((_, j) => j !== i) : [pustaPozycja()] }))
  const skocz = (i: number, pole: string) => requestAnimationFrame(() => { const el = document.getElementById(`nk-${pole}-${i}`) as HTMLInputElement | null; el?.focus(); el?.select() })

  const errors = tried ? bledyKartonu(f) : {}
  const pozycje = f.pozycje.filter(p => !pustaPoz(p))
  const szt = pozycje.reduce((a, p) => a + (Number(p.qty) || 0), 0)
  const masa = pozycje.reduce((a, p) => a + (Number(p.qty) || 0) * num(p.kgPerUnit), 0)

  const klienci = useMemo(() => s.clients.map(c => ({ id: c.id, label: c.displayName || c.name, sub: [c.displayName && c.displayName !== c.name ? c.name : '', c.city].filter(Boolean).join(' · ') || undefined })), [s.clients])
  const rodzaje = useMemo(() => s.productTypes.map(p => ({ id: p.id, label: p.name })), [s.productTypes])
  const tuleje = useMemo(() => s.packaging.map(p => ({ id: p.id, label: p.name })), [s.packaging])
  const zMagazynu = useMemo(() => wolne.map(p => ({ id: p.id, label: `${p.recipe} · ${String(p.kgPerUnit).replace('.', ',')} kg`, sub: `${p.product} · ${p.packaging} · ${p.qty} szt. · partia ${p.batch}` })), [wolne])

  const zapisz = async () => {
    if (lock.current || !ready) return
    setTried(true)
    if (Object.keys(bledyKartonu(f)).length) return
    lock.current = true; setSaving(true); setBlad(null)
    try {
      onUtworzony(await stockCartonsApi.create(doUtworzenia(f, s)))
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się utworzyć kartonu')
    } finally { lock.current = false; setSaving(false) }
  }

  return (
    <Dialog xl title="Nowy karton magazynowy" icon={<PackagePlus size={20} />} onClose={onClose}
      footer={<>
        <span className="left">{pozycje.length ? <>Razem <b>{fmtNum(szt)} szt.</b> · {kg(masa)}{pozycje.length > 1 ? ' · karton mieszany' : ''}</> : 'Karton czeka na pozycje'}</span>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" disabled={!ready || saving} onClick={() => void zapisz()}><PackagePlus size={15} />{saving ? 'Tworzenie…' : 'Utwórz karton'}</button>
      </>}>
      {loadError && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać kartotek: {loadError}</div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      <div className="nk-grid">
        <label className="nk-klient"><span className="label">Klient — wspólny dla całego kartonu</span>
          <Wybor id="nk-klient" label="Klient kartonu" items={klienci} value={f.clientId} noneLabel="Na magazyn — bez klienta" disabled={!ready}
            onChange={v => setF(x => ({ ...x, clientId: v }))} onDalej={() => skocz(0, 'p')} autoFocus={!start?.z} />
          <span className="sub">Klienta i zamówienie można przypiąć później — w zamówieniu: Pokrycie → Kartony z magazynu.</span>
        </label>
        {zMagazynu.length > 0 && <label className="nk-zmag"><span className="label">Z wolnego wyrobu na magazynie</span>
          <Wybor id="nk-zmag" label="Pozycja z wolnego wyrobu" items={zMagazynu} value="" placeholder="Wpisz recepturę albo partię…" disabled={!ready}
            onChange={id => { const p = wolne.find(x => x.id === id); if (p) dodajPoz(pozycjaZMagazynu(p, s.packaging)) }} />
          <span className="sub">Wypełnia pozycję: rodzaj, receptura, tuleja, waga i wolne sztuki.</span>
        </label>}
      </div>
      <div className="box"><table className="tbl editor-tbl">
        <thead><tr>
          <th style={{ width: '24%' }}>Rodzaj</th><th style={{ width: '26%' }}>Receptura</th><th style={{ width: '18%' }}>Tuleja</th>
          <th className="num" style={{ width: 118 }}>Waga sztuki</th><th className="num" style={{ width: 112 }}>Sztuk</th><th className="num">Masa</th><th style={{ width: 44 }} />
        </tr></thead>
        <tbody>{f.pozycje.map((p, i) => {
          const rec = s.recipes.filter(r => !p.productTypeId || !r.productTypeId || r.productTypeId === p.productTypeId).map(r => ({ id: r.id, label: r.name }))
          const errs = [errors[`p${i}`], errors[`r${i}`], errors[`k${i}`], errors[`q${i}`]].filter(Boolean)
          return [
            <tr key={`w${i}`} className="row editing">
              <td><Wybor id={`nk-p-${i}`} label={`Rodzaj, pozycja ${i + 1}`} items={rodzaje} value={p.productTypeId} invalid={!!errors[`p${i}`]} disabled={!ready} placeholder="Rodzaj…"
                onChange={v => { const r = s.recipes.find(x => x.id === p.recipeId); setPoz(i, { productTypeId: v, recipeId: r && (!r.productTypeId || r.productTypeId === v) ? p.recipeId : '' }) }} onDalej={() => skocz(i, 'r')} /></td>
              <td><Wybor id={`nk-r-${i}`} label={`Receptura, pozycja ${i + 1}`} items={rec} value={p.recipeId} invalid={!!errors[`r${i}`]} disabled={!ready} placeholder="Receptura…"
                pusto={p.productTypeId ? 'Brak receptur dla tego rodzaju' : 'Najpierw wybierz rodzaj'} onChange={v => setPoz(i, { recipeId: v })} onDalej={() => skocz(i, 't')} /></td>
              <td><Wybor id={`nk-t-${i}`} label={`Tuleja, pozycja ${i + 1}`} items={tuleje} value={p.packagingId} noneLabel="(bez tulei)" disabled={!ready}
                onChange={v => setPoz(i, { packagingId: v })} onDalej={() => skocz(i, 'k')} /></td>
              <td className="num"><input id={`nk-k-${i}`} className={`field num w-num${errors[`k${i}`] ? ' invalid' : ''}`} inputMode="decimal" placeholder="0" value={p.kgPerUnit} aria-label={`Waga sztuki kg, pozycja ${i + 1}`}
                onChange={e => setPoz(i, { kgPerUnit: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); skocz(i, 'q') } }} /> <span className="sub">kg</span></td>
              <td className="num"><input id={`nk-q-${i}`} className={`field num w-num${errors[`q${i}`] ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={p.qty} aria-label={`Sztuk, pozycja ${i + 1}`}
                onChange={e => setPoz(i, { qty: e.target.value })} /> <span className="sub">szt.</span></td>
              <td className="num">{num(p.qty) > 0 && num(p.kgPerUnit) > 0 ? kg(num(p.qty) * num(p.kgPerUnit)) : <span className="faint">—</span>}</td>
              <td><button className="btn ghost icon sm" style={{ width: 28 }} onClick={() => usunPoz(i)} aria-label={`Usuń pozycję ${i + 1}`}><Trash2 size={15} /></button></td>
            </tr>,
            errs.length > 0 && <tr key={`e${i}`} className="err-row"><td colSpan={7}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errs.join(' ')}</span></td></tr>,
          ]
        })}</tbody>
      </table></div>
      <div className="row-wrap">
        <button className="btn sm" onClick={() => { dodajPoz(); skocz(f.pozycje.findIndex(pustaPoz) >= 0 ? f.pozycje.findIndex(pustaPoz) : f.pozycje.length, 'p') }}><Plus size={15} />Dodaj pozycję</button>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Karton mieszany: kilka pozycji jednego klienta, np. 30 × 10 kg + 20 × 15 kg.</span>
      </div>
      {errors.pozycje && <div className="note crit"><FlagIcon level="crit" size={15} /><div>{errors.pozycje}</div></div>}
    </Dialog>
  )
}
