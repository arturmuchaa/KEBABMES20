import { useRef, useState } from 'react'
import { MapPin, QrCode, Search } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { SzkieletBloku } from '../../ui/Szkielet'
import { num } from '../../data/model'
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, type FinishedUnitCard } from '@/lib/api'
import { unitLocation } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'

/** Etapy, przez które przechodzi sztuka z kodem — kolejność i opisy jak w `unitLocation` (skaner, stary MES). */
const ETAPY = [
  { k: 'planned', t: 'W produkcji', d: 'zaplanowane, jeszcze bez skanu' },
  { k: 'produced', t: 'Mroźnia szokowa', d: 'zeskanowane po produkcji' },
  { k: 'packed', t: 'Mroźnia składowa', d: 'spakowane do kartonu' },
  { k: 'shipped', t: 'Wydane', d: 'zeskanowane przy załadunku' },
] as const

/**
 * Gdzie są sztuki tej partii — ile na każdym etapie i w których kartonach
 * (stary MES: „Lokalizacja partii”). Liczy serwer ze statusów sztuk z kodem QR.
 */
export function LokalizacjaPartii({ batchNo }: { batchNo: string }) {
  const res = useApi(() => (batchNo ? finishedUnitsApi.locationSummary(batchNo) : Promise.resolve(null)), [batchNo])
  if (res.error) return <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się pobrać lokalizacji: {res.error}</div></div>
  if (res.loading && !res.data) return <SzkieletBloku linie={2} opis="Pobieranie lokalizacji sztuk…" />
  const d = res.data
  const razem = d ? d.planned + d.produced + d.packed + d.shipped : 0
  if (!d || razem === 0) return <div className="note info"><FlagIcon level="info" size={15} /><div>Ta partia nie ma sztuk z kodem QR — wyrób sprzed etykiet albo dodany ręcznie. Stan ilościowy pokazuje zakładka Szczegóły.</div></div>
  return (
    <div className="box lok-box" aria-label={`Lokalizacja sztuk partii ${batchNo}`}>
      <div className="sect-h"><h3><MapPin size={15} />Gdzie są sztuki partii <span className="code">{batchNo}</span></h3><span className="sub">{num(razem)} szt. z kodem QR</span></div>
      <div className="lok-etapy">
        {ETAPY.map(e => {
          const n = d[e.k]
          return (
            <div key={e.k} className={`lok-etap${n ? ' on' : ''}`}>
              <span className="lok-n">{num(n)}<small>szt.</small></span>
              <span className="lok-t">{e.t}</span>
              <span className="lok-d">{e.d}</span>
            </div>
          )
        })}
      </div>
      {d.cartons.length > 0 && <div className="lok-kartony"><span className="label">Kartony</span>{d.cartons.map(c => <span key={c} className="nr-chip"><b>{c}</b></span>)}</div>}
    </div>
  )
}

/** Wyszukiwarka pojedynczej sztuki po kodzie QR — wklej albo zeskanuj czytnikiem (Enter). */
export function SzukajSztuki({ autoFocus }: { autoFocus?: boolean }) {
  const klientNa = useClientNames()
  const [kod, setKod] = useState('')
  const [szukam, setSzukam] = useState(false)
  const [karta, setKarta] = useState<FinishedUnitCard | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const szukaj = async () => {
    const k = kod.trim()
    if (!k || szukam) return
    setSzukam(true); setBlad(null); setKarta(null)
    try {
      setKarta(await finishedUnitsApi.lookup(k))
    } catch (e) {
      const m = e instanceof Error ? e.message : ''
      setBlad(/404|nie znalez/i.test(m) ? 'Nie znaleziono sztuki o tym kodzie.' : m || 'Nie udało się wyszukać sztuki.')
    } finally {
      setSzukam(false)
      inputRef.current?.select()
    }
  }
  return (
    <div className="szukaj-sztuki">
      <form className="row-wrap" onSubmit={e => { e.preventDefault(); void szukaj() }}>
        <div className="field-wrap" style={{ flex: '1 1 260px' }}>
          <QrCode size={15} />
          <input ref={inputRef} className="field" value={kod} onChange={e => setKod(e.target.value)} placeholder="Kod QR sztuki — wklej albo zeskanuj" aria-label="Kod QR sztuki" autoFocus={autoFocus} />
        </div>
        <button className="btn" type="submit" disabled={!kod.trim() || szukam}><Search size={15} />{szukam ? 'Szukam…' : 'Znajdź'}</button>
      </form>
      {blad && <div className="note warn" role="alert"><FlagIcon level="warn" size={15} /><div>{blad}</div></div>}
      {karta && <div className="box lok-karta" role="status">
        <div className="lok-gdzie"><MapPin size={16} /><b>{unitLocation({ status: karta.status, cartonNo: karta.cartonNo, clientName: karta.clientName ? klientNa(karta.clientName) : '' })}</b></div>
        <dl className="kv">
          <dt>Partia</dt><dd className="code strong">{karta.batchNo || '—'}</dd>
          <dt>Wyrób</dt><dd>{[karta.productTypeName, karta.recipeName].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Waga · tuleja</dt><dd>{String(karta.weightKg).replace('.', ',')} kg{karta.tuleja ? ` · ${karta.tuleja}` : ''}</dd>
          <dt>Klient</dt><dd>{karta.clientName ? klientNa(karta.clientName) : 'na magazyn'}</dd>
          <dt>Karton</dt><dd className="code">{karta.cartonNo || '—'}</dd>
          <dt>Wyprodukowana</dt><dd>{karta.producedAt ? new Date(karta.producedAt).toLocaleString('pl-PL') : '—'}</dd>
          <dt>Kod</dt><dd className="code muted">{karta.qrCode}</dd>
        </dl>
      </div>}
    </div>
  )
}

export function SzukajSztukiDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Gdzie jest sztuka?" icon={<QrCode size={20} />} onClose={onClose} footer={<button className="btn" onClick={onClose}>Zamknij</button>}>
      <SzukajSztuki autoFocus />
    </Dialog>
  )
}
