import React, { useEffect, useId, useMemo, useState } from 'react'
import { Eye, Printer, ClipboardList, Truck, FileText, Split, Boxes, PackageMinus, Hash } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { computeMetrics, kg, type Order } from '../../../data/model'
import { ile } from '../../../data/tekst'
import { FlagIcon } from '../../../ui/Glyphs'
import { clientOrdersApi, downloadDocPdf, wzApi, type OrderDocuments } from '@/lib/api'
import { papieryPozycji, saldoPozycji } from '../../wysylki/kurs'
import { DrukujZaznaczone, PapierChip, useZaznaczonePapiery } from '../../wysylki/Papiery'

/**
 * Dokumenty zamówienia — dwie grupy, żeby skutek było widać przed kliknięciem:
 * „Wydruki” niczego nie zmieniają w systemie, „Dokumenty wydania” nadają numer,
 * a WZ (także z podziału wysyłki) dodatkowo zdejmuje towar ze stanu.
 * „Wszystkie dokumenty zamówienia”: WM/WZ, HDI, CMR i zestawienie należności w jednej
 * liście (także po realizacji) — ptaszek przy dokumencie i „Drukuj zaznaczone” składa
 * jeden PDF. Gdy serwer nie odda listy, zostaje dotychczasowa lista WZ/WM z zamówienia.
 */
const dzisIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dataPl = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : iso || '—')

export function DocumentsTab({ order }: { order: Order }) {
  const app = useApp()
  const id = useId()
  const [pytajHdi, setPytajHdi] = useState(false)
  const draft = order.status === 'draft'
  const closed = order.status === 'done' || order.status === 'cancelled'
  const palet = order.pallets.length
  const najpierw = 'Najpierw potwierdź zamówienie'
  const [dok, setDok] = useState<OrderDocuments | null>(null)
  // Liczba WZ w zamówieniu zmienia się po wystawieniu — wtedy lista wczytuje się od nowa.
  useEffect(() => {
    let zywe = true
    Promise.resolve().then(() => clientOrdersApi.documents(order.id)).then(d => { if (zywe) setDok(d) }).catch(() => { if (zywe) setDok(null) })
    return () => { zywe = false }
  }, [order.id, order.docs.length, order.status])
  const papiery = useMemo(() => {
    if (!dok) return []
    const saldo = saldoPozycji(dok, dzisIso())
    return [...papieryPozycji(dok), ...(saldo ? [{ ...saldo, data: dzisIso() }] : [])]
  }, [dok])
  const z = useZaznaczonePapiery(papiery, `${order.no} — dokumenty`)
  const pdf = async (docId: string, nr?: string) => {
    try { await downloadDocPdf(wzApi.pdfUrl(docId), `${(nr ?? 'WZ').replace(/\//g, '-')}.pdf`) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
  }
  return (
    <div className="dock-pad">
      <div className="doc-groups">
        <section className="doc-group" aria-labelledby={`${id}-wydruki`}>
          <div className="sect-h"><h3 id={`${id}-wydruki`}>Wydruki</h3><span className="sub">nic nie zmieniają w systemie</span></div>
          <div className="doc-tiles">
            <Kafel tytul="Zamówienie" opis="dla klienta, A4 z logo" ikona={<Printer size={18} />} onClick={() => app.printOrder(order.id)} />
            <Kafel tytul="Lista kompletacji" opis="wewnętrzna, z kratkami i paletami" ikona={<ClipboardList size={18} />} onClick={() => app.printPicking([order.id])} />
            {/* Zamknięte zamówienia nie wczytują palet (data/store.tsx) — „nierozpisane” byłoby tam nieprawdą. */}
            <Kafel tytul="Kartki palet" opis={palet ? `${ile(palet, 'paleta', 'palety', 'palet')}, kartki z kodem QR` : closed ? 'palet zamkniętego zamówienia nie wczytujemy' : 'palety nie są jeszcze rozpisane'}
              ikona={<Boxes size={18} />} onClick={() => app.printPallets(order.id)}
              wylaczony={palet ? undefined : closed ? 'Zamówienie zamknięte' : 'Najpierw rozpisz palety (zakładka Palety)'} />
          </div>
        </section>

        <section className="doc-group wyd" aria-labelledby={`${id}-wydanie`}>
          <div className="sect-h"><h3 id={`${id}-wydanie`}>Dokumenty wydania</h3><span className="sub">nadają numer</span></div>
          <div className="doc-tiles">
            <Kafel tytul="Wystaw WZ…" opis="wydanie towaru do klienta" ikona={<Truck size={18} />} skutek="stan"
              onClick={() => app.issueWz(order.id)} wylaczony={draft ? najpierw : closed ? 'Zamówienie zamknięte' : undefined} />
            {/* Zamknięte zamówienie: HDI jest zamrożone, ponowne otwarcie tylko je pokazuje — bez pytania. */}
            <Kafel tytul={closed ? 'Podgląd HDI' : 'Wystaw HDI…'} opis={closed ? 'zamrożone po realizacji' : 'na stan faktyczny wyrobu'} ikona={<FileText size={18} />}
              skutek={closed ? undefined : 'numer'} onClick={() => (closed ? app.genHdi(order.id) : setPytajHdi(true))} wylaczony={draft ? najpierw : undefined} />
            <Kafel tytul="Wystaw CMR…" opis="list przewozowy: przewoźnik, faktura" ikona={<FileText size={18} />} skutek="numer"
              onClick={() => app.openCmr(order.id)} wylaczony={draft ? najpierw : undefined} />
            <Kafel tytul="Podział wysyłki…" opis="część na fakturę, reszta na WZ" ikona={<Split size={18} />} skutek="stan"
              onClick={() => app.splitOrder(order.id)} wylaczony={draft ? najpierw : closed ? 'Zamówienie zamknięte' : undefined} />
          </div>
        </section>
      </div>

      {dok ? <>
        <div className="sect-h"><h3>Wszystkie dokumenty zamówienia</h3><span className="sub">zaznacz ptaszkiem, co drukujesz — wyjdzie jeden PDF</span>
          <span style={{ marginLeft: 'auto' }} className="row-wrap">
            {papiery.length > 0 && <button className="btn sm ghost" disabled={!!z.busy} onClick={() => z.ustaw(papiery.map(p => p.key), z.zaznaczone.length !== papiery.length)}>
              {z.zaznaczone.length === papiery.length ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}</button>}
            <DrukujZaznaczone z={z} />
          </span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Dokument</th><th className="hide-s" style={{ width: 130 }}>Data</th></tr></thead>
            <tbody>
              {papiery.length === 0 && <tr><td colSpan={2} className="docs-empty">Z tego zamówienia nie wystawiono jeszcze żadnego dokumentu.</td></tr>}
              {papiery.map((p, i) => (
                <tr key={p.key} className={`row${i % 2 ? ' zebra' : ''}`}>
                  <td><PapierChip p={p} z={z} /></td>
                  <td className="tnum hide-s muted">{p.key.startsWith('saldo-') ? 'na dziś' : dataPl(p.data)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </> : <>
      <div className="sect-h"><h3>Wystawione WZ / WM</h3><span className="sub">dokumenty wydania powiązane z zamówieniem</span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Numer</th><th className="hide-s">Data</th><th>Stan</th><th className="r">Podgląd</th></tr></thead>
            <tbody>
              {order.docs.length === 0 && <tr><td colSpan={4} className="docs-empty">Z tego zamówienia nie wystawiono jeszcze WZ ani WM.</td></tr>}
              {order.docs.map((d, i) => (
                <tr key={d.id ?? `${d.number ?? ''}-${i}`} className={`row${i % 2 ? ' zebra' : ''}`}>
                  <td className="tnum strong">{d.number}</td>
                  <td className="tnum hide-s">{d.date ?? '—'}</td>
                  <td className="muted">{d.note}</td>
                  <td className="r">{d.id && <button className="btn sm ghost" onClick={() => void pdf(d.id!, d.number)}><Eye size={14} />PDF</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      <div className="note"><FlagIcon level="info" size={15} /><div>Anulowanie WZ, edycja HDI i rejestr wszystkich dokumentów — w module „Dokumenty WZ, CMR, HDI” starego MES.</div></div>
      {pytajHdi && <PotwierdzenieHdi order={order} onClose={() => setPytajHdi(false)} onConfirm={(przed, usluga) => { setPytajHdi(false); if (przed) app.genHdi(order.id, true, usluga); else app.genHdi(order.id) }} />}
    </div>
  )
}

/** Skutek dokumentu wydania — słowem i ikoną, nie kolorem. */
const SKUTEK = {
  stan: { ikona: <PackageMinus size={14} aria-hidden="true" />, tekst: 'zdejmuje towar ze stanu' },
  numer: { ikona: <Hash size={14} aria-hidden="true" />, tekst: 'nadaje numer' },
} as const

function Kafel({ tytul, opis, ikona, skutek, onClick, wylaczony }: {
  tytul: string; opis: string; ikona: React.ReactNode; skutek?: keyof typeof SKUTEK; onClick: () => void
  /** Powód blokady — kafel jest wtedy wyszarzony, powód w podpowiedzi. */
  wylaczony?: string
}) {
  return (
    <button className="doc-tile" onClick={onClick} disabled={!!wylaczony} data-tip={wylaczony}>
      <span className="dt-ico">{ikona}</span>
      <span className="dt-t">{tytul}</span>
      <span className="dt-d">{opis}</span>
      {skutek && <span className={`dt-s ${skutek}`}>{SKUTEK[skutek].ikona}{SKUTEK[skutek].tekst}</span>}
    </button>
  )
}

/**
 * Pytanie przed wystawieniem HDI — numer HDI raz nadany zostaje na stałe.
 * Przeglądarka nie wie, czy HDI tego zamówienia już istnieje (lista dokumentów zamówienia
 * zna tylko WZ), więc okno mówi o obu przypadkach. Liczby „na stan faktyczny” podaje
 * dopiero serwer; tu tylko ostrzeżenie, gdy brakuje wyrobu.
 * Wywołanie zostaje w rodzicu (app.genHdi) — generujHdi woła serwer od razu.
 */
export function PotwierdzenieHdi({ order, onClose, onConfirm }: { order: Order; onClose: () => void; onConfirm: (przedZaladunkiem?: boolean, usluga?: boolean) => void }) {
  const m = computeMetrics(order)
  const usluga = order.lines.some(l => l.usluga)
  const tylkoUsluga = usluga && order.lines.every(l => l.usluga)
  return (
    <Dialog title="Wystawić HDI?" icon={<FileText size={20} color="var(--ink-2)" />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Wróć</button>
        {usluga && <button className="btn" onClick={() => onConfirm(true, true)} data-tip="Osobne HDI na towar usługobiorcy, z rozpisu zamówienia — przed załadunkiem"><FileText size={15} />HDI usługa przed załadunkiem</button>}
        {!tylkoUsluga && <button className="btn" onClick={() => onConfirm(true)} data-tip="Z rozpisu zamówienia, bez skanów — do wysłania klientowi przed załadunkiem"><FileText size={15} />HDI przed załadunkiem</button>}
        <button className="btn primary" onClick={() => onConfirm()}><FileText size={15} />Wystaw HDI</button></>}>
      <p className="hdi-kto">Zamówienie <b>{order.no}</b> · {order.client.name}</p>
      <ul className="hdi-pyt">
        <li><Hash size={16} aria-hidden="true" /><span><b>Pierwsze wystawienie nada numer HDI.</b> Numer zostaje na stałe — nie wraca do puli.</span></li>
        <li><FileText size={16} aria-hidden="true" /><span><b>Ponowne odświeży treść</b> tego samego HDI, dopóki jest wstępny — bez nowego numeru.</span></li>
      </ul>
      <div className="note info"><FlagIcon level="info" size={15} /><div><b>Klient chce HDI przed załadunkiem?</b> „HDI przed załadunkiem” wystawia dokument z rozpisu zamówienia, zanim towar wjedzie na auto. Po załadunku ten sam numer przeliczy się ze skanów.</div></div>
      {usluga && <div className="note info"><FlagIcon level="info" size={15} /><div><b>Zamówienie ma pozycje usługowe.</b> HDI obejmuje tylko nasz towar, a towar usługobiorcy dostaje osobne <b>HDI usługa</b> z własnym numerem. Po załadunku oba powstają w Papierach kursu.</div></div>}
      {m.missingKg > 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Brakuje jeszcze <b>{kg(m.missingKg)}</b> wyrobu. HDI obejmie tylko to, co już jest (stan faktyczny).</div></div>}
    </Dialog>
  )
}
