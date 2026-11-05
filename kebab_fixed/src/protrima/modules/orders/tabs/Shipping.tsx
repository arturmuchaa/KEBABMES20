import React, { useState } from 'react'
import { CheckCircle2, CircleDashed, Truck, FileText, Printer, Split, ScanLine, Route, Ban, PencilLine } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { zaladunkiApi } from '@/lib/api'
import { computeMetrics, etapZamowienia, kg, num, palletKg, dueText, type Order } from '../../../data/model'
import { odm } from '../../../data/tekst'
import { FlagIcon, PalletStatusLabel } from '../../../ui/Glyphs'

type G = 'ok' | 'wait' | 'warn' | 'crit'
const GateIcon = ({ s }: { s: G }) => s === 'ok' ? <CheckCircle2 size={18} color="var(--ok)" aria-label="Spełnione" /> : s === 'wait' ? <CircleDashed size={18} color="var(--ink-4)" aria-label="Jeszcze nie" /> : <span className={`alert-ico ${s}`}><FlagIcon level={s} size={17} /></span>

/**
 * Wysyłka: co się dzieje z autem, co dalej i czy wszystko gotowe (bramki).
 * Zwykła droga: magazynier skanuje palety na auto i kończy kurs → biuro wystawia papiery kursu.
 * Bez skanowania załadunku: ręczne „Wystaw WZ…” albo podział wysyłki — przyciski drugorzędne.
 */
export function ShippingTab({ order }: { order: Order }) {
  const app = useApp()
  const m = computeMetrics(order)
  const etap = etapZamowienia(order, m).etap
  const foreign = !!order.client.country && order.client.country !== 'PL'
  const wzDocs = order.docs.filter(d => d.kind === 'WZ')
  const wzDoc = wzDocs[0]
  const cmrDoc = order.docs.find(d => d.kind === 'CMR')
  const draft = order.status === 'draft'
  const closed = order.status === 'done' || order.status === 'cancelled'
  const toShip = order.lines.reduce((a, l) => a + l.stock * l.kgPerUnit, 0)
  const plate = order.zaladunek?.plate
  // Kurs czeka na papiery tylko wtedy, gdy magazynier zakończył załadunek (etap „Załadowane”), a WZ jeszcze nie ma.
  // Samo „załadowano N palet” tego nie mówi (liczy też skanowanie w toku), a auto przy zamówieniu bywa
  // wzięte z już wystawionej WZ (numer rejestracyjny na dokumencie) — wtedy papiery są już zrobione.
  const kursCzeka = etap === 'zaladowane' && !wzDoc
  // Kurs w ogóle wchodzi w grę dopiero od skanowania: wcześniej przycisk kończyłby się komunikatem „nie czeka”.
  const zKursu = etap === 'zaladunek' || etap === 'zaladowane'
  // Ręczne wydanie nie dotyczy auta, które już zeskanowano i zamknięto — tam podział wybiera się w papierach kursu.
  const reczne = !closed && !draft && !kursCzeka
  const palet = (n: number) => odm(n, 'palety', 'palet', 'palet')
  // Papiery kursu = papiery KURSU, na którym jest to zamówienie (po załadunku).
  // Kursów czekających na papiery jest zwykle kilka — szukamy wśród nich tego zamówienia.
  const [szukam, setSzukam] = useState(false)
  const papieryKursu = async () => {
    setSzukam(true)
    try {
      for (const k of await zaladunkiApi.doWydruku()) {
        const d = await zaladunkiApi.get(k.id)
        if ((d?.pozycje ?? []).some((p: { order_id: string }) => p.order_id === order.id)) { app.openKurs(k.id, k.plate); return }
      }
      app.toast({ kind: 'info', title: 'To zamówienie nie czeka na papiery kursu', detail: 'Kurs pojawia się, gdy magazynier zakończy załadunek auta. Gdy towar wyjeżdża bez skanowania, wystaw WZ ręcznie („Wystaw WZ…”).' })
    } catch (e) {
      app.toast({ kind: 'warn', title: 'Nie udało się sprawdzić kursów', detail: e instanceof Error ? e.message : '' })
    } finally { setSzukam(false) }
  }

  // Co się teraz dzieje z wysyłką i co dalej — jedno zdanie z ikoną, dopisek drobniej.
  const stan: { ikona: React.ReactNode; t: string; d?: string; ok?: boolean } =
    order.status === 'cancelled' ? { ikona: <Ban size={18} />, t: 'Zamówienie anulowane.' }
    : order.status === 'done' ? { ikona: <CheckCircle2 size={18} />, ok: true, t: `Zamówienie zrealizowane${plate ? ` — wyjechało autem ${plate}` : ''}.`, d: 'Dokumenty i PDF — zakładka Dokumenty.' }
    : draft ? { ikona: <PencilLine size={18} />, t: 'Szkic — wysyłkę przygotujesz po potwierdzeniu zamówienia.' }
    : kursCzeka ? { ikona: <Truck size={18} />, t: `Auto${plate ? ` ${plate}` : ''} jest załadowane — kurs czeka na papiery.`, d: 'Jednym wystawieniem: WZ/WM, HDI i CMR dla kierowcy — całość albo podział na fakturę.' }
    : etap === 'zaladunek' ? { ikona: <ScanLine size={18} />, t: `Trwa załadunek: ${m.palletsLoaded} z ${m.palletsTotal} ${palet(m.palletsTotal)} na aucie.`, d: 'Papiery wystawisz, gdy magazynier zakończy kurs.' }
    : wzDoc ? { ikona: <CheckCircle2 size={18} />, ok: true, t: `Wystawiono ${wzDocs.map(d => d.number).join(', ')}.`, d: 'Numery i PDF — zakładka Dokumenty.' }
    : { ikona: <Route size={18} />, t: 'Zwykła droga: magazynier skanuje palety na auto i kończy kurs.', d: 'Wtedy wystawisz tu papiery kursu dla kierowcy (WZ/WM, HDI, CMR).' }

  // Palety zamkniętych zamówień nie są wczytywane (data/store.tsx) — bramki palet byłyby tam fałszywym „jeszcze nie”.
  const gates: Array<{ k: string; d: string; s: G }> = [
    { k: 'Wyrób kompletny', d: m.missingKg ? `brakuje ${kg(m.missingKg)}` : 'cała ilość w magazynie lub wydana', s: m.missingKg ? ((m.dueDays ?? 9) <= 1 ? 'crit' : 'wait') : 'ok' },
    ...(closed ? [] : [
      // Nierozpisane sztuki to zwykły stan w trakcie pracy — ostrzeżenie dopiero, gdy auto jedzie dziś/jutro.
      { k: 'Palety rozpisane', d: m.unassignedQty ? `${num(m.unassignedQty)} szt. bez palety` : m.palletsTotal ? `${m.palletsTotal} ${odm(m.palletsTotal, 'paleta', 'palety', 'palet')}` : 'nierozpisane', s: (m.unassignedQty ? ((m.dueDays ?? 9) <= 1 ? 'warn' : 'wait') : m.palletsTotal ? 'ok' : 'wait') as G },
      { k: 'Palety spakowane', d: `${m.palletsReady} z ${m.palletsTotal}`, s: (m.palletsTotal && m.palletsReady === m.palletsTotal ? 'ok' : 'wait') as G },
      { k: 'Załadowane (skan QR)', d: `${m.palletsLoaded} z ${m.palletsTotal}`, s: (m.palletsTotal && m.palletsLoaded === m.palletsTotal ? 'ok' : 'wait') as G },
    ]),
    { k: 'WZ / WM', d: wzDocs.map(d => d.number).join(', ') || 'brak dokumentu wydania', s: wzDoc?.state === 'issued' ? 'ok' : 'wait' },
    // Lista dokumentów zamówienia zna tylko WZ — CMR to tu przypomnienie dla otwartego zamówienia,
    // a przy zamkniętym nie wiemy, czy był, więc nie udajemy braku.
    ...(foreign && !closed ? [{ k: 'CMR', d: cmrDoc?.number ?? `dostawa za granicę (${order.client.country})`, s: (cmrDoc?.state === 'issued' ? 'ok' : 'wait') as G }] : []),
  ]
  const spelnione = gates.filter(g => g.s === 'ok').length

  return (
    <div className="dock-pad">
      <div className="ov-grid" style={{ ['--ov-cols' as string]: 'minmax(0, 2fr) minmax(0, 3fr)' }}>
        <div className="box ov-card ship-kurs">
          <h4><Truck size={16} />Kurs i papiery</h4>
          <dl className="kv">
            <dt>Wyjazd</dt><dd>{dueText(order)}</dd>
            {!closed && <><dt>Załadowano</dt><dd className="num">{m.palletsTotal ? `${m.palletsLoaded} z ${m.palletsTotal} ${palet(m.palletsTotal)}` : 'palety nierozpisane'}</dd></>}
            {plate && <><dt>Auto</dt><dd className="code ship-plate">{plate}</dd></>}
          </dl>
          <div className={`ship-stan${stan.ok ? ' ok' : ''}`}>
            {stan.ikona}
            <div><div className="ship-st">{stan.t}</div>{stan.d && <div className="ship-sd">{stan.d}</div>}</div>
          </div>
          {zKursu && (
            <div className="row-wrap">
              {/* Główny (kobaltowy) tylko, gdy kurs naprawdę czeka — przy skanowaniu w toku zwykły przycisk, który sprawdzi kursy. */}
              <button className={`btn${kursCzeka ? ' primary' : ''}`} disabled={szukam} onClick={() => void papieryKursu()} data-tip="Papiery całego auta po załadunku: WZ/WM, HDI i CMR">
                <Printer size={15} />{szukam ? 'Szukam kursu…' : 'Papiery kursu…'}</button>
            </div>
          )}
          {reczne && (
            <div className="ship-inne" aria-label="Wydanie bez skanowania załadunku">
              <div className="si-h">Towar wyjeżdża bez skanowania załadunku?</div>
              <button className="btn sm" disabled={toShip === 0} onClick={() => app.issueWz(order.id)} data-tip={toShip === 0 ? 'Brak wyrobu w magazynie do wydania' : undefined}><FileText size={14} />Wystaw WZ…</button>
              <span className="si-d">całość na WZ — zdejmuje towar ze stanu</span>
              <button className="btn sm" onClick={() => app.splitOrder(order.id)}><Split size={14} />Podział wysyłki…</button>
              <span className="si-d">część na fakturę, reszta na WZ</span>
            </div>
          )}
          <p className="ship-foot">Planowanie kursów i pojazdów — na razie w starym MES.</p>
        </div>
        <div className="box">
          <div className="panel-h"><h2 style={{ fontSize: 'var(--fs-md)' }}>Gotowość do wysyłki</h2><span className="sub num">spełniono {spelnione} z {gates.length}</span></div>
          <div className="gates">
            {gates.map(g => <div key={g.k} className="gate"><GateIcon s={g.s} /><div><div className="gk">{g.k}</div><div className="gd">{g.d}</div></div></div>)}
          </div>
        </div>
      </div>
      {order.pallets.length > 0 && <>
        <div className="sect-h"><h3>Kolejność załadunku</h3><span className="sub">wg numerów palet · skan QR potwierdza załadunek</span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Paleta</th><th>Karton</th><th className="num">Masa</th><th>Stan</th><th>Załadowano</th></tr></thead>
            <tbody>{order.pallets.map((p, i) => (
              <tr key={p.id} className={`row${i % 2 ? ' zebra' : ''}`}><td className="strong">Paleta {p.no}</td><td className="code">{p.carton}</td><td className="num">{kg(palletKg(order, p))}</td>
                <td><PalletStatusLabel status={p.status} /></td><td className="tnum">{p.loadedAt ?? <span className="faint">—</span>}</td></tr>))}</tbody>
          </table>
        </div>
      </>}
    </div>
  )
}
