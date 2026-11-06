import React from 'react'
import { useApp } from '../../../shell/context'
import type { DetailTab } from '../../../shell/context'
import { kg, relDay, type Metrics, type Order } from '../../../data/model'
import { nastepnyKrok, type Krok } from '../../../data/krok'
import { odm } from '../../../data/tekst'
import { StageNode } from '../../../ui/Glyphs'
import type { ZaladunekDoWydruku } from '@/lib/api'

interface Pozycja { key: string; no: string; opis: React.ReactNode; pilne: boolean; run: () => void }
interface Pas {
  kod: string; tytul: string; pozycje: Pozycja[]; pusto: string
  /** Liczba spraw, gdy pas ma jedną zbiorczą pozycję (HACCP: N dostaw) — inaczej liczba pozycji. */
  ile?: number
  /** Dokąd prowadzi „i jeszcze N…” — tam, gdzie widać resztę tego pasa. */
  wiecej: () => void
}

const ILE_W_PASIE = 4

/**
 * Pulpit, wariant B: „Do zrobienia teraz” — czynności biura pogrupowane tym samym słowem,
 * co kolumna „Dalej” na liście zamówień. Pasy stoją zawsze w tej samej kolejności
 * (pracownik uczy się miejsc), pusty pas mówi „nic”. Czekanie na halę i auto — w stopce.
 */
export function DoZrobieniaPanel({ open, pending, haccp, kursy }: {
  open: Array<{ o: Order; m: Metrics }>; pending: number; haccp: number; kursy: ZaladunekDoWydruku[]
}) {
  const app = useApp()
  const z = open.map(x => ({ ...x, k: nastepnyKrok(x.o, x.m) }))
  const poz = (o: Order, m: Metrics, k: Krok): Pozycja => ({
    key: o.id, no: o.no, pilne: k.pilne,
    opis: <>
      {o.client.name} · {k.pilne ? <b>{relDay(o.delivery)}</b> : o.delivery ? relDay(o.delivery) : 'bez terminu'}
      {/* Pilne rozpisanie palet przy braku wyrobu — brak nie może zniknąć za krokiem „palety”.
          Przed „szt. bez palety”: wąski pas ucina koniec opisu, a nazwa pasa i tak mówi o paletach. */}
      {k.kod === 'palety' && m.missingKg > 0 && <> · <span className={k.pilne ? 'crit-ink' : undefined}>brak {kg(m.missingKg)}</span></>}
      {k.dopisek && (k.kod === 'palety' || k.kod === 'papiery') ? ` · ${k.dopisek}` : ''}
    </>,
    run: () => app.gotoOrders({ select: o.id, tab: k.tab as DetailTab, view: 'active' }),
  })
  const wg = (kod: Krok['kod']) => z.filter(x => x.k.kod === kod)
    .sort((a, b) => Number(b.k.pilne) - Number(a.k.pilne) || (a.m.dueDays ?? 999) - (b.m.dueDays ?? 999))
    .map(x => poz(x.o, x.m, x.k))

  const papiery: Pozycja[] = kursy.filter(k => k.rozjazd || k.doWystawienia).map(k => ({
    key: `kurs-${k.id}`, no: k.plate || 'Kurs bez numeru auta', pilne: !!k.rozjazd,
    opis: <>{k.klienci.join(', ') || '—'}{k.rozjazd ? <> · <b>rozjazd z dokumentem</b></> : ''}</>,
    run: () => app.openKurs(k.id, k.plate),
  }))

  const pasy: Pas[] = [
    { kod: 'potwierdz', tytul: 'Potwierdź', pozycje: wg('potwierdz'), pusto: 'Brak szkiców do potwierdzenia.', wiecej: () => app.gotoOrders({ view: 'drafts' }) },
    { kod: 'palety', tytul: 'Rozpisz palety', pozycje: wg('palety'), pusto: 'Wyrób gotowy ma rozpisane palety.', wiecej: () => app.gotoOrders({ view: 'active' }) },
    // Kursy są na Pulpicie niżej (panel „Kursy po załadunku”), nie na liście zamówień.
    { kod: 'papiery', tytul: 'Papiery kursu', pozycje: papiery, pusto: 'Żaden kurs nie czeka na papiery.', wiecej: () => document.querySelector('.dash .p-ship')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) },
    { kod: 'haccp', tytul: 'Kontrola HACCP', ile: haccp, pozycje: haccp > 0 ? [{ key: 'haccp', no: `${haccp} ${odm(haccp, 'dostawa', 'dostawy', 'dostaw')}`, pilne: false, opis: 'bez kompletu kontroli · ostatnie 14 dni', run: () => app.openModule('przyjecia') }] : [], pusto: 'Kontrole przyjęć są kompletne.', wiecej: () => app.openModule('przyjecia') },
  ]
  const ile = (p: Pas) => p.ile ?? p.pozycje.length
  const czynnosci = pasy.reduce((a, p) => a + ile(p), 0)
  const pilnych = pasy.reduce((a, p) => a + p.pozycje.filter(x => x.pilne).length, 0)

  // Czekanie na wyrób liczone z braku, nie z kroku — tak samo jak „Zamówienia” w Przebiegu dnia
  // (pilne zamówienie bez wyrobu ma krok „Rozpisz palety”, a nadal czeka na wyrób).
  const zBrakiem = z.filter(x => x.o.status !== 'draft' && x.m.missingKg > 0)
  const czekaWyrob = zBrakiem.length
  const brakPilny = zBrakiem.filter(x => x.k.pilne).length
  const czekaAuto = wg('czeka-zaladunek').length
  const wZaladunku = wg('w-zaladunku').length

  return (
    <section className="panel p-attn" aria-label="Do zrobienia teraz">
      <div className="panel-h">
        <h2>Do zrobienia teraz</h2>
        <span className="sub">{czynnosci ? `${czynnosci} ${odm(czynnosci, 'czynność', 'czynności', 'czynności')} dla biura${pilnych ? ` · ${pilnych} ${odm(pilnych, 'pilna', 'pilne', 'pilnych')}` : ''}` : 'nic od ręki'}</span>
      </div>
      <div className="todo-lanes">
        {pasy.map(p => (
          <div key={p.kod} className={`todo-lane${p.pozycje.length ? '' : ' pusty'}`}>
            <h3>{p.tytul}<span className={`badge${p.pozycje.some(x => x.pilne) ? ' warn' : ''}`}>{ile(p)}</span></h3>
            {p.pozycje.length === 0 && <div className="todo-none">{p.pusto}</div>}
            {p.pozycje.slice(0, ILE_W_PASIE).map(x => (
              <button key={x.key} className={`todo-it${x.pilne ? ' pilne' : ''}`} onClick={x.run}>
                <span className="ti-1">{x.pilne && <StageNode level="warn" size={10} />}<span className="ti-no">{x.no}</span></span>
                <span className="ti-2">{x.opis}</span>
              </button>
            ))}
            {p.pozycje.length > ILE_W_PASIE && <button className="todo-more" onClick={p.wiecej}>i jeszcze {p.pozycje.length - ILE_W_PASIE}…</button>}
          </div>
        ))}
      </div>
      <div className="panel-f todo-wait">
        <span className="tw-h">Czekamy na:</span>
        <span>wyrób <b>{czekaWyrob}</b> {odm(czekaWyrob, 'zamówienie', 'zamówienia', 'zamówień')}{brakPilny > 0 && <span className="crit-ink"> ({brakPilny} z wyjazdem dziś/jutro lub po terminie)</span>}</span>
        <span>załadunek <b>{czekaAuto}</b></span>
        {wZaladunku > 0 && <span>w załadunku <b>{wZaladunku}</b></span>}
        {pending > 0 && <span>sesje produkcji do potwierdzenia <b>{pending}</b> (stary MES)</span>}
      </div>
    </section>
  )
}
