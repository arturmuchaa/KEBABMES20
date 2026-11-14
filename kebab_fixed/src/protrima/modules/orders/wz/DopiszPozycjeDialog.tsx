import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ListPlus, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { FlagIcon } from '../../../ui/Glyphs'
import { SzkieletBloku } from '../../../ui/Szkielet'
import { wzApi, type LiniaWz, type OpisPozycjiWz } from '@/lib/api'
import { stawkaVatDlaNabywcy } from '@/features/wz/wzVat'
import { PozycjaDodatkowaForm } from './PozycjaDodatkowa'
import { usePodpowiedziNazw } from './WzZamowienia'
import { type WierszDodatkowy } from './model'

const liczba = (s: string) => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : 0 }
const zl = (n: number, cur: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${cur === 'EUR' ? '€' : 'zł'}`
const ilosc = (l: LiniaWz) => `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(Number(l.qty) || 0)} ${l.unit}`
const SUROWIEC = ['raw', 'meat', 'byproduct']
const dodatkowa = (l: LiniaWz) => !!l.line_id && (l.stock_type === 'reczna' || SUROWIEC.includes(l.stock_type ?? ''))

/**
 * „Dopisz pozycję…” do wystawionej WZ/WM — także tej z kursu (np. jogurt dla VATAN po załadunku).
 * Serwer rozkłada pozycję wg zasady: WM = wszystko, co wyszło z magazynu; WZ = do zapłaty.
 * Dopisane pozycje można usunąć (surowiec wraca na stan partii).
 */
export function DopiszPozycjeDialog({ wzId, onClose, onZmiana }: { wzId: string; onClose: () => void; onZmiana: () => void }) {
  const app = useApp()
  const [opis, setOpis] = useState<OpisPozycjiWz | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [zapisuje, setZapisuje] = useState(false)
  const [doZaplaty, setDoZaplaty] = useState(true)
  const [usun, setUsun] = useState<LiniaWz | null>(null)
  const [zmian, setZmian] = useState(0)
  const lock = useRef(false)
  const podpowiedzi = usePodpowiedziNazw(true)

  const wczytaj = useCallback(() => {
    wzApi.opisPozycji(wzId).then(o => { setOpis(o); setBlad(null) }).catch(e => setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać dokumentu'))
  }, [wzId])
  useEffect(() => { wczytaj() }, [wczytaj])

  const dopisz = async (w: WierszDodatkowy) => {
    if (lock.current) return
    lock.current = true; setZapisuje(true); setBlad(null)
    try {
      await wzApi.dopiszPozycje(wzId, {
        lineId: w.lineId, rodzaj: w.rodzaj, name: w.name, qty: liczba(w.qtyStr), unit: w.unit,
        price: liczba(w.priceStr), vatRate: w.vatRate,
        ...(w.rodzaj === 'surowiec' ? { stockType: w.stockType, stockId: w.stockId, doZaplaty } : {}),
      })
      app.toast({ kind: 'ok', title: `Dopisano: ${w.name}`, detail: w.rodzaj === 'surowiec' ? `${w.qtyStr} kg zeszło ze stanu partii ${w.batchNo ?? ''}` : 'bez zmiany stanów magazynu' })
      onZmiana(); wczytaj(); setZmian(n => n + 1)
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się dopisać pozycji') }
    finally { lock.current = false; setZapisuje(false) }
  }
  const potwierdzUsun = async () => {
    if (!usun?.line_id || lock.current) return
    lock.current = true; setZapisuje(true)
    try {
      await wzApi.usunPozycje(wzId, usun.line_id)
      app.toast({ kind: 'ok', title: `Usunięto: ${usun.name}` })
      setUsun(null); onZmiana(); wczytaj(); setZmian(n => n + 1)
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się usunąć pozycji'); setUsun(null) }
    finally { lock.current = false; setZapisuje(false) }
  }

  const numery = opis?.dokumenty.map(d => d.number).join(' + ')
  const cur = opis?.currency ?? 'PLN'
  // Każda pozycja dodatkowa raz (kopie na WM i WZ klienta mają ten sam line_id).
  const dopisane = opis ? [...new Map(opis.dokumenty.flatMap(d => d.lines.filter(dodatkowa).map(l => [l.line_id!, { l, nr: d.number }] as const))).values()] : []

  return (
    <Dialog title={`Dopisz pozycję${numery ? ` — ${numery}` : ''}`} icon={<ListPlus size={20} />} onClose={onClose} wide
      footer={<button className="btn" onClick={onClose}>Zamknij</button>}>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
      {!opis && !blad && <SzkieletBloku linie={4} opis="Wczytywanie dokumentu…" />}
      {opis && <>
        <div className="pd-naglowek">
          <span>Waluta dokumentu: <b>{cur === 'EUR' ? 'EUR (€)' : 'PLN (zł)'}</b>{cur === 'EUR' && opis.eur_rate ? ` · kurs NBP ${String(opis.eur_rate).replace('.', ',')}` : ''}</span>
          {opis.para === 'wm_wzk' && <span className="sub">Surowiec zejdzie ze stanu na WM; do zapłaty trafia na WZ klienta. Pozycja z ręki — tylko na WZ klienta.</span>}
          {opis.para === 'sam_wm' && <span className="sub">Kurs w całości na fakturę — surowiec dopiszesz do WM (zejdzie ze stanu).</span>}
        </div>
        {dopisane.length > 0 && <div className="box"><table className="tbl" aria-label="Dopisane pozycje">
          <thead><tr><th>Dopisana pozycja</th><th>Rodzaj</th><th className="num">Ilość</th><th className="num">Wartość</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>{dopisane.map(({ l }) => (
            <tr key={l.line_id} className="row">
              <td className="strong">{l.name}</td>
              <td>{l.stock_type === 'reczna' ? <span className="tag neutral">z ręki</span> : <span className="tag info">surowiec · {l.batch_no ?? '—'}</span>}</td>
              <td className="num">{ilosc(l)}</td>
              <td className="num">{l.value != null ? zl(Number(l.value), cur) : '—'}</td>
              <td><button className="btn ghost icon sm" style={{ width: 28 }} disabled={zapisuje} onClick={() => setUsun(l)} aria-label={`Usuń dopisaną pozycję: ${l.name}`}><Trash2 size={15} /></button></td>
            </tr>))}
          </tbody></table></div>}
        {opis.para === 'wm_wzk' && <label className="pd-zaplata"><input type="checkbox" className="cbx" checked={doZaplaty} onChange={e => setDoZaplaty(e.target.checked)} />
          Surowiec także do zapłaty na WZ klienta</label>}
        <PozycjaDodatkowaForm waluta={cur} kurs={null} vatDomyslny={stawkaVatDlaNabywcy('')} wartosciowy={opis.valued}
          bezRecznej={opis.bez_recznej ?? undefined} podpowiedzi={podpowiedzi} zapisuje={zapisuje} odswiez={zmian} className="pd-dopisz" onDodaj={w => void dopisz(w)} />
      </>}
      {usun && <Dialog title="Usunąć dopisaną pozycję?" icon={<Trash2 size={20} />} onClose={() => setUsun(null)}
        footer={<><button className="btn" onClick={() => setUsun(null)} data-autofocus>Wróć</button><button className="btn danger" disabled={zapisuje} onClick={() => void potwierdzUsun()}>Usuń</button></>}>
        <p style={{ margin: 0 }}><b>{usun.name}</b> — {ilosc(usun)}.</p>
        {usun.stock_type !== 'reczna' && <div className="note info"><FlagIcon level="info" size={15} /><div>{ilosc(usun)} wróci na stan partii {usun.batch_no ?? ''}.</div></div>}
      </Dialog>}
    </Dialog>
  )
}
