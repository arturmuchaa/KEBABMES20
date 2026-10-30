import React from 'react'
import { Eye, Printer, ClipboardList, Truck, FileText, Split } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { type Order } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { downloadDocPdf, wzApi } from '@/lib/api'

/**
 * Dokumenty zamówienia — jedno miejsce na wszystkie wydruki i dokumenty wydania.
 * WZ/WM: lista z API (powiązane z zamówieniem) z podglądem PDF. HDI i CMR na liście
 * API nie mają numeru zamówienia (BRAKI_API) — generuje się je stąd, PDF otwiera się od razu.
 */
export function DocumentsTab({ order }: { order: Order }) {
  const app = useApp()
  const draft = order.status === 'draft'
  const closed = order.status === 'done' || order.status === 'cancelled'
  const pdf = async (id: string, nr?: string) => {
    try { await downloadDocPdf(wzApi.pdfUrl(id), `${(nr ?? 'WZ').replace(/\//g, '-')}.pdf`) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
  }
  const akcja = (label: string, icon: React.ReactNode, run: () => void, opis: string, disabled?: boolean, tip?: string) => (
    <button className="doc-tile" onClick={run} disabled={disabled} data-tip={disabled ? tip : undefined}>
      <span className="dt-ico">{icon}</span><span className="dt-t">{label}</span><span className="dt-d">{opis}</span>
    </button>
  )
  return (
    <div className="dock-pad">
      <div className="sect-h"><h3>Wydruki i dokumenty</h3><span className="sub">PDF zapiszesz z okna druku albo otworzy się w czytniku</span></div>
      <div className="doc-tiles">
        {akcja('Zamówienie dla klienta', <Printer size={18} />, () => app.printOrder(order.id), 'A4 z logo — do wysłania klientowi')}
        {akcja('Lista kompletacji', <ClipboardList size={18} />, () => app.printPicking([order.id]), 'wewnętrzna, z kratkami i paletami')}
        {akcja('Wystaw WZ', <Truck size={18} />, () => app.issueWz(order.id), 'zdejmuje towar ze stanu', draft || closed, draft ? 'Najpierw potwierdź zamówienie' : 'Zamówienie zamknięte')}
        {akcja(closed ? 'Podgląd HDI' : 'Generuj HDI', <FileText size={18} />, () => app.genHdi(order.id), closed ? 'zamrożone po realizacji' : 'na stan faktyczny', draft, 'Najpierw potwierdź zamówienie')}
        {akcja('Wystaw CMR', <FileText size={18} />, () => app.openCmr(order.id), 'przewoźnik, faktura, instrukcje', draft, 'Najpierw potwierdź zamówienie')}
        {akcja('Podział wysyłki', <Split size={18} />, () => app.toast({ kind: 'info', title: 'Podział wysyłki na fakturę i WZ', detail: 'Następny krok próby — teraz w starym MES na tej samej kopii.' }), 'faktura + WM — wkrótce')}
      </div>

      <div className="sect-h"><h3>Wystawione WZ / WM</h3><span className="sub">dokumenty wydania powiązane z zamówieniem</span></div>
      <div className="box">
        <table className="tbl">
          <thead><tr><th>Numer</th><th className="hide-s">Data</th><th>Stan</th><th className="r">Podgląd</th></tr></thead>
          <tbody>
            {order.docs.length === 0 && <tr><td colSpan={4}><div className="empty">Brak WZ/WM wystawionych z tego zamówienia.</div></td></tr>}
            {order.docs.map((d, i) => (
              <tr key={`${d.number ?? i}`} className={`row${i % 2 ? ' zebra' : ''}`}>
                <td className="num strong">{d.number}</td>
                <td className="num hide-s">{d.date ?? '—'}</td>
                <td className="muted">{d.note}</td>
                <td className="r">{d.id && <button className="btn sm ghost" onClick={() => void pdf(d.id!, d.number)}><Eye size={14} />PDF</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note"><FlagIcon level="info" size={15} /><div>Anulowanie WZ, edycja HDI i rejestr wszystkich dokumentów — w module „Dokumenty WZ, CMR, HDI” starego MES (w próbie bez zmian).</div></div>
    </div>
  )
}
