import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { hdiApi, type HdiDoc } from '@/lib/api'

const L: Record<string, Record<string, string>> = {
  pl: { title: 'HANDLOWY DOKUMENT IDENTYFIKACYJNY', number: 'Numer HDI', issue: 'Data wystawienia', producer: 'Producent', vet: 'Weterynaryjny numer identyfikacyjny', dom: 'Krajowy', eu: 'Unii Europejskiej', superv: 'Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.', cName: 'NAZWA TOWARU', cQty: 'SZT.', cNet: 'MASA NETTO', cBatch: 'NR PARTII', cExp: 'TERMIN PRZYDATNOŚCI', total: 'RAZEM', recip: 'Odbiorca', unload: 'Miejsce rozładunku', load: 'Miejsce załadunku', seller: 'Sprzedawca', ship: 'Data wysyłki', sign: 'Podpis Wystawiającego' },
  de: { title: 'HANDELSIDENTIFIKATIONSDOKUMENT', number: 'HDI-Nummer', issue: 'Datum der Ausgabe', producer: 'Hersteller', vet: 'Veterinärkontrollnummer', dom: 'National', eu: 'Europäische Union', superv: 'Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.', cName: 'WARENBEZEICHNUNG', cQty: 'STÜCKZAHL', cNet: 'NETTOGEWICHT', cBatch: 'CHARGENNUMMER', cExp: 'MHD', total: 'GESAMT', recip: 'Empfänger', unload: 'Abladeort', load: 'Ladeort', seller: 'Verkäufer', ship: 'Datum des Versands', sign: 'Unterschrift des Ausstellers' },
  en: { title: 'COMMERCIAL IDENTIFICATION DOCUMENT', number: 'HDI No.', issue: 'Date of issue', producer: 'Producer', vet: 'Veterinary identification number', dom: 'Domestic market', eu: 'European Union', superv: 'The establishment is under permanent veterinary supervision and has a HACCP system.', cName: 'PRODUCT NAME', cQty: 'QTY', cNet: 'NET WEIGHT', cBatch: 'BATCH NO.', cExp: 'BEST BEFORE', total: 'TOTAL', recip: 'Recipient', unload: 'Unloading place', load: 'Loading place', seller: 'Seller', ship: 'Date of shipment', sign: 'Signature of the issuer' },
  sk: { title: 'OBCHODNÝ IDENTIFIKAČNÝ DOKLAD', number: 'Číslo HDI', issue: 'Dátum vystavenia', producer: 'Výrobca', vet: 'Veterinárne identifikačné číslo', dom: 'Domáci trh', eu: 'Európska únia', superv: 'Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.', cName: 'NÁZOV TOVARU', cQty: 'KS', cNet: 'ČISTÁ HMOTNOSŤ', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DÁTUM SPOTREBY', total: 'SPOLU', recip: 'Príjemca', unload: 'Miesto vykládky', load: 'Miesto nakládky', seller: 'Predávajúci', ship: 'Dátum odoslania', sign: 'Podpis vystaviteľa' },
  cs: { title: 'OBCHODNÍ IDENTIFIKAČNÍ DOKLAD', number: 'Číslo HDI', issue: 'Datum vystavení', producer: 'Výrobce', vet: 'Veterinární identifikační číslo', dom: 'Domácí trh', eu: 'Evropská unie', superv: 'Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.', cName: 'NÁZEV ZBOŽÍ', cQty: 'KS', cNet: 'ČISTÁ HMOTNOST', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DATUM SPOTŘEBY', total: 'CELKEM', recip: 'Příjemce', unload: 'Místo vykládky', load: 'Místo nakládky', seller: 'Prodávající', ship: 'Datum odeslání', sign: 'Podpis vystavitele' },
}

export function HdiPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<HdiDoc | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { hdiApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd')) }, [id])
  useEffect(() => { if (doc) { const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t) } }, [doc])
  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc) return <div className="p-8 text-slate-500">Ładowanie HDI…</div>
  const pl = L.pl; const cl = L[doc.language] || L.en
  const h = doc.header
  const bi = (k: string) => `${pl[k]} / ${cl[k]}`
  return (
    <div className="bg-white text-black text-[11px]">
      <style>{`@media print{.no-print{display:none}@page{size:A4 portrait;margin:10mm}} .hdi{max-width:190mm;margin:0 auto;padding:8px} .hdi td,.hdi th{border:1px solid #000;padding:2px 4px}`}</style>
      <div className="no-print p-2">
        <Link to="/office/zamowienia" className="text-sm text-blue-700"><ArrowLeft size={14} className="inline" /> Zamówienia</Link>
        <button onClick={() => window.print()} className="ml-3 rounded bg-blue-600 px-3 py-1 text-white">Drukuj</button>
      </div>
      <div className="hdi">
        {doc.status === 'wstepny' && (
          <div className="mb-1 border border-amber-400 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
            WSTĘPNY — towar niezeskanowany, możliwe błędy{doc.incomplete ? ' · niekompletne wzg. zamówienia' : ''}
          </div>
        )}
        <div className="text-center font-bold">{bi('title')}</div>
        <div className="flex justify-between"><div><b>{bi('number')}:</b> {doc.number}</div><div><b>{bi('issue')}:</b> {doc.issueDate}</div></div>
        <div className="mt-1"><b>{bi('producer')}:</b> {h.producer_name}, {h.producer_addr}</div>
        <div>{bi('vet')}: <b>{h.vet_number}</b> &nbsp; {h.market_domestic && `☒ ${bi('dom')}`} &nbsp; {h.market_eu && `☒ ${bi('eu')}`}</div>
        <div className="text-[10px]">{pl.superv} / {cl.superv}</div>
        <table className="mt-2 w-full border-collapse text-[10px]">
          <thead><tr>
            <th>L.P</th><th>{bi('cName')}</th><th>{bi('cQty')}</th><th>{bi('cNet')}</th><th>{bi('cBatch')}</th><th>{bi('cExp')}</th>
          </tr></thead>
          <tbody>
            {doc.items.map((it, i) => (
              <tr key={i}>
                <td className="text-center">{i + 1}.</td>
                <td>{it.name}</td>
                <td className="text-center">{it.qty}szt.</td>
                <td className="text-center">{it.kg.toFixed(0)}kg</td>
                <td>{it.batches.map(b => `${b.qty}szt ${b.partia}`).join(' / ')}</td>
                <td>{it.batches.map(b => b.termin).join(' / ')}</td>
              </tr>
            ))}
            <tr>
              <td className="text-right" colSpan={2}><b>{bi('total')}:</b></td>
              <td className="text-center"><b>{doc.totals.qty}szt.</b></td>
              <td className="text-center"><b>{doc.totals.kg.toFixed(0)}kg</b></td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
        <table className="mt-2 w-full border-collapse text-[10px]">
          <tbody>
            <tr><td className="font-bold">{bi('recip')}</td><td>{h.recipient}</td></tr>
            <tr><td className="font-bold">{bi('unload')}</td><td>{h.unload}</td></tr>
            <tr><td className="font-bold">{bi('load')}</td><td>{h.load}</td></tr>
            <tr><td className="font-bold">{bi('seller')}</td><td>{h.seller}</td></tr>
          </tbody>
        </table>
        <div className="mt-6 flex justify-between text-[10px]"><div>{bi('ship')}: {doc.issueDate}</div><div>({bi('sign')})</div></div>
      </div>
    </div>
  )
}
