import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { hdiApi, type HdiDoc } from '@/lib/api'

const L: Record<string, Record<string, string>> = {
  pl: { title: 'HANDLOWY DOKUMENT IDENTYFIKACYJNY', number: 'Numer HDI', issue: 'Data wystawienia', producer: 'Producent', qual: 'Zakład zakwalifikowany do prowadzenia sprzedaży na rynek', vet: 'Weterynaryjny numer identyfikacyjny', dom: 'Krajowy', eu: 'Unii Europejskiej', superv: 'Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.', lp: 'L.P', cName: 'NAZWA TOWARU', cQty: 'SZT.', cNet: 'MASA NETTO', cBatch: 'NR PARTII', cExp: 'TERMIN PRZYDATNOŚCI', total: 'RAZEM', recip: 'ODBIORCA', unload: 'MIEJSCE ROZŁADUNKU', regno: 'NUMER REJESTRACYJNY', fridge: 'Samochód zabudowany chłodnią -18°C', load: 'MIEJSCE ZAŁADUNKU', seller: 'SPRZEDAWCA', remarks: 'UWAGI / WARUNKI REKLAMACJI', complaint: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).', ship: 'Data wysyłki', sign: 'Podpis Wystawiającego' },
  de: { title: 'HANDELSIDENTIFIKATIONSDOKUMENT', number: 'HDI-Nummer', issue: 'Datum der Ausgabe', producer: 'Hersteller', qual: 'Für den Verkauf auf dem Markt qualifizierte(r) Betrieb(e)', vet: 'Veterinärkontrollnummer', dom: 'National', eu: 'Europäische Union', superv: 'Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.', lp: 'L.P', cName: 'WARENBEZEICHNUNG', cQty: 'STÜCKZAHL', cNet: 'NETTOGEWICHT', cBatch: 'CHARGENNUMMER', cExp: 'MHD', total: 'GESAMT', recip: 'EMPFÄNGER', unload: 'ABLADEORT', regno: 'REGISTRIERNUMMER', fridge: 'Auto mit Kühlschrank -18°C', load: 'LADEORT', seller: 'VERKÄUFER', remarks: 'ANMERKUNGEN / VORAUSSETZUNGEN FÜR BESCHWERDEN', complaint: 'Beanstandungen der Qualität und Menge der Ware (Reklamationen) müssen während des Be-/Entladens und/oder bis zur Unterzeichnung der Lieferpapiere (Rechnung, Lieferschein, CMR) erfolgen.', ship: 'Datum des Versands', sign: 'Unterschrift des Ausstellers' },
  en: { title: 'COMMERCIAL IDENTIFICATION DOCUMENT', number: 'HDI No.', issue: 'Date of issue', producer: 'Producer', qual: 'Establishment qualified to sell on the market', vet: 'Veterinary identification number', dom: 'Domestic market', eu: 'European Union', superv: 'The establishment is under permanent veterinary supervision and has a HACCP system.', lp: 'No.', cName: 'PRODUCT NAME', cQty: 'QTY', cNet: 'NET WEIGHT', cBatch: 'BATCH NO.', cExp: 'BEST BEFORE', total: 'TOTAL', recip: 'RECIPIENT', unload: 'UNLOADING PLACE', regno: 'REGISTRATION NUMBER', fridge: 'Refrigerated truck -18°C', load: 'LOADING PLACE', seller: 'SELLER', remarks: 'COMMENTS / CONDITIONS REGARDING COMPLAINTS', complaint: 'Any objections to the quality or quantity of the goods (complaints) must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.', ship: 'Date of shipment', sign: 'Signature of the issuer' },
  sk: { title: 'OBCHODNÝ IDENTIFIKAČNÝ DOKLAD', number: 'Číslo HDI', issue: 'Dátum vystavenia', producer: 'Výrobca', qual: 'Prevádzka kvalifikovaná na predaj na trhu', vet: 'Veterinárne identifikačné číslo', dom: 'Domáci trh', eu: 'Európska únia', superv: 'Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.', lp: 'Č.', cName: 'NÁZOV TOVARU', cQty: 'KS', cNet: 'ČISTÁ HMOTNOSŤ', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DÁTUM SPOTREBY', total: 'SPOLU', recip: 'PRÍJEMCA', unload: 'MIESTO VYKLÁDKY', regno: 'EVIDENČNÉ ČÍSLO', fridge: 'Auto s chladiarňou -18°C', load: 'MIESTO NAKLÁDKY', seller: 'PREDÁVAJÚCI', remarks: 'POZNÁMKY / PODMIENKY REKLAMÁCIE', complaint: 'Any objections to the quality or quantity of the goods (complaints) must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.', ship: 'Dátum odoslania', sign: 'Podpis vystaviteľa' },
  cs: { title: 'OBCHODNÍ IDENTIFIKAČNÍ DOKLAD', number: 'Číslo HDI', issue: 'Datum vystavení', producer: 'Výrobce', qual: 'Provozovna kvalifikovaná k prodeji na trhu', vet: 'Veterinární identifikační číslo', dom: 'Domácí trh', eu: 'Evropská unie', superv: 'Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.', lp: 'Č.', cName: 'NÁZEV ZBOŽÍ', cQty: 'KS', cNet: 'ČISTÁ HMOTNOST', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DATUM SPOTŘEBY', total: 'CELKEM', recip: 'PŘÍJEMCE', unload: 'MÍSTO VYKLÁDKY', regno: 'EVIDENČNÍ ČÍSLO', fridge: 'Auto s chladírnou -18°C', load: 'MÍSTO NAKLÁDKY', seller: 'PRODÁVAJÍCÍ', remarks: 'POZNÁMKY / PODMÍNKY REKLAMACE', complaint: 'Any objections to the quality or quantity of the goods (complaints) must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.', ship: 'Datum odeslání', sign: 'Podpis vystavitele' },
}

const MIN_ROWS = 12

export function HdiPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<HdiDoc | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { hdiApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd')) }, [id])
  useEffect(() => { if (doc) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t) } }, [doc])
  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc) return <div className="p-8 text-slate-500">Ładowanie HDI…</div>

  const pl = L.pl
  const cl = L[doc.language] || L.en
  const h = doc.header
  // Klient PL → dokument jednojęzyczny; inny język → dwujęzyczny PL + język klienta.
  const mono = doc.language === 'pl'
  const two = (k: string) => mono
    ? (<div>{pl[k]}</div>)
    : (<><div>{pl[k]}</div><div className="italic text-slate-600">{cl[k]}</div></>)
  const bi = (k: string) => mono ? pl[k] : `${pl[k]} / ${cl[k]}`

  const items = doc.items || []
  const padCount = Math.max(0, MIN_ROWS - items.length)

  return (
    <div className="bg-white text-black">
      <style>{`
        @media print { .no-print { display:none } @page { size:A4 portrait; margin:8mm } }
        .hdi { max-width:194mm; margin:0 auto; padding:6px; font-size:10px; line-height:1.25 }
        .hdi table { border-collapse:collapse; width:100% }
        .hdi .prod td, .hdi .prod th { border:1px solid #000; padding:2px 4px; vertical-align:middle }
        .hdi .info td { border:1px solid #000; padding:3px 5px; vertical-align:top }
        .hdi .prod th { background:#f1f5f9; font-size:8.5px; text-align:center; line-height:1.1 }
        .batchline { min-height:13px }
      `}</style>

      <div className="no-print flex items-center gap-3 p-2">
        <Link to="/office/zamowienia" className="text-sm text-blue-700"><ArrowLeft size={14} className="inline" /> Zamówienia</Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white"><Printer size={14}/> Drukuj</button>
      </div>

      <div className="hdi">
        {doc.status === 'wstepny' && (
          <div className="mb-1 border border-amber-500 bg-amber-50 px-2 py-1 text-[9px] font-semibold text-amber-800">
            DOKUMENT WSTĘPNY — towar niezeskanowany na załadunku, możliwe rozbieżności{doc.incomplete ? ' · wystawiony na stan faktyczny (niekompletny względem zamówienia)' : ''}
          </div>
        )}

        {/* Tytuł */}
        <div className="text-center text-[13px] font-bold leading-tight">{mono ? pl.title : <>{pl.title}<span className="font-normal"> / </span>{cl.title}</>}</div>

        {/* Numer + data */}
        <table className="mt-1"><tbody>
          <tr>
            <td className="w-1/2 border border-black px-2 py-1"><b>{bi('number')}:</b> {doc.number}</td>
            <td className="w-1/2 border border-black px-2 py-1"><b>{bi('issue')}:</b> {doc.issueDate}</td>
          </tr>
        </tbody></table>

        {/* Producent + rynek + weterynaria */}
        <table className="mt-1"><tbody>
          <tr>
            <td className="border border-black px-2 py-1 align-top" style={{ width: '58%' }}>
              <b>{bi('producer')}:</b>
              <div className="mt-0.5 font-semibold">{h.producer_name}</div>
              <div>{h.producer_addr}</div>
            </td>
            <td className="border border-black px-2 py-1 align-top">
              <div className="text-[8.5px] leading-tight">{pl.qual}{mono ? '' : <> / <span className="italic">{cl.qual}</span></>}:</div>
              <div className="mt-1">{h.market_domestic ? '☒' : '☐'} {bi('dom')}</div>
              <div>{h.market_eu ? '☒' : '☐'} {bi('eu')}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black px-2 py-1">
              <b>{bi('vet')}:</b> {h.vet_number}
            </td>
          </tr>
        </tbody></table>

        <div className="mt-1 text-[8.5px] leading-tight">{pl.superv}{mono ? null : <><br />{cl.superv}</>}</div>

        {/* Tabela produktów */}
        <table className="prod mt-1">
          <thead><tr>
            <th style={{ width: '5%' }}>{two('lp')}</th>
            <th style={{ width: '33%' }}>{two('cName')}</th>
            <th style={{ width: '9%' }}>{two('cQty')}</th>
            <th style={{ width: '13%' }}>{two('cNet')}</th>
            <th style={{ width: '23%' }}>{two('cBatch')}</th>
            <th style={{ width: '17%' }}>{two('cExp')}</th>
          </tr></thead>
          <tbody>
            {items.map((it, i) => {
              const multi = it.batches.length > 1
              return (
                <tr key={i}>
                  <td className="text-center">{i + 1}.</td>
                  <td className="font-semibold">{it.name}</td>
                  <td className="text-center">{it.qty}szt.</td>
                  <td className="text-center">{it.kg.toFixed(0)}kg</td>
                  <td>
                    {it.batches.map((b, j) => (
                      <div key={j} className="batchline">{multi ? <b>{b.qty}SZT </b> : null}{b.partia}</div>
                    ))}
                  </td>
                  <td className="text-center">
                    {it.batches.map((b, j) => (<div key={j} className="batchline">{b.termin}</div>))}
                  </td>
                </tr>
              )
            })}
            {Array.from({ length: padCount }).map((_, i) => (
              <tr key={`e${i}`}>
                <td className="text-center text-slate-400">{items.length + i + 1}.</td>
                <td>&nbsp;</td><td></td><td></td><td></td><td></td>
              </tr>
            ))}
            <tr>
              <td></td>
              <td className="text-right font-bold">{bi('total')}:</td>
              <td className="text-center font-bold">{doc.totals.qty}szt.</td>
              <td className="text-center font-bold">{doc.totals.kg.toFixed(0)}kg</td>
              <td></td><td></td>
            </tr>
          </tbody>
        </table>

        {/* Dane odbiorcy / załadunku */}
        <table className="info mt-1"><tbody>
          <tr>
            <td className="font-semibold" style={{ width: '24%' }}>{two('recip')}</td>
            <td>{h.recipient}</td>
          </tr>
          <tr>
            <td className="font-semibold">{two('unload')}</td>
            <td>{h.unload}</td>
          </tr>
          <tr>
            <td className="font-semibold">{two('regno')}</td>
            <td>{pl.fridge}{mono ? '' : <span className="italic text-slate-600"> / {cl.fridge}</span>}</td>
          </tr>
          <tr>
            <td className="font-semibold">{two('load')}</td>
            <td>{h.load}</td>
          </tr>
          <tr>
            <td className="font-semibold">{two('seller')}</td>
            <td>{h.seller}</td>
          </tr>
        </tbody></table>

        {/* Uwagi / reklamacje */}
        <div className="mt-1 border border-black px-2 py-1">
          <div className="text-[8.5px] font-bold">{mono ? pl.remarks : `${pl.remarks} / ${cl.remarks}`}:</div>
          <div className="mt-0.5 text-[8px] leading-tight">1). {pl.complaint}</div>
          {doc.language !== 'pl' && <div className="text-[8px] italic leading-tight text-slate-700">{cl.complaint}</div>}
        </div>

        {/* Stopka: data + podpis */}
        <div className="mt-6 flex items-end justify-between text-[9px]">
          <div>{bi('ship')}: {doc.issueDate}</div>
          <div className="text-center">
            <div className="mb-1 w-56 border-b border-black">&nbsp;</div>
            ({bi('sign')})
          </div>
        </div>
      </div>
    </div>
  )
}
