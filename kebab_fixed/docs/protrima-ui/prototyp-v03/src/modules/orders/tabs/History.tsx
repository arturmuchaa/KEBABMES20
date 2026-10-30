import React from 'react'
import { FilePlus2, Pencil, ScanLine, FileText, Factory } from 'lucide-react'
import type { Order, HistoryEntry } from '../../../data/model'

const ICON: Record<NonNullable<HistoryEntry['kind']>, React.ReactNode> = {
  create: <FilePlus2 size={15} />, edit: <Pencil size={15} />, scan: <ScanLine size={15} />, doc: <FileText size={15} />, prod: <Factory size={15} />,
}

export function HistoryTab({ order }: { order: Order }) {
  return (
    <div className="dock-pad">
      <div className="sect-h"><h3>Historia zamówienia</h3><span className="sub">zmiany biura, skany magazynu, zgłoszenia produkcji — od najnowszych</span></div>
      <div className="box">
        <ol className="timeline">
          {order.history.map((h, i) => (
            <li key={i}>
              <span className="tt">{h.at}</span>
              <span className="tic">{ICON[h.kind ?? 'edit']}</span>
              <span className="tx">{h.text}<div className="tw">{h.who}</div></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
