import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, Tags } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { finishedUnitsApi, labelDesignsApi, type DesignsForPlan, type LabelDesign, type UnitForLabel } from '@/lib/api'
import { ROLKA_ETYKIET, drukujEtykiety, opisBledu } from '../../drukarka/drukarka'
import { drukuj } from '@/lib/print'
import { etykietaSztukiZpl, numerKebaba } from './etykiety'
import { profilRolki, tloDoPamieci, zplSzablonu } from '../etykiety/zpl'

const KLUCZ_HALAL = (designId: string) => `protrima.etykiety.halal.${designId}`
const czytajHalal = (id: string) => { try { return localStorage.getItem(KLUCZ_HALAL(id)) ?? '' } catch { return '' } }
const zapiszHalal = (id: string, v: string) => { try { localStorage.setItem(KLUCZ_HALAL(id), v) } catch { /* bez pamięci */ } }

/**
 * Etykiety sztuk planu — druk wieczorem w biurze, w kolejności pozycji i palet
 * (hala nie drukuje nic na bieżąco). Każda pozycja drukuje się szablonem
 * swojego klienta (projektor etykiet): A4 — jeden PDF przez okno druku
 * (wybór drukarki i zasobnika), Zebra — prosto na drukarkę; pozycja bez
 * szablonu — prosta etykieta systemowa 100 × 150. Wydruk oznacza się DOPIERO
 * po sukcesie grupy; anulowane okno druku nie oznacza niczego. Po zmianie
 * planu sztuki z nową partią wracają tu jako niewydrukowane, a okno mówi,
 * które stare etykiety wyrzucić.
 */
export function OknoEtykiet({ planId, planNo, przedruk, wyrzuc, pozycje, onClose }: {
  planId: string; planNo: string; przedruk?: string[]
  /** Sztuki usunięte z planu po wydruku — ich etykiety do wyrzucenia. */
  wyrzuc?: Array<{ qrSeq: number; linePosition: number; batchNo: string }>
  /** Pozycje planu — żeby po przerwanej wysyłce dotworzyć brakujące sztuki. */
  pozycje?: Array<{ id: string; position: number }>
  onClose: () => void
}) {
  const [sztuki, setSztuki] = useState<UnitForLabel[] | null>(null)
  const [dobor, setDobor] = useState<DesignsForPlan>({})
  const [szablony, setSzablony] = useState<Record<string, LabelDesign>>({})
  const [halal, setHalal] = useState<Record<string, string>>({})
  const [blad, setBlad] = useState<string | null>(null)
  const [drukuje, setDrukuje] = useState(false)
  const [status, setStatus] = useState('')

  const wczytaj = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([finishedUnitsApi.forPlan(planId), labelDesignsApi.forPlan(planId).catch(() => ({} as DesignsForPlan))])
      setSztuki(s); setDobor(d ?? {}); setBlad(null)
      const ids = [...new Set(Object.values(d ?? {}).filter(Boolean).map(x => x!.designId))]
      const pelne = await Promise.all(ids.map(id => labelDesignsApi.get(id)))
      setSzablony(Object.fromEntries(pelne.map(p => [p.id!, p])))
      setHalal(h => ({ ...Object.fromEntries(ids.map(id => [id, czytajHalal(id)])), ...h }))
    } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }, [planId])
  useEffect(() => { void wczytaj() }, [wczytaj])

  const razem = useMemo(() => {
    const m: Record<string, number> = {}
    for (const s of sztuki ?? []) m[s.planLineId] = (m[s.planLineId] ?? 0) + 1
    return m
  }, [sztuki])
  const grupy = useMemo(() => {
    const g = new Map<number, UnitForLabel[]>()
    for (const s of sztuki ?? []) { const l = g.get(s.linePosition) ?? []; l.push(s); g.set(s.linePosition, l) }
    return [...g.entries()].sort((a, b) => a[0] - b[0])
  }, [sztuki])
  const szablonSztuki = (s: UnitForLabel): LabelDesign | null => {
    const d = dobor[s.planLineId]
    return d ? szablony[d.designId] ?? null : null
  }
  const doDruku = (sztuki ?? []).filter(s => !s.labelPrintedAt && s.status === 'planned')
  const przedrukSztuki = (sztuki ?? []).filter(s => przedruk?.includes(s.id))
  const bezSztuk = sztuki ? (pozycje ?? []).filter(p => !sztuki.some(s => s.planLineId === p.id)).sort((a, b) => a.position - b.position) : []
  const zHalal = Object.values(szablony).filter(d => d.fields.some(f => f.kind === 'org_code'))

  const utworzBrakujace = async () => {
    setDrukuje(true); setBlad(null)
    try {
      for (const p of bezSztuk) await finishedUnitsApi.generateFromPlanLine(p.id)
      await wczytaj()
    } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) } finally { setDrukuje(false) }
  }

  /** Druk listy sztuk: grupami wg szablonu, w kolejności sztuk; każda grupa oznaczana po swoim sukcesie. */
  const drukujListe = async (lista: UnitForLabel[]) => {
    if (!lista.length || drukuje) return
    setDrukuje(true); setBlad(null)
    try {
      const kolejka: Array<{ klucz: string; d: LabelDesign | null; sztuki: UnitForLabel[] }> = []
      for (const s of lista) {
        const d = szablonSztuki(s)
        const klucz = d?.id ?? 'systemowa'
        const ost = kolejka.find(k => k.klucz === klucz)
        if (ost) ost.sztuki.push(s); else kolejka.push({ klucz, d, sztuki: [s] })
      }
      for (const { d, sztuki: grupa } of kolejka) {
        const orgCode = d?.id ? halal[d.id] ?? '' : ''
        if (d?.id && orgCode) zapiszHalal(d.id, orgCode)
        if (d?.printMode === 'a4') {
          setStatus(`Składam PDF: ${grupa.length} etykiet (${d.name})…`)
          const { zbudujPdfA4 } = await import('../etykiety/pdfA4')
          const pdfBase64 = await zbudujPdfA4(d, grupa, { orgCode, razem })
          await drukuj({ rodzaj: 'etykiety', tytul: `Etykiety ${planNo} — ${d.name}`, pdfBase64, strict: true })
        } else if (d?.printMode === 'zebra') {
          // Tło raz do pamięci drukarki, etykiety je przywołują — seria 200 sztuk nie wysyła 200 × 240 KB grafiki.
          const tlo = tloDoPamieci(d)
          await drukujEtykiety([tlo.zpl, ...grupa.map(s => zplSzablonu(d, s, { orgCode, razem: razem[s.planLineId], tloZPamieci: tlo.nazwa }))], profilRolki(d), { onStatus: setStatus })
        } else {
          await drukujEtykiety(grupa.map(s => etykietaSztukiZpl({ ...s, razem: razem[s.planLineId] ?? 1 })), ROLKA_ETYKIET, { onStatus: setStatus })
        }
        await finishedUnitsApi.markLabelsPrinted(grupa.map(s => s.id))
      }
      await wczytaj()
    } catch (e) {
      setBlad(await opisBledu(e)); await wczytaj()
    } finally { setDrukuje(false); setStatus('') }
  }

  return (
    <Dialog wide title={`Etykiety sztuk — ${planNo}`} icon={<Tags size={20} color="var(--accent)" />} onClose={onClose}
      footer={<>
        <span className="left muted">{status || (sztuki ? `wydrukowane ${(sztuki.length - doDruku.length)} z ${sztuki.length}` : '')}</span>
        <button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" data-autofocus disabled={!doDruku.length || drukuje} onClick={() => void drukujListe(doDruku)}>
          <Printer size={15} />{drukuje ? 'Drukuję…' : `Drukuj niewydrukowane (${doDruku.length})`}</button>
      </>}>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Etykiety nie zostały wydrukowane:</b> {blad}</div></div>}
      {bezSztuk.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
        <b>{bezSztuk.length === 1 ? `Pozycja ${bezSztuk[0].position} nie ma jeszcze sztuk` : `Pozycje ${bezSztuk.map(p => p.position).join(', ')} nie mają jeszcze sztuk`}</b> — wysyłka do produkcji się przerwała.{' '}
        <button className="btn sm" disabled={drukuje} onClick={() => void utworzBrakujace()}>Utwórz brakujące sztuki</button></div></div>}
      {przedrukSztuki.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
        <b>Zmieniło się {przedrukSztuki.length} sztuk</b> (partia, waga, receptura albo klient) — wyrzuć stare etykiety nr {przedrukSztuki.map(s => `${s.linePosition}.${s.qrSeq}`).join(', ')} i wydrukuj nowe (są na liście niewydrukowanych).</div></div>}
      {(wyrzuc?.length ?? 0) > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
        <b>Usunięte z planu</b> — wyrzuć etykiety: {wyrzuc!.map(w => `${w.linePosition}.${w.qrSeq}`).join(', ')} (partia {[...new Set(wyrzuc!.map(w => w.batchNo))].join(', ')}).</div></div>}
      {zHalal.length > 0 && <div className="pp-halal">{zHalal.map(d => (
        <label key={d.id} className="et-l"><span>Kod HALAL — {d.name}</span>
          <input className="field" value={halal[d.id!] ?? ''} aria-label={`Kod HALAL — ${d.name}`} onChange={e => setHalal(h => ({ ...h, [d.id!]: e.target.value }))} /></label>
      ))}</div>}
      {!sztuki && !blad && <div className="note">Wczytuję sztuki planu…</div>}
      {sztuki && !sztuki.length && <div className="note">Plan nie ma jeszcze sztuk — wyślij go do produkcji.</div>}
      <div className="pp-etykiety">{grupy.map(([poz, lista]) => {
        const d = szablonSztuki(lista[0])
        const s0 = lista[0]
        return (
          <section key={poz}>
            <h4>Pozycja {poz} · {s0.recipeName}{s0.clientName ? ` · ${s0.clientName}` : ''} · {lista.length} × {s0.weightKg} kg{' '}
              {d ? <span className={`tag ${d.printMode === 'a4' ? 'outline' : 'neutral'}`}>{d.name} · {d.printMode === 'a4' ? 'A4 (PDF)' : 'Zebra'}</span>
                : <span className="tag warn">etykieta systemowa 100 × 150</span>}</h4>
            {!d && <p className="pp-brak-szablonu">Brak szablonu dla {[s0.clientName || 'bez klienta', s0.productTypeName, s0.recipeName].filter(Boolean).join(' · ')} — załóż go w module Etykiety.</p>}
            <table className="tbl"><tbody>{lista.map(s => (
              <tr key={s.id} className="row">
                <td className="tnum" style={{ width: 70 }}>{s.qrSeq}/{razem[s.planLineId]}</td>
                <td><b className="code">{numerKebaba(s.producedDate, s.batchNo)}</b></td>
                <td>{s.status !== 'planned' ? <span className="tag neutral">zeskanowana</span> : s.labelPrintedAt ? <span className="tag ok">wydrukowana</span> : <span className="tag warn">do druku</span>}</td>
                <td className="r"><button className="btn sm ghost" disabled={drukuje || s.status !== 'planned'} onClick={() => void drukujListe([s])}><Printer size={13} />Drukuj ponownie</button></td>
              </tr>
            ))}</tbody></table>
          </section>
        )
      })}</div>
    </Dialog>
  )
}
