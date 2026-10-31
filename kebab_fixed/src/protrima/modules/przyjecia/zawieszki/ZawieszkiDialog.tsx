import { useMemo, useRef, useState } from 'react'
import { Bookmark, Check, ChevronLeft, ChevronRight, Printer, Tag } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { FlagIcon } from '../../../ui/Glyphs'
import { SzkieletBloku } from '../../../ui/Szkielet'
import { kg, num, fmtDate } from '../../../data/model'
import { dataZApi } from '../../../data/mapuj'
import { DRUK_ETYKIET, PROBA } from '../../../proba'
import { useApi } from '@/hooks/useApi'
import { receptionsApi, suppliersApi } from '@/lib/api'
import { DEFAULT_CONTAINERS_PER_PALLET } from '@/features/raw-batches/palletTags'
import type { ReceptionTagInput } from '@/features/raw-batches/receptionTagZpl'
import { receptionTagsPrintJobs } from '@/features/raw-batches/receptionTagsPrint'
import { loadCalibration } from '@/features/raw-batches/tagPrinterCalibration'
import type { Reception } from '@/features/raw-batches/types'
import { drukujZawieszki, opisBledu } from '../../../drukarka/drukarka'
import { PanelDrukarki } from '../../../drukarka/PanelDrukarki'
import { UKLADY, wierszeZawieszek, zawieszkiWiersza, type Ustawienie, type WierszZawieszek } from './model'
import { PodgladZawieszki } from './PodgladZawieszki'

export const zawieszek = (n: number) => `${n} ${n === 1 ? 'zawieszka' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'zawieszki' : 'zawieszek'}`

/**
 * Zawieszki na palety przyjętej dostawy — każda paleta do chłodni dostaje
 * własną (numer porządkowy, „3 / 6”, waga). Kalkulator, nie formularz: zmiana
 * kalibru i układu palety przelicza liczbę zawieszek na oczach.
 * Druk bez obsługi (warstwa `drukarka/`): drukarkę, rolkę i skok taśmy
 * PROTRIMA ustala sama; ustawienia są schowane za cichym linkiem.
 * W wersji próbnej tylko podgląd — rysowany z tego samego ZPL.
 */
export function ZawieszkiDialog({ receptionId, onClose }: { receptionId: string; onClose: () => void }) {
  const app = useApp()
  const recRes = useApi(() => receptionsApi.byId(receptionId), [receptionId])
  const supRes = useApi(() => suppliersApi.list())
  const r = recRes.data as Reception | null
  const dostawca = ((supRes.data ?? []) as Array<{ id: string; name: string; containersPerPallet?: number | null }>).find(s => s.id === r?.supplierId)
  const uklad = dostawca?.containersPerPallet ?? DEFAULT_CONTAINERS_PER_PALLET

  const [ust, setUst] = useState<Record<string, Ustawienie>>({})
  const wiersze = useMemo(() => (r ? wierszeZawieszek(r, ust, uklad) : []), [r, ust, uklad])
  const zmien = (w: WierszZawieszek, patch: Partial<Ustawienie>) => setUst(p => ({ ...p, [w.batch.id]: { ...w.ustawienie, ...patch } }))
  const ustawUklad = (perPallet: number) => setUst(Object.fromEntries(wiersze.map(w => [w.batch.id, { ...w.ustawienie, perPallet }])))
  const ukladTeraz = wiersze.length && wiersze.every(w => w.ustawienie.perPallet === wiersze[0].ustawienie.perPallet) ? wiersze[0].ustawienie.perPallet : null
  const razem = wiersze.reduce((a, w) => a + w.plan.tags.length, 0)
  const brakKalibru = wiersze.some(w => w.plan.containers === null)

  const [widok, setWidok] = useState<'zawieszki' | 'drukarka'>('zawieszki')
  // Nastawa stanowiska wchodzi w ZPL (przesunięcia) — podgląd czyta ją po powrocie z ustawień drukarki.
  const cal = useMemo(() => loadCalibration(), [widok]) // eslint-disable-line react-hooks/exhaustive-deps
  const [podglad, setPodglad] = useState<{ batchId: string; i: number } | null>(null)
  const wPodgladu = wiersze.find(w => w.batch.id === podglad?.batchId) ?? wiersze.find(w => w.plan.tags.length) ?? null
  const tagiPodgladu = r && wPodgladu ? zawieszkiWiersza(r, wPodgladu) : []
  const iPodgladu = Math.min(podglad && wPodgladu && podglad.batchId === wPodgladu.batch.id ? podglad.i : 0, Math.max(0, tagiPodgladu.length - 1))
  const zplPodgladu = tagiPodgladu.length ? receptionTagsPrintJobs([tagiPodgladu[iPodgladu]], cal)[0] : ''

  const lock = useRef(false)
  const [druk, setDruk] = useState<{ stan: 'trwa' | 'ok' | 'blad'; tekst: string } | null>(null)
  const drukuj = async (tags: ReceptionTagInput[]) => {
    if (PROBA) { app.toast({ kind: 'warn', title: 'Druk zawieszek', detail: DRUK_ETYKIET }); return }
    if (lock.current || !tags.length) return
    lock.current = true
    setDruk({ stan: 'trwa', tekst: 'Łączę z drukarką…' })
    try {
      await drukujZawieszki(tags, {
        onStatus: tekst => setDruk({ stan: 'trwa', tekst }),
        onProgress: (s, t) => setDruk({ stan: 'trwa', tekst: `Drukuję ${s} / ${t}…` }),
      })
      setDruk({ stan: 'ok', tekst: `Wydrukowano ${zawieszek(tags.length)}.` })
    } catch (e) {
      setDruk({ stan: 'blad', tekst: await opisBledu(e) })
    } finally { lock.current = false }
  }
  const trwa = druk?.stan === 'trwa'

  const zapamietaj = async () => {
    if (!dostawca || !ukladTeraz) return
    try {
      await suppliersApi.setPalletLayout(dostawca.id, ukladTeraz)
      app.toast({ kind: 'ok', title: `Zapamiętano: ${ukladTeraz} pojemników na palecie`, detail: dostawca.name })
      void supRes.refetch()
    } catch (e) { app.toast({ kind: 'warn', title: 'Nie zapisano układu palety', detail: e instanceof Error ? e.message : '' }) }
  }

  if (widok === 'drukarka') return (
    <Dialog title="Drukarka etykiet" icon={<Printer size={20} />} onClose={onClose}
      footer={<button className="btn" onClick={() => setWidok('zawieszki')} data-autofocus><ChevronLeft size={15} />Wróć do zawieszek</button>}>
      <PanelDrukarki />
    </Dialog>
  )

  return (
    <Dialog xl title={r ? <>Zawieszki palet <span className="muted">· {r.receptionNo}</span></> : 'Zawieszki palet'} icon={<Tag size={20} />} onClose={onClose}
      footer={<>
        <span className="left">{r ? <>Razem <b>{zawieszek(razem)}</b></> : ''}</span>
        <button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" disabled={!r || trwa || razem === 0} onClick={() => r && void drukuj(wiersze.flatMap(w => zawieszkiWiersza(r, w)))} data-autofocus>
          <Printer size={15} />{trwa ? 'Drukowanie…' : 'Drukuj wszystkie'}</button>
      </>}>
      {recRes.error && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się wczytać dostawy: {recRes.error}</div></div>}
      {!r && !recRes.error && <SzkieletBloku linie={4} opis="Wczytywanie dostawy…" />}
      {r && <div className="tags-grid">
        <div className="tags-main">
          <p className="muted" style={{ margin: 0 }}>{r.supplierName || '—'} · przyjęte {fmtDate(dataZApi(r.receivedDate))} · {kg(r.batches.filter(b => b.status !== 'cancelled').reduce((a, b) => a + b.kgReceived, 0))}</p>
          <div className="row-wrap">
            <span className="label">Układ palety</span>
            <div className="seg" role="group" aria-label="Układ palety">
              {UKLADY.map(u => <button key={u.perPallet} type="button" aria-pressed={ukladTeraz === u.perPallet} onClick={() => ustawUklad(u.perPallet)}>{u.naWarstwe} na warstwę = {u.perPallet}</button>)}
            </div>
            {dostawca && ukladTeraz && ukladTeraz !== uklad && <button className="btn sm ghost" onClick={() => void zapamietaj()}><Bookmark size={14} />Zapamiętaj {ukladTeraz} u dostawcy</button>}
          </div>
          <div className="box"><table className="tbl tags-tbl">
            <thead><tr>
              <th>Nr porządkowy</th><th className="num">Waga netto</th><th className="num">Kaliber</th><th className="num">Na palecie</th>
              <th className="num">Pojemników</th><th>Palety</th><th className="num">Zawieszek</th><th />
            </tr></thead>
            <tbody>{wiersze.map(w => (
              <tr key={w.batch.id} className={`row click${wPodgladu?.batch.id === w.batch.id ? ' sel' : ''}`} onClick={() => setPodglad({ batchId: w.batch.id, i: 0 })}>
                <td className="strong code">{w.batch.internalBatchNo}</td>
                <td className="num">{kg(w.batch.kgReceived)}</td>
                <td className="num" onClick={e => e.stopPropagation()}><input className="field num" inputMode="decimal" aria-label={`Kaliber kg, ${w.batch.internalBatchNo}`}
                  value={w.ustawienie.containerKg ?? ''} placeholder="kg" onChange={e => { const v = e.target.value.replace(',', '.'); zmien(w, { containerKg: v === '' ? null : Number(v) || null, reczneLiczenie: false }) }} /></td>
                <td className="num" onClick={e => e.stopPropagation()}><input className="field num" inputMode="numeric" aria-label={`Pojemników na palecie, ${w.batch.internalBatchNo}`}
                  value={w.ustawienie.perPallet || ''} onChange={e => zmien(w, { perPallet: Number(e.target.value) || 0 })} /></td>
                <td className="num" aria-label={`Pojemników, ${w.batch.internalBatchNo}`}>{w.plan.containers === null ? <span className="warn-ink">brak kalibru</span> : num(w.plan.containers)}{w.ustawienie.reczneLiczenie && w.plan.containers !== null && <span className="sub" data-tip="Przeliczone ręcznie na rampie">ręcznie</span>}</td>
                <td className="muted">{w.plan.containers === null ? '—' : `${w.plan.fullPallets} pełnych${w.plan.restContainers > 0 ? ` + ${w.plan.restContainers} poj.` : ''}`}</td>
                <td className="num strong" aria-label={`Zawieszek, ${w.batch.internalBatchNo}`}>{w.plan.containers === null ? '—' : w.plan.tags.length}</td>
                <td className="num" onClick={e => e.stopPropagation()}><button className="btn sm" disabled={trwa || !w.plan.tags.length} onClick={() => void drukuj(zawieszkiWiersza(r, w))} aria-label={`Drukuj ${w.batch.internalBatchNo}`}><Printer size={14} />Drukuj</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          {brakKalibru && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Uzupełnij kaliber pojemnika — bez niego nie wiadomo, ile pojemników przyjechało, a zawieszki nie mogą zgadywać liczby palet.</div></div>}
          {druk?.stan === 'blad' && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{druk.tekst} <button className="link-quiet inline" onClick={() => setWidok('drukarka')}>Ustawienia drukarki</button></div></div>}
          <div className="tags-foot">
            {druk && druk.stan !== 'blad' && <span className={`print-line${druk.stan === 'ok' ? ' ok' : ''}`} role="status">{druk.stan === 'ok' && <Check size={14} />}{druk.tekst}</span>}
            {PROBA && <span className="print-line">Wersja próbna: zawieszki się nie drukują — podgląd obok pokazuje, co wyjdzie z drukarki.</span>}
            <button className="link-quiet" onClick={() => setWidok('drukarka')}><Printer size={13} />Drukarka etykiet</button>
          </div>
        </div>
        <aside className="tags-side" aria-label="Podgląd zawieszki">
          {zplPodgladu ? <>
            <PodgladZawieszki zpl={zplPodgladu} opis={`Podgląd zawieszki ${tagiPodgladu[iPodgladu].batchNo}, paleta ${iPodgladu + 1} z ${tagiPodgladu.length}`} />
            <div className="tags-nav">
              <button className="btn sm icon ghost" disabled={iPodgladu <= 0} onClick={() => wPodgladu && setPodglad({ batchId: wPodgladu.batch.id, i: iPodgladu - 1 })} aria-label="Poprzednia zawieszka"><ChevronLeft size={15} /></button>
              <span><b className="code">{tagiPodgladu[iPodgladu].batchNo}</b> · paleta {iPodgladu + 1} / {tagiPodgladu.length}</span>
              <button className="btn sm icon ghost" disabled={iPodgladu >= tagiPodgladu.length - 1} onClick={() => wPodgladu && setPodglad({ batchId: wPodgladu.batch.id, i: iPodgladu + 1 })} aria-label="Następna zawieszka"><ChevronRight size={15} /></button>
            </div>
          </> : <div className="empty">Podgląd pojawi się, gdy da się policzyć palety.</div>}
        </aside>
      </div>}
    </Dialog>
  )
}
