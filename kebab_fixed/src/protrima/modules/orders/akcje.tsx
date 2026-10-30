import React, { useCallback, useState } from 'react'
import { Ban, Trash2, CheckCheck, RotateCcw, PackageCheck } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { useOrders } from '../../data/store'
import { computeMetrics, kg, fmtDate, type Order } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'
import { clientOrdersApi } from '@/lib/api'

type Rodzaj = 'confirm' | 'done' | 'undo' | 'cancel' | 'delete'
const TEKST: Record<Rodzaj, { title: string; btn: string; danger?: boolean; icon: React.ReactNode }> = {
  confirm: { title: 'Potwierdzić zamówienie?', btn: 'Potwierdź', icon: <CheckCheck size={20} color="var(--accent)" /> },
  done: { title: 'Oznaczyć jako zrealizowane?', btn: 'Oznacz jako zrealizowane', icon: <PackageCheck size={20} color="var(--ok)" /> },
  undo: { title: 'Cofnąć realizację?', btn: 'Cofnij realizację', icon: <RotateCcw size={20} color="var(--warn)" /> },
  cancel: { title: 'Anulować zamówienie?', btn: 'Anuluj zamówienie', danger: true, icon: <Ban size={20} color="var(--crit)" /> },
  delete: { title: 'Usunąć zamówienie?', btn: 'Usuń na zawsze', danger: true, icon: <Trash2 size={20} color="var(--crit)" /> },
}

/** Co wolno zrobić z zamówieniem w danym statusie — te same bramki co serwer (orders_service). */
export function dozwolone(o: Pick<Order, 'status'>): Record<Rodzaj, boolean> {
  const s = o.status
  return {
    confirm: s === 'draft',
    done: s === 'confirmed' || s === 'in_production',
    undo: s === 'done',
    cancel: s === 'draft' || s === 'confirmed' || s === 'in_production',
    delete: s === 'draft' || s === 'confirmed',
  }
}

/**
 * Akcje statusu zamówienia przez istniejące endpointy (updateStatus,
 * cofnijRealizacje, delete). Każda z potwierdzeniem, odmowa serwera jego
 * słowami, po sukcesie odświeżenie listy.
 */
export function useOrderActions() {
  const app = useApp()
  const { refresh } = useOrders()
  const [akcja, setAkcja] = useState<{ r: Rodzaj; o: Order } | null>(null)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [slowo, setSlowo] = useState('')
  const zapytaj = useCallback((r: Rodzaj, o: Order) => { setAkcja({ r, o }); setBlad(null); setSlowo('') }, [])
  const close = () => { if (!busy) setAkcja(null) }

  const wykonaj = async () => {
    if (!akcja || busy) return
    const { r, o } = akcja
    if (r === 'delete' && slowo.trim().toUpperCase().replace('Ń', 'N') !== 'USUN') return
    setBusy(true); setBlad(null)
    try {
      if (r === 'confirm') await clientOrdersApi.updateStatus(o.id, 'confirmed')
      else if (r === 'done') await clientOrdersApi.updateStatus(o.id, 'done')
      else if (r === 'cancel') await clientOrdersApi.updateStatus(o.id, 'cancelled')
      else if (r === 'undo') await clientOrdersApi.cofnijRealizacje(o.id)
      else await clientOrdersApi.delete(o.id)
      await refresh()
      app.toast({ kind: 'ok', title: { confirm: 'Potwierdzono', done: 'Oznaczono jako zrealizowane', undo: 'Cofnięto realizację', cancel: 'Anulowano', delete: 'Usunięto' }[r] + ` ${o.no}` })
      setAkcja(null)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Serwer odmówił')
    } finally { setBusy(false) }
  }

  let dialog: React.ReactNode = null
  if (akcja) {
    const { r, o } = akcja
    const m = computeMetrics(o)
    const t = TEKST[r]
    const deleteReady = slowo.trim().toUpperCase().replace('Ń', 'N') === 'USUN'
    dialog = (
      <Dialog title={t.title} icon={t.icon} onClose={close}
        footer={<><button className="btn" onClick={close} data-autofocus disabled={busy}>Wróć</button>
          <button className="btn primary" style={t.danger ? { background: 'var(--crit)', borderColor: 'var(--crit)' } : undefined}
            disabled={busy || (r === 'delete' && !deleteReady)} onClick={wykonaj}>{busy ? 'Zapisywanie…' : t.btn}</button></>}>
        <div className="box" style={{ padding: '8px 12px' }}><dl className="kv">
          <dt>Zamówienie</dt><dd className="strong">{o.no}</dd><dt>Klient</dt><dd>{o.client.name}</dd>
          <dt>Ilość</dt><dd>{kg(m.orderedKg)} · {o.lines.length} poz.</dd>{o.delivery && <><dt>Dostawa</dt><dd>{fmtDate(o.delivery)}</dd></>}
        </dl></div>
        {r === 'confirm' && <p>Zamówienie trafi do planowania produkcji i zacznie brać wyrób z magazynu (przydział globalny).</p>}
        {r === 'done' && <p>Zamówienie przejdzie do zamkniętych i przestanie brać wyrób z magazynu. Zwykle robi to samo wydanie (WZ) — ręcznie tylko, gdy realizacja odbyła się poza systemem.</p>}
        {r === 'undo' && <p>Zamówienie wróci do potwierdzonych — HDI będzie się znowu liczyć od stanu faktycznego. Serwer odmówi, jeśli trzyma je aktywny WZ/WM (poda numery do anulowania).</p>}
        {r === 'cancel' && <div className="note warn"><FlagIcon level="warn" size={16} /><div>
          Zamówienie zniknie z planowania. {m.palletsTotal > 0 && <>Spakowane palety ({m.palletsTotal}) przejdą do poczekalni i nie zgubią numerów. </>}
          {m.stockKg > 0 && <>Przydzielony wyrób ({kg(m.stockKg)}) wróci do puli. </>}Serwer odmówi, jeśli do zamówienia są przypięte kartony magazynowe.
        </div></div>}
        {r === 'delete' && <>
          <div className="note crit"><FlagIcon level="crit" size={16} /><div>Tej operacji <b>nie da się cofnąć</b> — zamówienie zniknie razem z pozycjami. Rozpisane palety nie przepadają: czekają na nowe zamówienie tego odbiorcy.</div></div>
          <label className="label" htmlFor="usun-slowo">Wpisz <b>USUŃ</b>, aby potwierdzić</label>
          <input id="usun-slowo" className="field" value={slowo} onChange={e => setSlowo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void wykonaj() }} autoComplete="off" />
        </>}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      </Dialog>
    )
  }
  return { zapytaj, dialog }
}
