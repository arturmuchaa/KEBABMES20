import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Tags } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { finishedUnitsApi, type UnitForLabel } from '@/lib/api'
import { ROLKA_ETYKIET, drukujEtykiety, opisBledu } from '../../drukarka/drukarka'
import { etykietaSztukiZpl, numerKebaba } from './etykiety'

/**
 * Etykiety sztuk planu — druk wieczorem w biurze, w kolejności pozycji i palet
 * (hala nie drukuje nic na bieżąco). Wydruk oznacza się DOPIERO po sukcesie
 * całej serii; błąd drukarki nie oznacza niczego, więc „Drukuj niewydrukowane”
 * po prostu powtarza serię. Po zmianie planu sztuki z nową partią wracają
 * tutaj jako niewydrukowane, a okno mówi, które stare etykiety wyrzucić.
 */
export function OknoEtykiet({ planId, planNo, przedruk, onClose }: { planId: string; planNo: string; przedruk?: string[]; onClose: () => void }) {
  const [sztuki, setSztuki] = useState<UnitForLabel[] | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [drukuje, setDrukuje] = useState(false)
  const [status, setStatus] = useState('')

  const wczytaj = useCallback(async () => {
    try { setSztuki(await finishedUnitsApi.forPlan(planId)); setBlad(null) } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }, [planId])
  useEffect(() => { void wczytaj() }, [wczytaj])

  const razem = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sztuki ?? []) m.set(s.planLineId, (m.get(s.planLineId) ?? 0) + 1)
    return m
  }, [sztuki])
  const grupy = useMemo(() => {
    const g = new Map<number, UnitForLabel[]>()
    for (const s of sztuki ?? []) { const l = g.get(s.linePosition) ?? []; l.push(s); g.set(s.linePosition, l) }
    return [...g.entries()].sort((a, b) => a[0] - b[0])
  }, [sztuki])
  const doDruku = (sztuki ?? []).filter(s => !s.labelPrintedAt && s.status === 'planned')
  const zpl = (s: UnitForLabel) => etykietaSztukiZpl({ ...s, razem: razem.get(s.planLineId) ?? 1 })
  const przedrukSztuki = (sztuki ?? []).filter(s => przedruk?.includes(s.id))

  const drukuj = async (lista: UnitForLabel[]) => {
    if (!lista.length || drukuje) return
    setDrukuje(true); setBlad(null)
    try {
      await drukujEtykiety(lista.map(zpl), ROLKA_ETYKIET, { onStatus: setStatus })
      await finishedUnitsApi.markLabelsPrinted(lista.map(s => s.id))
      await wczytaj()
    } catch (e) { setBlad(await opisBledu(e)) } finally { setDrukuje(false); setStatus('') }
  }

  return (
    <Dialog wide title={`Etykiety sztuk — ${planNo}`} icon={<Tags size={20} color="var(--accent)" />} onClose={onClose}
      footer={<>
        <span className="left muted">{status || (sztuki ? `wydrukowane ${(sztuki.length - doDruku.length)} z ${sztuki.length}` : '')} · rolka 100 × 150 mm</span>
        <button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" data-autofocus disabled={!doDruku.length || drukuje} onClick={() => void drukuj(doDruku)}>
          <Printer size={15} />{drukuje ? 'Drukuję…' : `Drukuj niewydrukowane (${doDruku.length})`}</button>
      </>}>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Etykiety nie zostały wydrukowane:</b> {blad}</div></div>}
      {przedrukSztuki.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
        <b>Zmieniła się partia {przedrukSztuki.length} sztuk</b> — wyrzuć stare etykiety nr {przedrukSztuki.map(s => `${s.linePosition}.${s.qrSeq}`).join(', ')} i wydrukuj nowe (są na liście niewydrukowanych).</div></div>}
      {!sztuki && !blad && <div className="note">Wczytuję sztuki planu…</div>}
      {sztuki && !sztuki.length && <div className="note">Plan nie ma jeszcze sztuk — wyślij go do produkcji.</div>}
      <div className="pp-etykiety">{grupy.map(([poz, lista]) => (
        <section key={poz}>
          <h4>Pozycja {poz} · {lista[0].recipeName}{lista[0].clientName ? ` · ${lista[0].clientName}` : ''} · {lista.length} × {lista[0].weightKg} kg</h4>
          <table className="tbl"><tbody>{lista.map(s => (
            <tr key={s.id} className="row">
              <td className="tnum" style={{ width: 70 }}>{s.qrSeq}/{razem.get(s.planLineId)}</td>
              <td><b className="code">{numerKebaba(s.producedDate, s.batchNo)}</b></td>
              <td>{s.status !== 'planned' ? <span className="tag neutral">zeskanowana</span> : s.labelPrintedAt ? <span className="tag ok">wydrukowana</span> : <span className="tag warn">do druku</span>}</td>
              <td className="r"><button className="btn sm ghost" disabled={drukuje || s.status !== 'planned'} onClick={() => void drukuj([s])}><Printer size={13} />Drukuj ponownie</button></td>
            </tr>
          ))}</tbody></table>
        </section>
      ))}</div>
    </Dialog>
  )
}
