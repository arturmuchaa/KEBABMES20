import { useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, palletKg, palletQty, type Order, type Pallet } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { magazynApi } from '@/lib/api'

const ODMOWA: Record<string, string> = {
  NOT_IN_COLD: 'Ten karton nie stoi już w mroźni — odśwież listę.',
  GONE: 'Karton jest już na aucie albo wydany — z mroźni nie wyjedzie (to sprawa załadunku).',
  INVALID: 'Serwer nie rozpoznał kartki tego kartonu.',
}

/**
 * „Wyjedź z mroźni” z biura — to samo co na HMI mroźni (właściciel 26.11.2026:
 * „chciałem móc wyjechać z mroźni kartonem do poprawek”). Karton wraca do
 * pakowania: pełny jako spakowany (ponowny wjazd = ponowne ważenie), niepełny
 * jako rozpisany. Historia ważeń zostaje. Ten sam kod co skan kartki: `PAL|zamówienie|nr`.
 */
export function WyjazdZMrozniDialog({ order, p, onClose }: { order: Order; p: Pallet; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)

  const wyjedz = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setBlad(null)
    try {
      const r = await magazynApi.mrozniaWyjazd(`PAL|${order.id}|${p.no}`)
      if (r.result !== 'SUCCESS') { setBlad(ODMOWA[r.result] ?? `Serwer odmówił (${r.result}).`); return }
      await refresh()
      app.toast({ kind: 'ok', title: `Karton ${p.carton} wyjechał z mroźni`, detail: 'Wrócił do pakowania — po poprawkach wjedzie i zostanie zważony ponownie.' })
      onClose()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się wyjechać z mroźni')
    } finally { lock.current = false; setBusy(false) }
  }

  return (
    <Dialog title={`Wyjechać kartonem ${p.carton} z mroźni?`} icon={<LogOut size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Wróć</button>
        <button className="btn primary" data-autofocus disabled={busy} onClick={() => void wyjedz()}>{busy ? 'Zapisywanie…' : 'Wyjedź z mroźni'}</button>
      </>}>
      <p>Paleta {p.no} · karton <span className="code">{p.carton}</span> · {palletQty(p)} szt. · {kg(palletKg(order, p))}.</p>
      <p>Karton wróci do pakowania, tak jak po „Wyjedź z mroźni” na HMI. Na hali można go poprawić, a przy ponownym wjeździe do mroźni zostanie zważony jeszcze raz. Historia ważeń zostaje.</p>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie wyjechał:</b> {blad}</div></div>}
    </Dialog>
  )
}
