import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Printer, Download } from 'lucide-react'
import { hdiApi, type HdiDoc } from '@/lib/api'

const L: Record<string, Record<string, string>> = {
  pl: { title: 'HANDLOWY DOKUMENT IDENTYFIKACYJNY', number: 'Numer HDI', issue: 'Data wystawienia', producer: 'Producent', qual: 'Zakład zakwalifikowany do prowadzenia sprzedaży na rynek', vet: 'Weterynaryjny numer identyfikacyjny', dom: 'Krajowy /domestic market/ National', eu: 'Unii Europejskiej /UE / Europäische Union', superv: 'Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.', lp: 'L.P', cName: 'NAZWA TOWARU', cQty: 'L.B SZT.', cNet: 'MASA NETTO', cBatch: 'NR PARTII', cExp: 'TERMIN PRZYDATNOŚCI', total: 'RAZEM', recip: 'ODBIORCA', unload: 'MIEJSCE ROZŁADUNKU', regno: 'NUMER REJESTRACYJNY / TYP SAMOCHODU', fridge: 'Samochód z zabudową mroźniczą -18°C', load: 'MIEJSCE ZAŁADUNKU', seller: 'SPRZEDAWCA', remarks: 'UWAGI / WARUNKI REKLAMACJI / COMMENTS/CONDITIONS REGARDING COMPLAINTS/ ANMERKUNGEN/VORAUSSETZUNGEN FÜR BESCHWERDEN/', ship: 'Data wysyłki', sign: 'Podpis Wystawiającego',
    c1pl: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).',
    c1: 'Any objections to the quality or quantity of the goods (complaints) must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.',
    c2pl: 'Braki wagowe należy udokumentować w obecności osoby dostarczającej towar (kierowcy), na przyjętym w firmie formularzu, podpisanym przez obie strony. Następnie oryginał lub ksero załączyć do dokumentów zwrotnych.',
    c2: 'If the weight of the goods is lower than agreed, it must be documented in the presence of the person collecting/delivering the goods (driver) on a form approved by the company and signed by both parties. The original or a photocopy of the form needs to be attached to the return documents.',
    c3pl: 'Reklamacje nie będą rozpatrywane po akceptacji dostawy (podpisanie dokumentów towarzyszących dostawie: faktura, WZ, CMR), bez wcześniejszego zgłoszenia zastrzeżeń co do dostawy*.',
    c3: 'Complaints will not be considered after the acceptance of the pick up/delivery (signature of documents accompanying the delivery: invoice, delivery note, CMR) without prior notification of objections regarding the pick up/delivery*.',
    c4pl: '*nie dotyczy sytuacji otrzymania nieprawidłowych wyników badań wykonywanych przez instytucje Państwowe sprawujące kontrolę nad zakładami',
    c4: '*Does not apply in the case of abnormal results of tests performed by State institutions controlling the establishments.',
    c5pl: 'Podpisując dokumenty towarzyszących dostawie (faktura, WZ, CMR) zgadzasz się z powyższymi i akceptujesz warunki reklamacji przyjętymi w firmie i udostępnianych na życzenie klienta.',
    c5: 'By signing the documents accompanying the delivery (invoice, delivery note, CMR), you agree with the above and accept the terms and conditions regarding complaints adopted by the company and made available on the client\'s request.',
  },
  de: { title: 'HANDELSIDENTIFIKATIONSDOKUMENT', number: 'HDI-Nummer', issue: 'Datum der Ausgabe', producer: 'Hersteller', qual: 'Für den Verkauf auf dem Markt qualifizierte(r) Betrieb(e)', vet: 'Veterinärkontrollnummer', dom: 'National', eu: 'Europäische Union', superv: 'Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.', lp: 'L.P', cName: 'WARENBEZEICHNUNG', cQty: 'STÜCKZAHL', cNet: 'NETTOGEWICHT', cBatch: 'CHARGENNUMMER', cExp: 'MHD', total: 'GESAMT', recip: 'EMPFÄNGER', unload: 'ABLADEORT', regno: 'REGISTRIERNUMMER / FAHRZEUGTYP', fridge: 'Auto mit Tiefkühlaufbau -18°C', load: 'LADEORT', seller: 'VERKÄUFER', remarks: 'ANMERKUNGEN / VORAUSSETZUNGEN FÜR BESCHWERDEN', ship: 'Datum des Versands', sign: 'Unterschrift des Ausstellers',
    c1pl: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).',
    c1: 'Beanstandungen der Qualität und Menge der Ware (Reklamationen) müssen während des Be-/Entladens und/oder bis zur Unterzeichnung der Lieferpapiere (Rechnung, Lieferschein, CMR) erfolgen.',
    c2pl: 'Braki wagowe należy udokumentować w obecności osoby dostarczającej towar (kierowcy), na przyjętym w firmie formularzu, podpisanym przez obie strony. Następnie oryginał lub ksero załączyć do dokumentów zwrotnych.',
    c2: 'Fehlgewichte müssen in Anwesenheit der Person, die die Waren abholt/anliefert (Fahrer), auf einem vom Unternehmen akzeptierten und von beiden Parteien unterzeichneten Formular dokumentiert werden. Legen Sie dann das Original oder eine Fotokopie den Rücksendeunterlagen bei.',
    c3pl: 'Reklamacje nie będą rozpatrywane po akceptacji dostawy (podpisanie dokumentów towarzyszących dostawie: faktura, WZ, CMR), bez wcześniejszego zgłoszenia zastrzeżeń co do dostawy*.',
    c3: 'Reklamationen werden nach der Annahme der Annahme/Lieferung (Unterzeichnung der Begleitdokumente der Lieferung: Rechnung, Lieferschein, CMR) nicht berücksichtigt, ohne dass zuvor Vorbehalte gegen die Annahme/Lieferung angemeldet wurden*.',
    c4pl: '*nie dotyczy sytuacji otrzymania nieprawidłowych wyników badań wykonywanych przez instytucje Państwowe sprawujące kontrolę nad zakładami',
    c4: '*gilt nicht, wenn die staatlichen Institutionen, die die Betriebe kontrollieren, falsche Testergebnisse erhalten haben.',
    c5pl: 'Podpisując dokumenty towarzyszących dostawie (faktura, WZ, CMR) zgadzasz się z powyższymi i akceptujesz warunki reklamacji przyjętymi w firmie i udostępnianych na życzenie klienta.',
    c5: 'Mit Ihrer Unterschrift auf den der Lieferung beigefügten Dokumenten (Rechnung, Lieferschein, CMR) erklären Sie sich mit dem Vorstehenden einverstanden und akzeptieren die vom Unternehmen festgelegten und auf Anfrage zur Verfügung gestellten Reklamationsbedingungen.',
  },
  en: { title: 'COMMERCIAL IDENTIFICATION DOCUMENT', number: 'HDI No.', issue: 'Date of issue', producer: 'Producer', qual: 'Establishment qualified to sell on the market', vet: 'Veterinary identification number', dom: 'Domestic market', eu: 'European Union', superv: 'The establishment is under permanent veterinary supervision and has a HACCP system.', lp: 'No.', cName: 'PRODUCT NAME', cQty: 'QTY', cNet: 'NET WEIGHT', cBatch: 'BATCH NO.', cExp: 'BEST BEFORE', total: 'TOTAL', recip: 'RECIPIENT', unload: 'UNLOADING PLACE', regno: 'REGISTRATION NUMBER / VEHICLE TYPE', fridge: 'Truck with freezer body -18°C', load: 'LOADING PLACE', seller: 'SELLER', remarks: 'COMMENTS / CONDITIONS REGARDING COMPLAINTS', ship: 'Date of shipment', sign: 'Signature of the issuer',
    c1pl: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).',
    c1: 'Any objections to the quality or quantity of the goods (complaints) must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.',
    c2pl: 'Braki wagowe należy udokumentować w obecności osoby dostarczającej towar (kierowcy), na przyjętym w firmie formularzu, podpisanym przez obie strony. Następnie oryginał lub ksero załączyć do dokumentów zwrotnych.',
    c2: 'If the weight of the goods is lower than agreed, it must be documented in the presence of the person collecting/delivering the goods (driver) on a form approved by the company and signed by both parties.',
    c3pl: 'Reklamacje nie będą rozpatrywane po akceptacji dostawy (podpisanie dokumentów towarzyszących dostawie: faktura, WZ, CMR), bez wcześniejszego zgłoszenia zastrzeżeń co do dostawy*.',
    c3: 'Complaints will not be considered after the acceptance of the pick up/delivery without prior notification of objections*.',
    c4pl: '*nie dotyczy sytuacji otrzymania nieprawidłowych wyników badań wykonywanych przez instytucje Państwowe sprawujące kontrolę nad zakładami',
    c4: '*Does not apply in the case of abnormal results of tests performed by State institutions controlling the establishments.',
    c5pl: 'Podpisując dokumenty towarzyszących dostawie (faktura, WZ, CMR) zgadzasz się z powyższymi i akceptujesz warunki reklamacji przyjętymi w firmie i udostępnianych na życzenie klienta.',
    c5: 'By signing the documents accompanying the delivery, you agree with the above and accept the terms and conditions regarding complaints.',
  },
  sk: { title: 'OBCHODNÝ IDENTIFIKAČNÝ DOKLAD', number: 'Číslo HDI', issue: 'Dátum vystavenia', producer: 'Výrobca', qual: 'Prevádzka kvalifikovaná na predaj na trhu', vet: 'Veterinárne identifikačné číslo', dom: 'Domáci trh', eu: 'Európska únia', superv: 'Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.', lp: 'Č.', cName: 'NÁZOV TOVARU', cQty: 'KS', cNet: 'ČISTÁ HMOTNOSŤ', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DÁTUM SPOTREBY', total: 'SPOLU', recip: 'PRÍJEMCA', unload: 'MIESTO VYKLÁDKY', regno: 'EVIDENČNÉ ČÍSLO / TYP VOZIDLA', fridge: 'Auto s mraziarenskou nadstavbou -18°C', load: 'MIESTO NAKLÁDKY', seller: 'PREDÁVAJÚCI', remarks: 'POZNÁMKY / PODMIENKY REKLAMÁCIE', ship: 'Dátum odoslania', sign: 'Podpis vystaviteľa',
    c1pl: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).',
    c1: 'Všetky výhrady k akosti a množstvu tovaru (reklamácie) je potrebné nahlásiť počas vykládky a/alebo do podpísania dokladov priložených k dodávke.',
    c2pl: 'Braki wagowe należy udokumentować w obecności osoby dostarczającej towar (kierowcy), na przyjętym w firmie formularzu, podpisanym przez obie strony.',
    c2: 'Hmotnostné nedostatky musia byť zdokumentované za prítomnosti osoby doručujúcej tovar (vodiča).',
    c3pl: 'Reklamacje nie będą rozpatrywane po akceptacji dostawy.',
    c3: 'Reklamácie nebudú akceptované po prevzatí dodávky.',
    c4pl: '*nie dotyczy sytuacji otrzymania nieprawidłowych wyników badań wykonywanych przez instytucje Państwowe',
    c4: '*Nevzťahuje sa na prípady nesprávnych výsledkov testov štátnych inštitúcií.',
    c5pl: 'Podpisując dokumenty towarzyszących dostawie zgadzasz się z powyższymi warunkami reklamacji.',
    c5: 'Podpisom dokladov k dodávke súhlasíte s vyššie uvedenými podmienkami reklamácie.',
  },
  cs: { title: 'OBCHODNÍ IDENTIFIKAČNÍ DOKLAD', number: 'Číslo HDI', issue: 'Datum vystavení', producer: 'Výrobce', qual: 'Provozovna kvalifikovaná k prodeji na trhu', vet: 'Veterinární identifikační číslo', dom: 'Domácí trh', eu: 'Evropská unie', superv: 'Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.', lp: 'Č.', cName: 'NÁZEV ZBOŽÍ', cQty: 'KS', cNet: 'ČISTÁ HMOTNOST', cBatch: 'ČÍSLO ŠARŽE', cExp: 'DATUM SPOTŘEBY', total: 'CELKEM', recip: 'PŘÍJEMCE', unload: 'MÍSTO VYKLÁDKY', regno: 'EVIDENČNÍ ČÍSLO / TYP VOZIDLA', fridge: 'Auto s mrazírenskou nástavbou -18°C', load: 'MÍSTO NAKLÁDKY', seller: 'PRODÁVAJÍCÍ', remarks: 'POZNÁMKY / PODMÍNKY REKLAMACE', ship: 'Datum odeslání', sign: 'Podpis vystavitele',
    c1pl: 'Wszelkie zastrzeżenia co do jakości i ilości towaru (reklamacje) należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).',
    c1: 'Veškeré výhrady k jakosti a množství zboží (reklamace) je nutné nahlásit během vykládky a/nebo do podpisu dokladů přiložených k dodávce.',
    c2pl: 'Braki wagowe należy udokumentować w obecności osoby dostarczającej towar (kierowcy).',
    c2: 'Hmotnostní nedostatky musí být zdokumentovány za přítomnosti osoby doručující zboží (řidiče).',
    c3pl: 'Reklamacje nie będą rozpatrywane po akceptacji dostawy.',
    c3: 'Reklamace nebudou přijaty po převzetí dodávky.',
    c4pl: '*nie dotyczy sytuacji otrzymania nieprawidłowych wyników badań wykonywanych przez instytucje Państwowe',
    c4: '*Nevztahuje se na případy nesprávných výsledků testů státních institucí.',
    c5pl: 'Podpisując dokumenty towarzyszących dostawie zgadzasz się z powyższymi warunkami reklamacji.',
    c5: 'Podpisem dokladů k dodávce souhlasíte s výše uvedenými podmínkami reklamace.',
  },
}

const MIN_ROWS = 12

export function HdiPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [doc, setDoc] = useState<HdiDoc | null>(null)
  const [err, setErr] = useState('')
  // ?pdf=1 → render do PDF przez headless Chrome; nie wywołuj wtedy window.print().
  const isPdf = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('pdf')
  useEffect(() => { hdiApi.get(id).then(setDoc).catch(e => setErr(e instanceof Error ? e.message : 'Błąd')) }, [id])
  useEffect(() => { if (doc && !isPdf) { const t = setTimeout(() => window.print(), 500); return () => clearTimeout(t) } }, [doc, isPdf])
  if (err) return <div className="p-8 text-red-700">{err}</div>
  if (!doc) return <div className="p-8 text-slate-500">Ładowanie HDI…</div>

  const pl = L.pl
  const cl = L[doc.language] || L.en
  const h = doc.header
  const mono = doc.language === 'pl'

  // Bilingual label: PL line + foreign line (or just PL if mono)
  const two = (k: string) => mono
    ? <span>{pl[k]}</span>
    : <><span>{pl[k]}</span><br /><span style={{ fontStyle: 'italic', fontWeight: 'normal', fontSize: '7.5px', color: '#444' }}>{cl[k]}</span></>

  // Combined label for inline use
  const bi = (k: string) => mono ? pl[k] : `${pl[k]} / ${cl[k]}`

  const items = doc.items || []
  const padCount = Math.max(0, MIN_ROWS - items.length)

  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 8mm; }
          body { margin: 0; }
        }
        .hdi {
          max-width: 194mm;
          margin: 0 auto;
          padding: 6px 8px;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 9px;
          line-height: 1.3;
          color: #000;
        }
        .hdi table {
          border-collapse: collapse;
          width: 100%;
        }

        /* ── Header meta row ── */
        .hdi .meta-table td {
          border: 1px solid #9a9a9a;
          padding: 3px 6px;
          vertical-align: middle;
        }

        /* ── Producer / market block ── */
        .hdi .header-table td {
          border: 1px solid #9a9a9a;
          padding: 3px 6px;
          vertical-align: top;
        }

        /* ── Products table ── */
        .hdi .prod-table th {
          border: 1px solid #9a9a9a;
          padding: 2px 4px;
          background: #e9e9e9;
          text-align: center;
          font-size: 8px;
          line-height: 1.2;
          vertical-align: middle;
          font-weight: bold;
        }
        .hdi .prod-table td {
          border: 1px solid #9a9a9a;
          padding: 2px 4px;
          vertical-align: middle;
          font-size: 9px;
        }
        .hdi .prod-table td.center { text-align: center; }
        .hdi .prod-table td.right { text-align: right; }
        .hdi .prod-table tr.total-row td {
          background: #ededed;
          font-weight: bold;
          border-top: 1.5px solid #6f6f6f;
        }
        .hdi .prod-table tr.empty-row td {
          height: 14px;
        }

        /* ── Multi-batch: osobne kolumny szt / partia / termin ── */
        .hdi .prod-table td.bqty-cell {
          white-space: nowrap;
          font-weight: bold;
          font-size: 8px;
          text-align: center;
        }
        .hdi .prod-table td.bpartia-cell {
          font-family: 'Courier New', monospace;
          font-size: 8px;
          text-align: center;
          white-space: nowrap;
        }
        .hdi .prod-table td.btermin-cell {
          text-align: center;
          font-size: 8.5px;
          white-space: nowrap;
        }
        /* każdy wiersz partii — stała wysokość, by szt/partia/termin były wyrównane */
        .hdi .prod-table .bline {
          line-height: 1.5;
        }
        .hdi .prod-table .bline + .bline {
          border-top: 1px dotted #ccc;
        }

        /* ── Info table ── */
        .hdi .info-table td {
          border: 1px solid #9a9a9a;
          padding: 3px 6px;
          vertical-align: top;
          font-size: 9px;
        }
        .hdi .info-table td.label-cell {
          font-weight: bold;
          white-space: nowrap;
          width: 26%;
          font-size: 8.5px;
          background: #f0f0f0;
        }

        /* ── Remarks ── */
        .hdi .remarks-box {
          border: 1px solid #9a9a9a;
          padding: 3px 6px;
          margin-top: 3px;
        }
        .hdi .remarks-box .title {
          font-weight: bold;
          font-size: 7.5px;
          line-height: 1.2;
          margin-bottom: 2px;
        }
        .hdi .remarks-box .item {
          font-size: 7.5px;
          line-height: 1.25;
          margin-bottom: 1px;
        }
        .hdi .remarks-box .item-foreign {
          font-size: 7.5px;
          line-height: 1.25;
          font-style: italic;
          color: #333;
          margin-bottom: 3px;
        }

        /* ── Footer ── */
        .hdi .footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 14px;
          font-size: 9px;
        }
        .hdi .footer .sig-line {
          width: 200px;
          border-bottom: 1px solid #000;
          margin-bottom: 2px;
        }
        .hdi .footer .sig-label {
          font-size: 8px;
          text-align: center;
        }
      `}</style>

      {/* Toolbar — hidden on print */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
        <Link to="/office/zamowienia" style={{ fontSize: '13px', color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}>
          <ArrowLeft size={14} /> Zamówienia
        </Link>
        <button
          onClick={() => window.print()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer' }}
        >
          <Printer size={14} /> Drukuj
        </button>
        <a
          href={hdiApi.pdfUrl(id)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fff', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '4px', padding: '5px 12px', fontSize: '13px', cursor: 'pointer', textDecoration: 'none' }}
        >
          <Download size={14} /> Pobierz PDF
        </a>
      </div>

      <div className="hdi">

        {/* Wstępny banner */}
        {doc.status === 'wstepny' && (
          <div style={{ marginBottom: '4px', border: '1px solid #d97706', background: '#fffbeb', padding: '3px 8px', fontSize: '8.5px', fontWeight: 700, color: '#92400e' }}>
            DOKUMENT WSTĘPNY — towar niezeskanowany na załadunku, możliwe rozbieżności
            {doc.incomplete ? ' · wystawiony na stan faktyczny (niekompletny względem zamówienia)' : ''}
          </div>
        )}

        {/* ── Tytuł ── */}
        <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '11.5px', lineHeight: 1.3, marginBottom: '4px' }}>
          {mono
            ? pl.title
            : <>{pl.title}<span style={{ fontWeight: 400 }}> / </span>{cl.title}</>
          }
        </div>

        {/* ── Numer + data ── */}
        <table className="meta-table" style={{ marginBottom: '2px' }}>
          <tbody>
            <tr>
              <td style={{ width: '50%' }}>
                <b>{bi('number')}:</b> {doc.number}
              </td>
              <td style={{ width: '50%' }}>
                <b>{bi('issue')}:</b> {doc.issueDate}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Producent + rynek + vet ── */}
        <table className="header-table" style={{ marginBottom: '2px' }}>
          <tbody>
            <tr>
              <td style={{ width: '58%' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '1px' }}>{bi('producer')}:</div>
                <div style={{ fontWeight: 700, fontSize: '9.5px' }}>{h.producer_name}</div>
                <div>{h.producer_addr}</div>
                {h.producer_nip && <div>NIP: {h.producer_nip}</div>}
                {h.producer_email && <div>E-mail: {h.producer_email}</div>}
              </td>
              <td style={{ width: '42%' }}>
                <div style={{ fontSize: '7.5px', lineHeight: 1.2, marginBottom: '3px' }}>
                  {pl.qual}{mono ? '' : <><span style={{ fontWeight: 400 }}> / </span><span style={{ fontStyle: 'italic' }}>{cl.qual}</span></>}:
                </div>
                <div style={{ marginBottom: '1px' }}>
                  {h.market_domestic ? '☒' : '☐'} {pl.dom}
                </div>
                <div>
                  {h.market_eu ? '☒' : '☐'} {pl.eu}
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={2}>
                <b>{bi('vet')}:</b> {h.vet_number}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── HACCP ── */}
        <div style={{ fontSize: '8.5px', lineHeight: 1.3, marginBottom: '3px' }}>
          {pl.superv}
          {!mono && <><br /><span style={{ fontStyle: 'italic', color: '#333' }}>{cl.superv}</span></>}
        </div>

        {/* ── Tabela produktów ── */}
        <table className="prod-table" style={{ marginBottom: '2px' }}>
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '17%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>{two('lp')}</th>
              <th>{two('cName')}</th>
              <th>{two('cQty')}</th>
              <th>{two('cNet')}</th>
              <th></th>
              <th>{two('cBatch')}</th>
              <th>{two('cExp')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const multi = it.batches.length > 1
              return (
                <tr key={`item-${i}`}>
                  <td className="center">{i + 1}.</td>
                  <td style={{ fontWeight: 600 }}>{it.name}</td>
                  <td className="center">{it.qty}szt.</td>
                  <td className="center">{it.kg.toFixed(0)}kg</td>
                  {/* Osobna kolumna: liczba sztuk z danej partii (jak na wzorze) */}
                  <td className="bqty-cell">
                    {multi ? it.batches.map((b, j) => (<div key={j} className="bline">{b.qty}SZT</div>)) : null}
                  </td>
                  <td className="bpartia-cell">
                    {it.batches.map((b, j) => (<div key={j} className="bline">{b.partia}</div>))}
                  </td>
                  <td className="btermin-cell">
                    {it.batches.map((b, j) => (<div key={j} className="bline">{b.termin}</div>))}
                  </td>
                </tr>
              )
            })}

            {/* Empty padding rows */}
            {Array.from({ length: padCount }).map((_, i) => (
              <tr key={`e${i}`} className="empty-row">
                <td className="center" style={{ color: '#999', fontSize: '8px' }}>{items.length + i + 1}.</td>
                <td></td><td></td><td></td><td></td><td></td><td></td>
              </tr>
            ))}

            {/* Razem */}
            <tr className="total-row">
              <td></td>
              <td className="right">{bi('total')}:</td>
              <td className="center">{doc.totals.qty}szt.</td>
              <td className="center">{doc.totals.kg.toFixed(0)}kg</td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {/* ── Odbiorca / załadunek ── */}
        <table className="info-table" style={{ marginBottom: '2px' }}>
          <tbody>
            <tr>
              <td className="label-cell">{two('recip')}</td>
              <td>{h.recipient}</td>
            </tr>
            <tr>
              <td className="label-cell">{two('unload')}</td>
              <td>{h.unload}</td>
            </tr>
            <tr>
              <td className="label-cell">{two('regno')}</td>
              <td>
                {/* Nr rejestracyjny pobierany przy załadunku (wybór samochodu); pusty, gdy brak */}
                {h.reg_number ? <div style={{ fontWeight: 700 }}>{h.reg_number}</div> : null}
                {pl.fridge}
                {!mono && <><br /><span style={{ fontStyle: 'italic', color: '#333' }}>{cl.fridge}</span></>}
              </td>
            </tr>
            <tr>
              <td className="label-cell">{two('load')}</td>
              <td>{h.load}</td>
            </tr>
            <tr>
              <td className="label-cell">{two('seller')}</td>
              <td>{h.seller}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Uwagi / Reklamacje ── */}
        <div className="remarks-box">
          <div className="title">{pl.remarks}:</div>
          {[1, 2, 3, 4, 5].map(n => {
            const k = `c${n}` as keyof typeof pl
            const kpl = `c${n}pl` as keyof typeof pl
            return (
              <div key={n}>
                <div className="item">{n <= 3 ? `${n}). ` : ''}{pl[kpl]}</div>
                {!mono && <div className="item-foreign">{n <= 3 ? `${n}). ` : ''}{cl[k]}</div>}
              </div>
            )
          })}
        </div>

        {/* ── Stopka ── */}
        <div className="footer">
          <div>{bi('ship')}: {doc.issueDate}</div>
          <div style={{ textAlign: 'center' }}>
            <div className="sig-line">&nbsp;</div>
            <div className="sig-label">({bi('sign')})</div>
          </div>
        </div>

      </div>
    </div>
  )
}
