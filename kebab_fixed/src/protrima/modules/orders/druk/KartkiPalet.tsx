import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, Boxes } from 'lucide-react'
import QRCode from 'qrcode'
import { Dialog } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, type Order } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { BEZ_DRUKU_ETYKIET } from '../../../proba'
import { useClientNames, useClientRecipeNames } from '@/lib/clientNames'
import { buildCartonLabelContent, cartonLabelTotalKg, formatKgCompact } from '@/features/labels/cartonLabelLines'
import { CARTON_QR_OPTIONS, palletQrPayload } from '@/features/labels/cartonQr'
import { KOPII_NA_PALETE } from '@/features/labels/CartonLabel'
import { zlozNazweWyrobu } from '@/features/wz/nazwaWyrobu'
import { useApi } from '@/hooks/useApi'
import { productTypesApi } from '@/lib/api'

/** Widełki pisma treści — te same co stary MES (właściciel 09.09.2026: sufit 90 pt, ani punktu więcej). */
const MAX_PT = 90
const MIN_PT = 14
const UDZIAL_WYSOKOSCI = 0.72
const SKALA_PODGLADU = 0.3

export interface Kartka {
  palletNo: number
  qr: string
  cornerNo: string
  clientName: string
  recipeHeader: string | null
  mainLines: string[]
  totalKg: number
  orderNo: string
  /** Lewy dół zamiast „ZAMÓWIENIE: …” — karton magazynowy ma tam „MAGAZYN” (jak stary MES). */
  stopka?: string
}

/** Co stoi na kartce obok liczb: sama receptura (jak dotąd), sam rodzaj albo rodzaj z recepturą. */
export type TrybNazwy = 'recipe' | 'type' | 'type_recipe'
export const TRYBY_NAZWY: Array<{ v: TrybNazwy; t: string }> = [
  { v: 'recipe', t: 'Receptura' }, { v: 'type', t: 'Rodzaj' }, { v: 'type_recipe', t: 'Rodzaj i receptura' },
]
export interface OpcjeKartki {
  /** Nazwa klienta wpisana przy druku; pusta = nazwa z kartoteki. */
  nazwa?: string
  tryb?: TrybNazwy
  /** Rodzaj pod nazwą z dokumentów („KEBAB MIX” zamiast „KEBAB MIX 95/5”). */
  rodzajNa?: (productTypeName: string) => string
}

/**
 * Treść kartek — zasady starego MES (`PalletLabelsBatchPrintPage`): receptura
 * nazwana tak jak u TEGO odbiorcy, grupy (nazwa, kg/szt, tuleja) z
 * `buildCartonLabelContent`, kolejność palet z wyboru, numer w rogu = karton.
 * Nazwę klienta i to, co pokazać (receptura / rodzaj / oba), wybiera się przy
 * druku (właściciel 30.10.2026: „lepiej przy druku niż w kontrahencie”).
 */
export function zbudujKartki(order: Order, numery: number[], klientNa: (n: string) => string,
  recepturaNa: (c: { id?: string; name?: string }, recipeId: string | undefined, fallback: string) => string,
  opcje: OpcjeKartki = {}): Kartka[] {
  const linie = new Map(order.lines.map(l => [l.id, l]))
  const tryb = opcje.tryb ?? 'recipe'
  const rodzajNa = opcje.rodzajNa ?? ((n: string) => n)
  const klient = opcje.nazwa?.trim() || klientNa(order.client.name)
  return numery.map(nr => order.pallets.find(p => p.no === nr)).filter((p): p is NonNullable<typeof p> => !!p).map(p => {
    const items = p.items.map(it => {
      const l = linie.get(it.lineId)
      const receptura = recepturaNa({ id: order.client.id, name: order.client.name }, l?.recipeId, l?.recipe ?? '')
      const rodzaj = l?.product && l.product !== '—' ? rodzajNa(l.product) : ''
      return {
        qty: it.qty, kgPerUnit: Number(l?.kgPerUnit ?? 0),
        // Bez powtórzeń: „KEBAB YAPRAK” + „YAPRAK” → „KEBAB YAPRAK” (jak HDI i WZ).
        recipeName: tryb === 'recipe' ? receptura : tryb === 'type' ? (rodzaj || receptura) : zlozNazweWyrobu(rodzaj, receptura),
        packagingName: l?.packaging ?? '',
      }
    })
    const { recipeHeader, lines } = buildCartonLabelContent(items)
    const szt = items.reduce((a, i) => a + i.qty, 0)
    return {
      palletNo: p.no, qr: palletQrPayload(order.id, p.no), cornerNo: p.carton || `P${p.no}`,
      clientName: klient, recipeHeader,
      // Paleta bez pozycji z wagą — sama liczba sztuk, żeby kartka nie wyszła pusta.
      mainLines: lines.length ? lines : [`${szt} SZT`], totalKg: cartonLabelTotalKg(items), orderNo: order.no,
    }
  })
}

/** Jedna kartka A4 poziomo (287 × 200 mm). `pt` = dobrany stopień; bez niego strona sama go dobiera. */
export function Strona({ k, qr, pt, onPt, proba }: { k: Kartka; qr: string; pt?: number; onPt?: (pt: number) => void; proba: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const txtRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<number | null>(pt ?? null)
  useLayoutEffect(() => {
    if (pt) return
    let porzucone = false
    const dopasuj = () => {
      const box = boxRef.current, t = txtRef.current
      if (!box || !t || porzucone) return
      const w = Math.max(120, box.clientWidth), h = Math.max(120, box.clientHeight) * UDZIAL_WYSOKOSCI
      const miesci = (v: number) => { t.style.fontSize = `${v}pt`; return t.scrollWidth <= w && t.scrollHeight <= h }
      let dol = MIN_PT, gora = MAX_PT, best = MIN_PT
      if (miesci(MAX_PT)) best = MAX_PT
      else while (gora - dol > 0.5) { const s = (dol + gora) / 2; if (miesci(s)) { best = s; dol = s } else gora = s }
      while (best > MIN_PT && !miesci(best)) best -= 0.5
      t.style.fontSize = `${best}pt`
      setFit(best); onPt?.(best)
    }
    const f = requestAnimationFrame(dopasuj)
    // Arial Black dociąga się po pierwszym renderze — inne metryki niż krój zastępczy.
    document.fonts?.ready.then(dopasuj).catch(() => undefined)
    return () => { porzucone = true; cancelAnimationFrame(f) }
  }, [k, pt]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="kp-page">
      {proba && <div className="kp-proba" aria-hidden>PRÓBA</div>}
      <div className="kp-corner">{k.cornerNo}</div>
      <div ref={boxRef} className="kp-box">
        <div ref={txtRef} className="kp-txt" style={{ fontSize: `${fit ?? MAX_PT}pt`, visibility: fit ? 'visible' : 'hidden' }}>
          {k.clientName && <div>{k.clientName}</div>}
          {k.recipeHeader && <div>{k.recipeHeader}</div>}
          {k.mainLines.map((l, i) => <div key={i} className={i === 0 ? 'kp-first' : undefined}>{l}</div>)}
        </div>
      </div>
      <div className="kp-foot">
        <div><div className="kp-wl">WAGA NETTO</div><div className="kp-wv">{formatKgCompact(k.totalKg)} KG</div><div className="kp-ord">{k.stopka ?? `ZAMÓWIENIE: ${k.orderNo}`}</div></div>
        <div className="kp-qr">
          <div className="kp-qr-slot">{qr ? <img src={qr} alt="QR" /> : proba ? <span>QR wyłączony w próbie</span> : null}</div>
          <div className="kp-qr-cap">{k.cornerNo}{k.orderNo ? ` · ${k.orderNo}` : ''}</div>
        </div>
      </div>
    </div>
  )
}

/** Treść kartki ustawiana przy druku; ostatni wybór dla klienta pamięta ten komputer. */
export function useTrescKartki(clientId: string) {
  const klucz = `protrima.kartka.${clientId}`
  const [tresc, setTresc] = useState<{ nazwa: string; tryb: TrybNazwy }>(() => {
    try { const z = JSON.parse(localStorage.getItem(klucz) ?? 'null'); if (z && typeof z === 'object') return { nazwa: String(z.nazwa ?? ''), tryb: TRYBY_NAZWY.some(t => t.v === z.tryb) ? z.tryb : 'recipe' } } catch { /* brak pamięci — domyślne */ }
    return { nazwa: '', tryb: 'recipe' }
  })
  const ustawTresc = (p: Partial<typeof tresc>) => setTresc(t => {
    const n = { ...t, ...p }
    try { localStorage.setItem(klucz, JSON.stringify(n)) } catch { /* bez zapamiętania */ }
    return n
  })
  return [tresc, ustawTresc] as const
}

/** Rodzaj pod nazwą z dokumentów („KEBAB MIX” zamiast „KEBAB MIX 95/5”). */
export function useRodzajNaDokumentach() {
  const typyRes = useApi(() => productTypesApi.list())
  return useMemo(() => {
    const m = new Map((typyRes.data ?? []).map(t => [t.name, (t.documentName || t.name).trim()]))
    return (n: string) => m.get(n) || n
  }, [typyRes.data])
}

/**
 * Druk kartek: kody QR (tylko brakujące), dobrany stopień pisma każdej kartki
 * i okno drukowania. Druk dopiero, gdy KAŻDA kartka ma kod i stopień — kartka
 * bez QR jest nie do zeskanowania. W próbie bez kodów (numery z kopii).
 */
export function useDrukKartek(kartki: Kartka[], proba: boolean, tytul: string) {
  const [qr, setQr] = useState<Record<string, string>>({})
  const [pt, setPt] = useState<Record<string, number>>({})
  const [druk, setDruk] = useState(false)
  // Klucz efektu to zestaw adresów, nie tożsamość tablicy (inaczej pętla przy każdym renderze).
  const adresy = kartki.map(k => k.qr).join('\n')
  useEffect(() => {
    if (proba || !adresy) return
    let zywe = true
    const brak = adresy.split('\n').filter(a => !qr[a])
    if (!brak.length) return
    Promise.all(brak.map(async a => [a, await QRCode.toDataURL(a, CARTON_QR_OPTIONS).catch(() => '')] as const))
      .then(p => { if (zywe) setQr(s => ({ ...s, ...Object.fromEntries(p) })) })
    return () => { zywe = false }
  }, [adresy, proba]) // eslint-disable-line react-hooks/exhaustive-deps
  const gotowe = kartki.length > 0 && kartki.every(k => qr[k.qr] && pt[k.qr])
  useEffect(() => {
    if (!druk) return
    const prev = document.title
    document.title = tytul
    const done = () => setDruk(false)
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 80)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.title = prev }
  }, [druk, tytul])
  const ustawPt = (k: Kartka) => (v: number) => setPt(s => (s[k.qr] === v ? s : { ...s, [k.qr]: v }))
  const arkusz = druk ? createPortal(<div className="print-sheet kartki-print">
    {kartki.flatMap(k => Array.from({ length: KOPII_NA_PALETE }, (_, i) => <Strona key={`${k.qr}-${i}`} k={k} qr={qr[k.qr] ?? ''} pt={pt[k.qr]} proba={false} />))}
  </div>, document.body) : null
  return { qr, ustawPt, gotowe, druk, drukuj: () => setDruk(true), arkusz }
}

/**
 * Kartki na palety zamówienia — A4 poziomo, DWIE kopie na paletę (naklejane
 * na karton), wybór palet, podgląd. W PRÓBIE druk zablokowany i bez kodu QR:
 * kopia ma prawdziwe numery palet, a numer nadany w kopii produkcja nada
 * później innej palecie (ZASADY_PROBY pkt 4).
 */
export function KartkiPaletDialog({ orderId, palletNos, onClose, proba = import.meta.env.MODE === 'proba' }: {
  orderId: string; palletNos?: number[]; onClose: () => void; proba?: boolean
}) {
  const { orders } = useOrders()
  const order = orders.find(o => o.id === orderId)
  const klientNa = useClientNames()
  const recepturaNa = useClientRecipeNames()
  const wszystkie = useMemo(() => (order?.pallets ?? []).map(p => p.no).sort((a, b) => a - b), [order])
  const [wybrane, setWybrane] = useState<number[]>(() => (palletNos?.length ? palletNos : wszystkie))
  const [tresc, ustawTresc] = useTrescKartki(order?.client.id ?? '')
  const rodzajNa = useRodzajNaDokumentach()
  const nazwaKartoteki = order ? klientNa(order.client.name) : ''
  const kartki = useMemo(() => (order ? zbudujKartki(order, wybrane, klientNa, recepturaNa, { nazwa: tresc.nazwa, tryb: tresc.tryb, rodzajNa }) : []),
    [order, wybrane, klientNa, recepturaNa, tresc.nazwa, tresc.tryb, rodzajNa])
  const { qr, ustawPt, gotowe, druk, drukuj, arkusz } = useDrukKartek(kartki, proba, `Kartki palet — ${order?.no ?? ''}`)

  if (!order) return null
  const przelacz = (nr: number) => setWybrane(w => (w.includes(nr) ? w.filter(x => x !== nr) : [...w, nr].sort((a, b) => a - b)))
  const kartek = kartki.length * KOPII_NA_PALETE
  return (
    <Dialog title={`Kartki palet — ${order.no}`} icon={<Boxes size={20} />} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} data-autofocus>Zamknij</button>
        <button className="btn primary" disabled={proba || !gotowe || druk} onClick={drukuj} data-tip={proba ? BEZ_DRUKU_ETYKIET : undefined}>
          <Printer size={15} />{proba ? 'Druk wyłączony w próbie' : `Drukuj ${kartek} ${kartek === 1 ? 'kartkę' : kartek < 5 ? 'kartki' : 'kartek'}`}</button>
      </>}>
      {proba && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{BEZ_DRUKU_ETYKIET} Podgląd pokazuje układ kartki — bez kodu QR.</div></div>}
      <div className="kp-layout">
        <div className="kp-list">
          <div className="kp-tresc" role="group" aria-label="Treść kartki">
            <span className="label">Treść kartki</span>
            <label className="fld"><span className="sub">Nazwa na kartce</span>
              <input className="field" value={tresc.nazwa} placeholder={nazwaKartoteki} onChange={e => ustawTresc({ nazwa: e.target.value })} aria-label="Nazwa klienta na kartce" /></label>
            <div className="fld"><span className="sub">Pokaż</span>
              <div className="seg kp-seg" role="group" aria-label="Co pokazać na kartce">
                {TRYBY_NAZWY.map(t => <button key={t.v} type="button" aria-pressed={tresc.tryb === t.v} onClick={() => ustawTresc({ tryb: t.v })}>{t.t}</button>)}
              </div></div>
            {(tresc.nazwa || tresc.tryb !== 'recipe') && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => ustawTresc({ nazwa: '', tryb: 'recipe' })}>Przywróć domyślne</button>}
          </div>
          <span className="label">Palety</span>
          <div className="row-wrap" style={{ marginBottom: 6 }} role="group" aria-label="Palety do wydruku">
            <button className="btn sm ghost" onClick={() => setWybrane(wszystkie)}>Wszystkie</button>
            <button className="btn sm ghost" onClick={() => setWybrane([])}>Żadna</button>
          </div>
          {order.pallets.slice().sort((a, b) => a.no - b.no).map(p => (
            <label key={p.id} className="kp-opt">
              <input type="checkbox" className="cbx" checked={wybrane.includes(p.no)} onChange={() => przelacz(p.no)} aria-label={`Paleta ${p.no}`} />
              <b>P{p.no}</b><span className="code muted">{p.carton}</span>
              <span className="num muted" style={{ marginLeft: 'auto' }}>{kg(cartonLabelTotalKg(p.items.map(it => ({ qty: it.qty, kgPerUnit: order.lines.find(l => l.id === it.lineId)?.kgPerUnit ?? 0 }))))}</span>
            </label>
          ))}
          <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 0' }}>{kartki.length} {kartki.length === 1 ? 'paleta' : 'palet'} × {KOPII_NA_PALETE} kopie = {kartek} kartek A4 (poziomo).</p>
        </div>
        <div className="kp-preview" aria-label="Podgląd kartek">
          {kartki.length === 0 && <div className="empty">Zaznacz palety do wydruku.</div>}
          {kartki.map(k => (
            <div key={k.qr} className="kp-thumb" style={{ ['--kp-s' as string]: SKALA_PODGLADU }} data-testid={`kartka-${k.palletNo}`}>
              <Strona k={k} qr={qr[k.qr] ?? ''} proba={proba} onPt={ustawPt(k)} />
            </div>
          ))}
        </div>
      </div>
      {arkusz}
    </Dialog>
  )
}
