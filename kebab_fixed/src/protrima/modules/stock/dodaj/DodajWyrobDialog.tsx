import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, PackagePlus, PenLine, Plus, Search, Trash2, X } from 'lucide-react'
import { Dialog, useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { fmtDate, kg, lineMissing, num as fmtNum } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { Wybor } from '../../../ui/Wybor'
import { useApi } from '@/hooks/useApi'
import { clientsApi, errStatus, finishedGoodsApi, packagingApi, productTypesApi, recipesApi, seasonedMeatApi } from '@/lib/api'
import { liczba } from '@/features/finished-goods/manualGoods'
import {
  bledyKoszyka, dataLokalna as dzisiaj, dodajPartie, drzewoZamowien, nowyKlucz, payloadKoszyka, pelnaPozycja, pozycjaZLinii, rozpoznajPartie,
  statusPozycji, sumaPartii, sumyKoszyka, type PozycjaKoszyka, type WsadMasowni,
} from './model'

const kgTxt = (n: number) => String(n).replace('.', ',')
const PUSTA_RECZNA = { productTypeId: '', recipeId: '', packagingId: '', clientId: '', kgPerUnit: '', qty: '' }

/**
 * „Dodaj wyrób gotowy” — wpis biura z produkcji (do czasu paneli na hali).
 *
 * Po lewej zwijane drzewo klient → zamówienie → pozycje (dwa zamówienia
 * jednego klienta to dwie gałęzie). Po prawej „Do zapisu”: każda pozycja ma
 * tyle wierszy partii, ile trzeba — 80 szt. = 30 z partii 111 + 50 z 112.
 * Jeden zapis dla całości (`createBulk`, jedna transakcja na serwerze).
 */
export function DodajWyrobDialog({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const { orders, refresh } = useOrders()

  // Wszystkie wsady, nie tylko „wolne”: wsad zarezerwowany w planie to normalny stan po planowaniu,
  // a mięso i tak trzeba zdjąć. Liczy się tylko to, co fizycznie jeszcze leży (kgAvailable > 0).
  const wsadyRes = useApi(() => seasonedMeatApi.all())
  const recRes = useApi(() => recipesApi.list())
  const typRes = useApi(() => productTypesApi.list())
  const packRes = useApi(() => packagingApi.list())
  const kliRes = useApi(() => clientsApi.list())
  const wsady = useMemo(() => ((wsadyRes.data ?? []) as Array<WsadMasowni & { recipeName?: string; kgAvailable?: number }>)
    .filter(w => w.batchNo && Number(w.kgAvailable ?? 0) > 0), [wsadyRes.data])
  const nrWsadow = wsady
  const kartoteki = useMemo(() => ({
    recipes: ((recRes.data ?? []) as Array<{ id: string; name: string; productTypeId?: string; active?: boolean }>).filter(r => r.active !== false),
    types: ((typRes.data ?? []) as Array<{ id: string; name: string; active?: boolean }>).filter(t => t.active !== false),
    pack: ((packRes.data ?? []) as Array<{ id: string; name: string }>),
    clients: ((kliRes.data ?? []) as Array<{ id: string; name: string; displayName?: string; active?: boolean }>).filter(c => c.active !== false)
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl')),
  }), [recRes.data, typRes.data, packRes.data, kliRes.data])
  const kartotekiGotowe = !!recRes.data && !!typRes.data && !!packRes.data && !!kliRes.data

  const [data, setData] = useState(dzisiaj())
  const [q, setQ] = useState('')
  const [rozwinieci, setRozwinieci] = useState<Set<string>>(new Set())
  const [zwinieteZam, setZwinieteZam] = useState<Set<string>>(new Set())
  const [koszyk, setKoszyk] = useState<PozycjaKoszyka[]>([])
  const [reczny, setReczny] = useState(false)
  const [forma, setForma] = useState({ ...PUSTA_RECZNA })
  const [bledyFormy, setBledyFormy] = useState<Record<string, string>>({})
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const lock = useRef(false)

  const drzewo = useMemo(() => drzewoZamowien(orders, q), [orders, q])
  const wKoszyku = useMemo(() => new Set(koszyk.map(p => p.key)), [koszyk])
  const bledy = tried ? bledyKoszyka(koszyk, data) : {}
  const sumy = sumyKoszyka(koszyk)

  // Fokus na świeżo dodanym polu — zaraz po wyrenderowaniu, nie w następnej klatce:
  // biuro pisze szybko i znaki wpisane po Enter trafiały jeszcze do starego pola.
  const [fokus, setFokus] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!fokus) return
    const el = document.getElementById(fokus) as HTMLInputElement | null
    el?.focus(); if (el instanceof HTMLInputElement) el.select()
    setFokus(null)
  }, [fokus])
  // Pole już istnieje — fokus od razu, w tym samym zdarzeniu (bez klatki opóźnienia na szybkie pisanie).
  const skocz = (id: string) => { const el = document.getElementById(id) as HTMLInputElement | null; el?.focus(); el?.select?.() }
  const idPola = (p: PozycjaKoszyka, wKey: string, pole: 'nr' | 'qty') => `dw-${pole}-${p.key}-${wKey}`

  const przelaczKlienta = (id: string) => setRozwinieci(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const przelaczZam = (id: string) => setZwinieteZam(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const przelaczLinie = (orderId: string, lineId: string) => {
    if (wKoszyku.has(lineId)) { setKoszyk(k => k.filter(p => p.key !== lineId)); return }
    const o = orders.find(x => x.id === orderId)
    const l = o?.lines.find(x => x.id === lineId)
    if (!o || !l) return
    const p = pozycjaZLinii(o, l)
    setKoszyk(k => [...k, p])
    setFokus(idPola(p, p.partie[0].key, 'nr'))
  }

  const zmienPartie = (key: string, wKey: string, patch: { nr?: string; qty?: string }) =>
    setKoszyk(k => k.map(p => (p.key === key ? { ...p, partie: p.partie.map(w => (w.key === wKey ? { ...w, ...patch } : w)) } : p)))
  const nowaPartia = (key: string) => {
    const p = koszyk.find(x => x.key === key)
    if (!p) return
    const n = dodajPartie(p)
    setKoszyk(k => k.map(x => (x.key === key ? n : x)))
    setFokus(idPola(n, n.partie[n.partie.length - 1].key, 'nr'))
  }
  const usunPartie = (key: string, wKey: string) => setKoszyk(k => k.flatMap(p => {
    if (p.key !== key) return [p]
    const partie = p.partie.filter(w => w.key !== wKey)
    return partie.length ? [{ ...p, partie }] : []
  }))
  const usunPozycje = (key: string) => setKoszyk(k => k.filter(p => p.key !== key))

  // ── Wyrób bez zamówienia ──
  const rodzaje = useMemo(() => kartoteki.types.map(t => ({ id: t.id, label: t.name })), [kartoteki.types])
  const receptury = useMemo(() => kartoteki.recipes
    .filter(r => !forma.productTypeId || !r.productTypeId || r.productTypeId === forma.productTypeId)
    .map(r => ({ id: r.id, label: r.name })), [kartoteki.recipes, forma.productTypeId])
  const tuleje = useMemo(() => kartoteki.pack.map(p => ({ id: p.id, label: p.name })), [kartoteki.pack])
  const klienci = useMemo(() => kartoteki.clients.map(c => ({ id: c.id, label: c.displayName || c.name, sub: c.displayName && c.displayName !== c.name ? c.name : undefined })), [kartoteki.clients])

  const dodajReczna = () => {
    const b: Record<string, string> = {}
    const t = kartoteki.types.find(x => x.id === forma.productTypeId)
    const r = kartoteki.recipes.find(x => x.id === forma.recipeId)
    const qty = Math.round(liczba(forma.qty))
    const kpu = liczba(forma.kgPerUnit)
    if (!t) b.productTypeId = 'Wybierz rodzaj'
    if (!r) b.recipeId = 'Wybierz recepturę'
    if (kpu <= 0) b.kgPerUnit = 'Podaj wagę sztuki'
    if (qty <= 0) b.qty = 'Podaj sztuki'
    setBledyFormy(b)
    if (Object.keys(b).length || !t || !r) return
    const pk = kartoteki.pack.find(x => x.id === forma.packagingId)
    const k = kartoteki.clients.find(x => x.id === forma.clientId)
    const p: PozycjaKoszyka = {
      key: nowyKlucz('r'), zrodlo: 'reczna', orderNo: '',
      clientId: k?.id ?? '', clientName: k?.name ?? '', clientLabel: k ? (k.displayName || k.name) : '',
      recipeId: r.id, recipeName: r.name, productTypeId: t.id, productTypeName: t.name,
      packagingId: pk?.id ?? '', packagingName: pk?.name ?? '', kgPerUnit: kpu, cel: qty,
      partie: [{ key: nowyKlucz(), nr: '', qty: String(qty) }],
    }
    setKoszyk(x => [...x, p])
    setForma(f => ({ ...PUSTA_RECZNA, productTypeId: f.productTypeId, packagingId: f.packagingId, clientId: f.clientId }))
    setFokus(idPola(p, p.partie[0].key, 'nr'))
  }

  const zamknij = () => {
    if (koszyk.length && !saving && !window.confirm('Zamknąć bez zapisu? Wpisane pozycje i partie przepadną.')) return
    onClose()
  }

  const zapisz = async () => {
    if (lock.current) return
    setTried(true)
    if (Object.keys(bledyKoszyka(koszyk, data)).length) return
    lock.current = true; setSaving(true); setBlad(null)
    try {
      await finishedGoodsApi.createBulk(payloadKoszyka(koszyk, data, nrWsadow))
      await refresh()
      app.toast({ kind: 'ok', title: 'Dodano wyrób gotowy', detail: `${fmtNum(sumy.sztuki)} szt. · ${kg(sumy.kg)} · ${sumy.partie} ${sumy.partie === 1 ? 'partia' : sumy.partie < 5 ? 'partie' : 'partii'} · produkcja ${fmtDate(new Date(data))}` })
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać wyrobu'
      // Bez odpowiedzi serwera (zerwane połączenie, limit czasu) nie wiadomo, czy transakcja przeszła —
      // obietnica „nic nie dodano” skończyłaby się podwójnym stanem po ponownym zapisie.
      setBlad(errStatus(e) > 0 ? `serwer:${msg}` : `siec:${msg}`)
    } finally { lock.current = false; setSaving(false) }
  }

  const klawisze = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void zapisz() }
  }

  const szukam = q.trim().length > 0

  return (
    <Dialog xl title="Dodaj wyrób gotowy" icon={<PackagePlus size={20} />} onClose={zamknij}
      footer={<>
        <span className="left">{koszyk.length
          ? <>Do zapisu: <b>{sumy.partie} {sumy.partie === 1 ? 'partia' : sumy.partie < 5 ? 'partie' : 'partii'}</b> · <b>{fmtNum(sumy.sztuki)} szt.</b> · <b>{kg(sumy.kg)}</b></>
          : 'Nic jeszcze nie wybrano'}<span className="hint hide-m"> <span className="kbd">Ctrl+Enter</span> zapisz</span></span>
        <button className="btn" onClick={zamknij}>Anuluj</button>
        <button className="btn primary" disabled={saving} onClick={() => void zapisz()}><PackagePlus size={15} />{saving ? 'Zapisywanie…' : 'Zapisz wyrób'}</button>
      </>}>
      <div className="dw" onKeyDown={klawisze}>
        <div className="dw-top">
          <label className="dw-data"><span className="label">Data produkcji</span>
            <input type="date" className={`field${bledy.data ? ' invalid' : ''}`} value={data} max={dzisiaj()} onChange={e => setData(e.target.value)} aria-label="Data produkcji" />
          </label>
          <span className="sub">Z daty powstaje numer partii na wyrobie, np. partia <b>111</b> z {fmtDate(new Date(data || dzisiaj()))} → <b className="mono">{rozpoznajPartie('111', data, []).naWyrobie}</b>.</span>
          {bledy.data && <span className="crit-ink dw-err">{bledy.data}</span>}
        </div>
        {blad && (blad.startsWith('serwer:')
          ? <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie zapisano — serwer odmówił:</b> {blad.slice(7)}. Nic nie zostało dodane, popraw i zapisz ponownie.</div></div>
          : <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Połączenie przerwane — nie wiadomo, czy zapisano.</b> Zamknij okno i sprawdź listę wyrobu, zanim zapiszesz ponownie ({blad.slice(5)}).</div></div>)}
        {wsadyRes.error && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Nie udało się pobrać wsadów z masowni — numery partii trafią na wyrób bez zdejmowania mięsa.</div></div>}

        <div className="dw-grid">
          {/* ── Lewa: zamówienia ── */}
          <section className="dw-tree" aria-label="Zamówienia">
            <div className="dw-search">
              <Search size={15} aria-hidden />
              <input id="dw-szukaj" className="field" placeholder="Klient, zamówienie, receptura…" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj w zamówieniach" data-autofocus autoFocus />
              {q && <button className="btn ghost icon sm" aria-label="Wyczyść szukanie" onClick={() => setQ('')}><X size={14} /></button>}
            </div>
            <div className="dw-tree-list">
              {!drzewo.length && <div className="dw-empty">{szukam ? 'Nic nie pasuje do szukania.' : 'Brak otwartych zamówień — dodaj wyrób ręcznie.'}</div>}
              {drzewo.map(k => {
                const otwarty = szukam || rozwinieci.has(k.clientId)
                const wybranych = k.zamowienia.reduce((a, z) => a + z.lines.filter(l => wKoszyku.has(l.id)).length, 0)
                return (
                  <div key={k.clientId} className="dw-klient">
                    <button className="dw-k-h" aria-expanded={otwarty} onClick={() => przelaczKlienta(k.clientId)}>
                      {otwarty ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <b>{k.clientName}</b>
                      <span className="dw-meta">{k.zamowienia.length} {k.zamowienia.length === 1 ? 'zam.' : 'zam.'}</span>
                      {wybranych > 0 && <span className="dw-badge">{wybranych} wybr.</span>}
                      <span className="dw-left">zostało {kg(k.kgLeft)}</span>
                    </button>
                    {otwarty && k.zamowienia.map(z => {
                      const zOtw = szukam || !zwinieteZam.has(z.orderId)
                      return (
                        <div key={z.orderId} className="dw-zam">
                          <button className="dw-z-h" aria-expanded={zOtw} onClick={() => przelaczZam(z.orderId)}>
                            {zOtw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span className="mono">{z.orderNo}</span>
                            {z.delivery && <span className="dw-meta">dostawa {fmtDate(z.delivery)}</span>}
                            <span className="dw-left">zostało {kg(z.kgLeft)}</span>
                          </button>
                          {zOtw && z.lines.map(l => {
                            const brak = lineMissing(l)
                            const on = wKoszyku.has(l.id)
                            return (
                              <label key={l.id} className={`dw-linia${on ? ' on' : ''}${brak ? '' : ' done'}`}>
                                <input type="checkbox" className="cbx" checked={on} onChange={() => przelaczLinie(z.orderId, l.id)}
                                  aria-label={`${l.recipe} · ${l.product} · ${kgTxt(l.kgPerUnit)} kg${l.packaging ? ` · ${l.packaging}` : ''}`} />
                                <span className="dw-l-txt"><b>{l.recipe}</b> <b className="dw-l-kg">{kgTxt(l.kgPerUnit)} kg</b> <span className="dw-meta">{l.product}{l.packaging ? ` · ${l.packaging}` : ''}</span></span>
                                <span className={`dw-l-brak${brak ? '' : ' ok'}`}>{brak ? `brakuje ${fmtNum(brak)} szt.` : 'pokryte'}</span>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <button className={`dw-reczny-btn${reczny ? ' on' : ''}`} aria-pressed={reczny} onClick={() => setReczny(r => !r)}>
              <PenLine size={15} />Ręcznie — wyrób bez zamówienia
            </button>
          </section>

          {/* ── Prawa: do zapisu ── */}
          <section className="dw-koszyk" aria-label="Do zapisu">
            {reczny && (
              <fieldset className="dw-forma" aria-label="Wyrób bez zamówienia">
                <legend>Wyrób bez zamówienia</legend>
                <div className="dw-forma-grid">
                  <label><span className="label">Rodzaj</span>
                    <Wybor id="dw-r-typ" label="Rodzaj" items={rodzaje} value={forma.productTypeId} invalid={!!bledyFormy.productTypeId} disabled={!kartotekiGotowe} placeholder="Rodzaj…" autoFocus
                      onChange={v => setForma(f => { const r = kartoteki.recipes.find(x => x.id === f.recipeId); return { ...f, productTypeId: v, recipeId: r && (!r.productTypeId || r.productTypeId === v) ? f.recipeId : '' } })}
                      onDalej={() => skocz('dw-r-rec')} />
                    {bledyFormy.productTypeId && <span className="crit-ink dw-err">{bledyFormy.productTypeId}</span>}</label>
                  <label><span className="label">Receptura</span>
                    <Wybor id="dw-r-rec" label="Receptura" items={receptury} value={forma.recipeId} invalid={!!bledyFormy.recipeId} disabled={!kartotekiGotowe} placeholder="Receptura…"
                      pusto={forma.productTypeId ? 'Brak receptur dla tego rodzaju' : 'Najpierw wybierz rodzaj'} onChange={v => setForma(f => ({ ...f, recipeId: v }))} onDalej={() => skocz('dw-r-kg')} />
                    {bledyFormy.recipeId && <span className="crit-ink dw-err">{bledyFormy.recipeId}</span>}</label>
                  <label><span className="label">Waga sztuki</span>
                    <span className="dw-unit"><input id="dw-r-kg" className={`field num${bledyFormy.kgPerUnit ? ' invalid' : ''}`} inputMode="decimal" placeholder="0" value={forma.kgPerUnit} aria-label="Waga sztuki kg"
                      onChange={e => setForma(f => ({ ...f, kgPerUnit: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); skocz('dw-r-tul') } }} /><span className="sub">kg</span></span>
                    {bledyFormy.kgPerUnit && <span className="crit-ink dw-err">{bledyFormy.kgPerUnit}</span>}</label>
                  <label><span className="label">Tuleja</span>
                    <Wybor id="dw-r-tul" label="Tuleja" items={tuleje} value={forma.packagingId} noneLabel="(bez tulei)" disabled={!kartotekiGotowe} onChange={v => setForma(f => ({ ...f, packagingId: v }))} onDalej={() => skocz('dw-r-kli')} /></label>
                  <label><span className="label">Klient</span>
                    <Wybor id="dw-r-kli" label="Klient" items={klienci} value={forma.clientId} noneLabel="Na magazyn — bez klienta" disabled={!kartotekiGotowe} onChange={v => setForma(f => ({ ...f, clientId: v }))} onDalej={() => skocz('dw-r-qty')} /></label>
                  <label><span className="label">Sztuk</span>
                    <span className="dw-unit"><input id="dw-r-qty" className={`field num${bledyFormy.qty ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={forma.qty} aria-label="Sztuk"
                      onChange={e => setForma(f => ({ ...f, qty: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); dodajReczna() } }} /><span className="sub">szt.</span></span>
                    {bledyFormy.qty && <span className="crit-ink dw-err">{bledyFormy.qty}</span>}</label>
                </div>
                <div className="dw-forma-f">
                  <span className="sub">Wyrób bez zamówienia stanie na magazynie jako wolny — serwer przydzieli go sam do pasującego zamówienia.</span>
                  <button className="btn sm" onClick={dodajReczna}><Plus size={15} />Dodaj do zapisu</button>
                </div>
              </fieldset>
            )}

            {!koszyk.length && !reczny && <div className="dw-empty big">
              <PackagePlus size={28} aria-hidden />
              <b>Zaznacz pozycje po lewej</b>
              <span>albo dodaj wyrób ręcznie. Każdą pozycję możesz rozbić na kilka partii.</span>
            </div>}
            {bledy.koszyk && <div className="note crit"><FlagIcon level="crit" size={15} /><div>{bledy.koszyk}</div></div>}

            {koszyk.map(p => {
              const st = statusPozycji(p)
              const opis = p.zrodlo === 'zamowienie' ? `${p.orderNo} ${p.recipeName}` : `ręcznie ${p.recipeName}`
              const suma = sumaPartii(p)
              return (
                <div key={p.key} className="dw-poz">
                  <div className="dw-poz-h">
                    <div className="dw-poz-t">
                      <b>{p.clientLabel || 'Na magazyn'}</b>
                      <span className="dw-meta">{p.zrodlo === 'zamowienie' ? <span className="mono">{p.orderNo}</span> : 'bez zamówienia'}</span>
                      <span className="dw-poz-w">{p.recipeName} · {p.productTypeName} · {kgTxt(p.kgPerUnit)} kg{p.packagingName ? ` · ${p.packagingName}` : ''}</span>
                    </div>
                    <span className={`dw-razem ${st}`}>
                      razem <b>{fmtNum(suma)}</b> / {fmtNum(p.cel)} szt.{st === 'ok' ? ' ✓' : ''}
                      {p.zrodlo === 'zamowienie' && st === 'mniej' && <small> · {fmtNum(p.cel - suma)} zostanie do zrobienia</small>}
                      {p.zrodlo === 'zamowienie' && st === 'wiecej' && <small> · +{fmtNum(suma - p.cel)} ponad brak, też do tego zamówienia</small>}
                    </span>
                    <button className="btn ghost icon sm" aria-label={`Usuń z zapisu: ${opis}`} onClick={() => usunPozycje(p.key)}><Trash2 size={15} /></button>
                  </div>
                  <table className="dw-partie">
                    <colgroup><col className="c-nr" /><col className="c-qty" /><col /><col className="c-kg" /><col className="c-x" /></colgroup>
                    <thead><tr><th>Partia</th><th className="num">Sztuk</th><th>Na wyrobie</th><th className="num">Masa</th><th /></tr></thead>
                    <tbody>{p.partie.map((w, i) => {
                      const r = rozpoznajPartie(w.nr, data, nrWsadow, p.recipeId)
                      const eNr = bledy[`${p.key}:${w.key}:nr`], eQty = bledy[`${p.key}:${w.key}:qty`]
                      const ostatni = i === p.partie.length - 1
                      const q = Math.round(liczba(w.qty))
                      return [
                        <tr key={w.key}>
                          <td><input id={idPola(p, w.key, 'nr')} className={`field mono dw-nr${eNr ? ' invalid' : ''}`} list="dw-wsady" placeholder="np. 111" value={w.nr}
                            aria-label={`Partia ${i + 1}, ${opis}`} aria-invalid={!!eNr || undefined} autoComplete="off"
                            onChange={e => zmienPartie(p.key, w.key, { nr: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); skocz(idPola(p, w.key, 'qty')) } }} /></td>
                          <td className="num"><span className="dw-unit"><input id={idPola(p, w.key, 'qty')} className={`field num dw-qty${eQty ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={w.qty}
                            aria-label={`Sztuk ${i + 1}, ${opis}`} aria-invalid={!!eQty || undefined}
                            onFocus={e => e.target.select()}
                            onChange={e => zmienPartie(p.key, w.key, { qty: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); if (!ostatni) skocz(idPola(p, p.partie[i + 1].key, 'nr'))
                              else if (!pelnaPozycja(p)) nowaPartia(p.key)
                              else { const nast = koszyk[koszyk.findIndex(x => x.key === p.key) + 1]; setFokus(nast ? idPola(nast, nast.partie[0].key, 'nr') : 'dw-szukaj') } } }} /><span className="sub">szt.</span></span></td>
                          <td className="dw-podglad">
                            {w.nr.trim()
                              ? <><span className="mono">→ {r.naWyrobie}</span> <span className={`dw-tag${r.masownia ? ' ok' : r.innaReceptura ? ' warn' : ''}`}
                                title={r.kilka ? 'W masowni jest kilka wsadów tej receptury o tym numerze (różne dni)' : r.innaReceptura ? 'Wsad o tym numerze jest w masowni, ale z innej receptury — mięso nie zostanie zdjęte' : undefined}>
                                {r.masownia ? (r.kilka ? 'masownia ✓ · kilka dni' : 'masownia ✓') : r.innaReceptura ? 'inna receptura w masowni' : 'bez masowni'}</span></>
                              : <span className="faint">wpisz numer partii</span>}
                          </td>
                          <td className="num dw-kg">{q > 0 ? kg(q * p.kgPerUnit) : <span className="faint">—</span>}</td>
                          <td><button className="btn ghost icon sm" aria-label={`Usuń partię ${i + 1}, ${opis}`} onClick={() => usunPartie(p.key, w.key)}><X size={14} /></button></td>
                        </tr>,
                        (eNr || eQty) && <tr key={`${w.key}-e`} className="dw-err-row"><td colSpan={5}><span className="crit-ink dw-err">{[eNr, eQty].filter(Boolean).join(' · ')}</span></td></tr>,
                      ]
                    })}</tbody>
                  </table>
                  <button className="btn ghost sm dw-plus" onClick={() => nowaPartia(p.key)}><Plus size={14} />partia{p.cel - suma > 0 ? ` (zostało ${fmtNum(p.cel - suma)} szt.)` : ''}</button>
                </div>
              )
            })}
          </section>
        </div>
        <datalist id="dw-wsady">
          {wsady.map((w, i) => <option key={`${w.batchNo}-${w.recipeId ?? ''}-${i}`} value={w.batchNo}>{[w.recipeName, w.kgAvailable != null ? `${kgTxt(Math.round(w.kgAvailable))} kg w masowni` : ''].filter(Boolean).join(' · ')}</option>)}
        </datalist>
      </div>
    </Dialog>
  )
}
