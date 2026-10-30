import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, FileDown } from 'lucide-react'
import { Dialog } from '../../../shell/context'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/features/auth/AuthContext'
import { clientOrdersApi, clientsApi, settingsApi } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'

const nf = (n: number, d = 0) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 3 : d }).format(n)
const dataPl = (iso?: string) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

interface Firma { name?: string; address?: string; postalCode?: string; city?: string; nip?: string; phone?: string; email?: string; vetNumber?: string }
interface Klient { id: string; name: string; displayName?: string; address?: string; postalCode?: string; city?: string; nip?: string; destName?: string; destAddress?: string; destCity?: string }

/** Pozycje dokumentu — DOKŁADNIE zapisane warianty i wagi (jak stary wydruk), masa liczona w gramach bez ogonów. */
export function pozycjeDokumentu(o: ClientOrder) {
  const rows = o.lines.map((l, i) => ({
    lp: i + 1, recipe: l.recipeName || l.productTypeName || 'Produkt', product: l.recipeName ? l.productTypeName : '',
    packaging: l.packagingName || '', kgPerUnit: l.kgPerUnit, qty: l.qty, kg: Math.round(l.qty * l.kgPerUnit * 1000) / 1000, notes: l.notes || '',
  }))
  return { rows, qty: rows.reduce((a, r) => a + r.qty, 0), kg: rows.reduce((a, r) => a + Math.round(r.kg * 1000), 0) / 1000 }
}

/**
 * Zamówienie dla klienta — podgląd i wydruk A4. „Drukuj / zapisz PDF” otwiera
 * systemowe okno druku: drukarka albo „Microsoft Print to PDF” / „Zapisz jako PDF”;
 * nazwa pliku podpowiada się z numeru zamówienia.
 */
export function ZamowienieDrukDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { user } = useAuth()
  const orderRes = useApi(() => clientOrdersApi.byId(orderId), [orderId])
  const firmaRes = useApi(() => settingsApi.getCompany() as Promise<Firma>)
  const klienciRes = useApi(() => clientsApi.list() as Promise<Klient[]>)
  const o = orderRes.data as ClientOrder | null
  const klient = (klienciRes.data ?? []).find(c => c.id === o?.clientId)
  const [uwagiPoz, setUwagiPoz] = useState(true)
  const [druk, setDruk] = useState(false)
  const err = orderRes.error || firmaRes.error || klienciRes.error
  const gotowe = !!o && !!firmaRes.data && !!klienciRes.data

  useEffect(() => {
    if (!druk || !o) return
    const prev = document.title
    document.title = `Zamowienie ${o.orderNo.replace(/\//g, '-')}`  // podpowiedź nazwy pliku PDF
    const done = () => { setDruk(false); document.title = prev }
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 60)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.title = prev }
  }, [druk, o])

  const doc = gotowe ? <DokumentZamowienia o={o!} firma={firmaRes.data!} klient={klient} wystawil={user?.name} uwagiPoz={uwagiPoz} /> : null
  return (
    <>
      <Dialog wide title={o ? `Zamówienie ${o.orderNo} — wydruk dla klienta` : 'Wydruk zamówienia'} icon={<Printer size={20} color="var(--accent)" />} onClose={onClose}
        footer={<>
          <label className="left" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><input type="checkbox" className="cbx" checked={uwagiPoz} onChange={e => setUwagiPoz(e.target.checked)} />Uwagi przy pozycjach</label>
          <button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn" disabled={!gotowe} onClick={() => setDruk(true)} data-tip="W oknie druku wybierz „Microsoft Print to PDF” albo „Zapisz jako PDF”"><FileDown size={15} />Zapisz PDF</button>
          <button className="btn primary" disabled={!gotowe} onClick={() => setDruk(true)} data-autofocus><Printer size={15} />Drukuj</button>
        </>}>
        {err && <div className="note crit">Nie udało się pobrać danych: {err}</div>}
        {!gotowe && !err && <div className="note">Przygotowywanie dokumentu…</div>}
        {doc && <div className="doc-preview"><div className="doc-paper">{doc}</div></div>}
      </Dialog>
      {druk && doc && createPortal(<div className="print-sheet doc-print">{doc}</div>, document.body)}
    </>
  )
}

export function DokumentZamowienia({ o, firma, klient, wystawil, uwagiPoz }: { o: ClientOrder; firma: Firma; klient?: Klient; wystawil?: string; uwagiPoz: boolean }) {
  const p = useMemo(() => pozycjeDokumentu(o), [o])
  const logo = (firma.name ?? '').toLocaleLowerCase('pl').includes('księżyc')
  const dest = klient?.destName || klient?.destAddress
  return (
    <article className="doc-zam" aria-label="Zamówienie dla klienta">
      <header className="dz-head">
        <div className="dz-firm">
          {logo && <img src="/logo-ksiezyc-print.png" alt="" />}
          <div>
            <strong>{firma.name || 'Dane firmy nie zostały skonfigurowane'}</strong>
            {firma.address && <span>{firma.address}</span>}
            <span>{[firma.postalCode, firma.city].filter(Boolean).join(' ')}</span>
            <span>{[firma.nip && `NIP ${firma.nip}`, firma.vetNumber && `Wet. ${firma.vetNumber}`].filter(Boolean).join(' · ')}</span>
            <span>{[firma.phone, firma.email].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="dz-title">
          <span className="dz-kind">Zamówienie</span>
          <span className="dz-no">{o.orderNo}</span>
          <dl>
            <dt>Data zamówienia</dt><dd>{dataPl(o.orderDate)}</dd>
            <dt>Termin dostawy</dt><dd>{o.deliveryDate ? dataPl(o.deliveryDate) : 'do uzgodnienia'}</dd>
          </dl>
        </div>
      </header>

      <section className="dz-parties">
        <div><h3>Odbiorca</h3>
          <strong>{klient?.name || o.clientName}</strong>
          {klient?.address && <span>{klient.address}</span>}
          <span>{[klient?.postalCode, klient?.city].filter(Boolean).join(' ')}</span>
          {klient?.nip && <span>NIP / VAT: {klient.nip}</span>}
        </div>
        <div><h3>Miejsce dostawy</h3>
          {dest ? <><strong>{klient?.destName || klient?.name}</strong><span>{klient?.destAddress}</span><span>{klient?.destCity}</span></>
            : <><strong>{klient?.name || o.clientName}</strong><span>adres odbiorcy</span></>}
        </div>
      </section>

      <table className="dz-tbl">
        <thead><tr><th className="c-lp">Lp.</th><th>Produkt</th><th>Opakowanie</th><th className="r">Waga sztuki</th><th className="r">Ilość</th><th className="r">Masa</th></tr></thead>
        <tbody>{p.rows.map(r => (
          <tr key={r.lp}>
            <td className="c-lp">{r.lp}</td>
            <td><b>{r.recipe}</b>{r.product && <small>{r.product}</small>}{uwagiPoz && r.notes && <small className="dz-note">{r.notes}</small>}</td>
            <td>{r.packaging || '—'}</td>
            <td className="r">{nf(r.kgPerUnit)} kg</td>
            <td className="r"><b>{nf(r.qty)}</b> szt.</td>
            <td className="r">{nf(r.kg)} kg</td>
          </tr>
        ))}</tbody>
      </table>

      <section className="dz-sum">
        <div className="dz-notes">{o.notes ? <><h3>Uwagi</h3><p>{o.notes}</p></> : null}</div>
        <dl className="dz-totals">
          <dt>Pozycji</dt><dd>{p.rows.length}</dd>
          <dt>Łącznie sztuk</dt><dd>{nf(p.qty)}</dd>
          <dt className="big">Łączna masa</dt><dd className="big">{nf(p.kg)} kg</dd>
        </dl>
      </section>

      <footer className="dz-foot">
        <div className="dz-sign"><span>{wystawil || ' '}</span><small>wystawił(a)</small></div>
        <div className="dz-sign"><span> </span><small>potwierdzenie odbiorcy</small></div>
        <p>Dokument wygenerowany {new Date().toLocaleDateString('pl-PL')} · {firma.name ?? ''} · Zamówienie {o.orderNo}</p>
      </footer>
    </article>
  )
}
