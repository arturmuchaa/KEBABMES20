import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { useApi } from '@/hooks/useApi'
import { drukuj } from '@/lib/print'
import { settingsApi } from '@/lib/api'
import { prognozaKoncowki, sztukZPalety, type Paleta, type Skladnik } from './model'

const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)
const dataPl = (iso?: string) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

export interface PozycjaKarty {
  id: string; position?: number; qty: number; kgPerUnit: number; recipeName?: string; productTypeName?: string
  packagingName?: string; clientName?: string; pallets: Paleta[]; sklad: Skladnik[]
}
export interface PlanKarty { id: string; planNo: string; planDate: string; lines: PozycjaKarty[] }

/**
 * Karta produkcji dla kierownika (A4): pozycje w kolejności, przy każdej palety
 * w kolejności pobierania z chłodni i ile sztuk z każdej. Przy palecie miejsce
 * na wagę końcówki z wagi paletowej — tę wagę kierownik wpisuje potem na
 * tablecie przy zwrocie.
 */
export function KartkaProdukcji({ plan, firma }: { plan: PlanKarty; firma?: string }) {
  const pozycje = [...plan.lines].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return (
    <article className="doc-zam doc-komp pp-karta" aria-label="Karta produkcji">
      <header className="dz-head">
        <div className="dz-firm"><div><strong>{firma}</strong><span>Karta produkcji dla kierownika</span></div></div>
        <div className="dz-title">
          <span className="dz-kind" style={{ fontSize: '15pt' }}>Plan produkcji</span>
          <span className="dz-no">{plan.planNo}</span>
          <dl><dt>Dzień</dt><dd>{dataPl(plan.planDate)}</dd><dt>Pozycji</dt><dd>{pozycje.length}</dd></dl>
        </div>
      </header>
      {pozycje.map((l, i) => {
        const kgSzt = (mat?: string) => { const s = l.sklad.find(x => x.materialTypeId === mat); return s ? l.kgPerUnit * s.pct / 100 : l.kgPerUnit }
        return (
          <section key={l.id} className="pp-karta-poz">
            <h3>{i + 1}. {l.qty} × {fmt(l.kgPerUnit)} kg {l.recipeName}
              <small>{[l.productTypeName, l.packagingName, l.clientName].filter(Boolean).join(' · ')}</small></h3>
            <ol className="pp-karta-pal">{l.pallets.map(p => (
              <li key={p.id}>
                <span>{`Paleta ${p.palletNo} · ${p.batchNo}${l.sklad.length && p.materialName ? ` · ${p.materialName}` : ''} · ${fmt(p.kgWeighed)} kg · ${sztukZPalety(p.kgWeighed, l.sklad.length ? kgSzt(p.materialTypeId) : l.kgPerUnit)} szt.`}</span>
                <span className="pp-karta-waga">końcówka z wagi: ________ kg</span>
              </li>
            ))}</ol>
            <p className="dk-mut">{l.sklad.length
              ? `przewidywana końcówka: ${l.sklad.map(s => `${s.nazwa} ~${fmt(prognozaKoncowki(l.pallets.filter(p => p.materialTypeId === s.materialTypeId), l.qty, kgSzt(s.materialTypeId)))} kg`).join(' · ')}`
              : `przewidywana końcówka ~${fmt(prognozaKoncowki(l.pallets, l.qty, l.kgPerUnit))} kg`}</p>
          </section>
        )
      })}
      <footer className="dz-foot"><div className="dz-sign"><span> </span><small>kierownik produkcji</small></div>
        <p>Karta produkcji · {plan.planNo} · wydruk {new Date().toLocaleString('pl-PL')}</p></footer>
    </article>
  )
}

export function KartaProdukcjiDialog({ plan, onClose }: { plan: PlanKarty; onClose: () => void }) {
  const firmaRes = useApi(() => settingsApi.getCompany() as Promise<{ name?: string }>)
  const [druk, setDruk] = useState(false)
  useEffect(() => {
    if (!druk) return
    const prev = document.title
    document.title = `Karta produkcji ${plan.planNo.replace(/\//g, '-')}`
    const done = () => { setDruk(false); document.title = prev }
    const t = window.setTimeout(() => { void drukuj({ rodzaj: 'karta-produkcji', tytul: document.title }).finally(done) }, 60)
    return () => { window.clearTimeout(t); document.title = prev }
  }, [druk, plan.planNo])
  const doc = <KartkaProdukcji plan={plan} firma={firmaRes.data?.name} />
  return (
    <>
      <Dialog wide title={`Karta produkcji — ${plan.planNo}`} icon={<Printer size={20} />} onClose={onClose}
        footer={<><span className="left muted">Drukuje zapisany plan — palety w kolejności pobierania</span><button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn primary" data-autofocus onClick={() => setDruk(true)}><Printer size={15} />Drukuj</button></>}>
        <div className="doc-preview"><div className="doc-paper">{doc}</div></div>
      </Dialog>
      {druk && createPortal(<div className="print-sheet doc-print">{doc}</div>, document.body)}
    </>
  )
}
