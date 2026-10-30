import { useRef, useState } from 'react'
import { Ban } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { kg, fmtDate } from '../../data/model'
import { dataZApi } from '../../data/mapuj'
import { FlagIcon } from '../../ui/Glyphs'
import { rawBatchesApi, receptionsApi } from '@/lib/api'
import type { NumerPorzadkowy, Przyjecie } from '../../data/przyjecia'

/** Dlaczego numeru nie da się anulować — słowami operatora. */
export function powodBlokady(x: NumerPorzadkowy): string | null {
  if (x.stan === 'cancelled') return 'już anulowany'
  if (x.cancellable) return null
  if (x.kgReserved > 0) return `${kg(x.kgReserved)} zarezerwowane pod plan masowania`
  if (x.requiresDeboning) return x.kgLeft <= 0 ? 'cały rozebrany' : 'część poszła na rozbiór'
  return x.kgLeft <= 0 ? 'całe mięso zużyte' : 'część mięsa zużyta albo wydana'
}

/**
 * Anulowanie przyjęcia — cała dostawa (PATCH /receptions/{id}/cancel,
 * wszystko albo nic) albo pojedynczy numer (PATCH /raw-batches/{id}/cancel).
 *
 * Okno pokazuje TOŻSAMOŚĆ dostawy (numer, dostawca, surowiec, kg, data), nie
 * sam numer: 19.08.2026 w starym MES anulowano w ciemno SZUMERĘ 4700 kg zamiast
 * dostawy KOKO. Numer, z którego coś poszło dalej, jest zablokowany z powodem —
 * backend i tak odrzuciłby anulowanie.
 */
export function AnulujPrzyjecie({ p, supplier, onClose, onDone }: {
  p: Przyjecie; supplier: string; onClose: () => void; onDone: () => void
}) {
  const app = useApp()
  const zywe = p.numery.filter(x => x.stan !== 'cancelled')
  const zablokowane = zywe.filter(x => !x.cancellable)
  const [busy, setBusy] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)

  const anuluj = async (cel: 'all' | NumerPorzadkowy) => {
    if (lock.current) return
    lock.current = true; setBusy(cel === 'all' ? 'all' : cel.id); setBlad(null)
    try {
      if (cel === 'all') {
        const out = await receptionsApi.cancel(p.id)
        app.toast({ kind: 'ok', title: `Przyjęcie ${p.no} anulowane`, detail: `${out.cancelled} ${out.cancelled === 1 ? 'numer wrócił' : 'numery wróciły'} do puli · ${kg(p.kgReceived)} zdjęte ze stanu.` })
      } else {
        await rawBatchesApi.cancel(cel.id)
        app.toast({ kind: 'ok', title: `Numer ${cel.no} anulowany`, detail: `${kg(cel.kgReceived)} zdjęte ze stanu, numer wrócił do puli.` })
      }
      onDone()
    } catch (e) {
      // 409 z backendu mówi, który numer jest już ruszony — pokazujemy wprost.
      setBlad(e instanceof Error ? e.message : 'Nie udało się anulować')
    } finally { lock.current = false; setBusy(null) }
  }

  const materialy = [...new Set(zywe.map(x => x.material))].join(', ')
  const calosc = zywe.length > 0 && zablokowane.length === 0
  return (
    <Dialog title="Anulować przyjęcie?" icon={<Ban size={20} color="var(--crit)" />} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button className="btn" onClick={onClose} disabled={!!busy} data-autofocus>Nie, wróć</button>
        {zywe.length > 0 && <button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} disabled={!calosc || !!busy}
          data-tip={calosc ? undefined : 'Część numerów poszła już dalej — anuluj pojedyncze numery albo popraw dostawę'}
          onClick={() => void anuluj('all')}><Ban size={15} />{busy === 'all' ? 'Anulowanie…' : zywe.length > 1 ? `Anuluj całą dostawę (${zywe.length} nr)` : 'Anuluj przyjęcie'}</button>}
      </>}>
      <div className="box rec-id" aria-label="Anulowana dostawa">
        <div className="l1"><b className="code">{p.no || '—'}</b><span>{materialy || 'surowiec'}</span></div>
        <div className="l2"><b>{supplier}</b></div>
        <div className="muted">{kg(p.kgReceived)} · przyjęta {fmtDate(dataZApi(p.date))}{p.hdiNo ? ` · HDI ${p.hdiNo}` : ''}</div>
      </div>
      <p>Po anulowaniu kilogramy znikną ze stanu, dostawa zostanie w historii jako anulowana, a numery wrócą do puli — będzie można przyjąć pod nimi ponownie.</p>
      {zywe.length > 1 && <div className="box"><table className="tbl">
        <thead><tr><th>Nr</th><th>Surowiec</th><th className="num">Przyjęto</th><th>Stan</th><th /></tr></thead>
        <tbody>{zywe.map(x => {
          const powod = powodBlokady(x)
          return <tr key={x.id} className="row">
            <td className="code strong">{x.no}</td><td>{x.material}</td><td className="num">{kg(x.kgReceived)}</td>
            <td>{powod ? <span className="warn-ink">{powod}</span> : <span className="ok-ink">nietknięty</span>}</td>
            <td className="r"><button className="btn sm danger" disabled={!!powod || !!busy} onClick={() => void anuluj(x)}>{busy === x.id ? 'Anulowanie…' : `Anuluj nr ${x.no}`}</button></td>
          </tr>
        })}</tbody>
      </table></div>}
      {zywe.length === 1 && zablokowane.length === 1 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Nie można anulować: {powodBlokady(zywe[0])}. Popraw dostawę edycją albo korektą stanu w starym MES.</div></div>}
      {zywe.length > 1 && zablokowane.length > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Całej dostawy nie da się anulować — {zablokowane.map(x => `nr ${x.no}`).join(', ')} {zablokowane.length === 1 ? 'poszedł' : 'poszły'} już dalej. Anuluj pojedyncze nietknięte numery.</div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
