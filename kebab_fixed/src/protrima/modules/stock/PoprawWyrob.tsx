import { useMemo, useRef, useState } from 'react'
import { PenLine } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { useOrders } from '../../data/store'
import { kg, num } from '../../data/model'
import { posKg, type StockPos } from '../../data/stock'
import { FlagIcon } from '../../ui/Glyphs'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi, productTypesApi, recipesApi } from '@/lib/api'

interface Rodzaj { id: string; name: string; active?: boolean }
interface Receptura { id: string; name: string; productTypeId?: string; active?: boolean }

/** Dlaczego wiersza nie wolno już poprawić (null = wolno) — ta sama zasada co serwer i stary MES. */
export function blokadaPoprawki(p: Pick<StockPos, 'qtyShipped'>): string | null {
  return (p.qtyShipped ?? 0) > 0
    ? `Z tej partii wyjechało już ${num(p.qtyShipped ?? 0)} szt. — rodzaj i receptura stoją na WZ i HDI, nie poprawia się ich tutaj.`
    : null
}

/**
 * Poprawka rodzaju i receptury na wierszu magazynu wyrobu gotowego.
 *
 * Rodzaj i receptura to tożsamość wyrobu: pokrycie zamówień dopasowuje po
 * (rodzaj, receptura, tuleja, waga), więc pomyłka przy wpisie zostawia sztuki,
 * które leżą, a zamówienia ich „nie widzą” (ZAGROS 30.08.2026). Poprawia się
 * JEDEN wiersz (partię) i tylko dopóki nic z niego nie wyjechało — serwer
 * pilnuje tego samego (`PATCH /finished-goods/{id}/rodzaj|receptura`).
 * W starym MES były to dwa osobne „popraw”; tu jedno okno na oba pola.
 */
export function PoprawWyrobDialog({ p, onClose }: { p: StockPos; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const typyRes = useApi(() => productTypesApi.list() as Promise<Rodzaj[]>)
  const recRes = useApi(() => recipesApi.list() as Promise<Receptura[]>)
  const [rodzaj, setRodzaj] = useState(p.productTypeId ?? '')
  const [receptura, setReceptura] = useState(p.recipeId ?? '')
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)
  const blokada = blokadaPoprawki(p)

  const typy = useMemo(() => (typyRes.data ?? []).filter(t => t.active !== false || t.id === p.productTypeId), [typyRes.data, p.productTypeId])
  // Receptury pasujące do wybranego rodzaju — ta sama zasada co edytor zamówienia (filterRecipesFor).
  const receptury = useMemo(() => (recRes.data ?? [])
    .filter(r => (r.active !== false || r.id === p.recipeId) && (!rodzaj || !r.productTypeId || r.productTypeId === rodzaj)), [recRes.data, rodzaj, p.recipeId])
  const zmianaRodzaju = !!rodzaj && rodzaj !== (p.productTypeId ?? '')
  const zmianaReceptury = !!receptura && receptura !== (p.recipeId ?? '')
  const recepturaPasuje = receptury.some(r => r.id === receptura)
  const nazwaRodzaju = typy.find(t => t.id === rodzaj)?.name ?? p.product
  const nazwaReceptury = receptury.find(r => r.id === receptura)?.name ?? p.recipe

  const zapisz = async () => {
    if (lock.current || blokada || (!zmianaRodzaju && !zmianaReceptury) || !recepturaPasuje) return
    lock.current = true; setBusy(true); setBlad(null)
    let rodzajZrobiony = false
    try {
      if (zmianaRodzaju) { await finishedGoodsApi.zmienRodzaj(p.id, rodzaj); rodzajZrobiony = true }
      if (zmianaReceptury) await finishedGoodsApi.zmienRecepture(p.id, receptura)
      await refresh().catch(() => undefined)
      app.toast({ kind: 'ok', title: `Poprawiono partię ${p.batch}`, detail: `${nazwaRodzaju} · ${nazwaReceptury} ${p.kgPerUnit} kg — ${num(p.qty)} szt.` })
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'nieznany błąd'
      // Dwa osobne zapisy: gdy padł drugi, pierwszy już jest — mówimy to wprost.
      setBlad(rodzajZrobiony ? `Rodzaj zmieniono, ale receptury nie: ${msg}` : `Nie udało się poprawić: ${msg}`)
      if (rodzajZrobiony) void refresh().catch(() => undefined)
    } finally { lock.current = false; setBusy(false) }
  }

  return (
    <Dialog title="Popraw rodzaj / recepturę" icon={<PenLine size={20} />} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy} data-autofocus>Wróć</button>
        <button className="btn primary" disabled={busy || !!blokada || (!zmianaRodzaju && !zmianaReceptury) || !recepturaPasuje} onClick={() => void zapisz()}>
          {busy ? 'Zapisywanie…' : 'Zapisz poprawkę'}</button>
      </>}>
      <div className="box" style={{ padding: '10px 12px' }} aria-label="Poprawiany wiersz magazynu">
        <div className="strong">{p.product} · {p.recipe} {p.kgPerUnit} kg</div>
        <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Partia <span className="code">{p.batch}</span> · {num(p.qty)} szt. · {kg(posKg(p))}{p.orderNo ? ` · stempel ${p.orderNo}` : ' · wolne'}</div>
      </div>
      {blokada
        ? <div className="note warn"><FlagIcon level="warn" size={15} /><div>{blokada}</div></div>
        : <>
          <label className="fld"><span className="label">Rodzaj</span>
            <select className="field" value={rodzaj} disabled={busy || !typyRes.data} onChange={e => setRodzaj(e.target.value)} aria-label="Rodzaj">
              {!rodzaj && <option value="">— wybierz —</option>}
              {typy.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          <label className="fld"><span className="label">Receptura</span>
            <select className={`field${receptura && !recepturaPasuje && recRes.data ? ' invalid' : ''}`} value={receptura} disabled={busy || !recRes.data} onChange={e => setReceptura(e.target.value)} aria-label="Receptura">
              {!recepturaPasuje && <option value={receptura}>— wybierz recepturę tego rodzaju —</option>}
              {receptury.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></label>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Zmiana dotyczy całej partii ({num(p.qty)} szt.). Po poprawce pokrycie zamówień przeliczy się samo — sztuki trafią do zamówień z tym rodzajem i recepturą.</p>
        </>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
    </Dialog>
  )
}
