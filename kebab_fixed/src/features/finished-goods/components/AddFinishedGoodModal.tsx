/**
 * „Dodaj wyrób gotowy" — wejście biura na czas, gdy produkcja i masownia nie
 * mają jeszcze komputerów (ok. miesiąc). Docelowo wyrób powstaje na hali.
 *
 * Dwie rzeczy decydują o tym, czy wpis się przyda:
 *
 *  • POWIĄZANIE — pokrycie zamówienia liczy się po trójce numer zamówienia +
 *    receptura + waga sztuki (`orders_service._hydrate_order`), więc te pola
 *    biorą się z POZYCJI zamówienia, nie z ręki. Tryb ręczny istnieje obok,
 *    bo nie wszystko jest zamówione i nie każda partia jest w masowni.
 *
 *  • TEMPO — biuro wpisuje cały dzień produkcji naraz, więc pozycje wybiera
 *    się wielokrotnie, grupami po kliencie, jednym kliknięciem na grupę.
 *    Wszystko leci JEDNYM żądaniem: błąd na trzeciej pozycji ma cofnąć
 *    całość, a nie zostawić połowę dnia.
 *
 * Wygląd wg systemu biura („tusz na papierze"): monochrom, hairline, gęsta
 * siatka jak w Subiekcie, dane monospace, znaczniki dokumentowe zamiast
 * pigułek. Kolor TYLKO semantyczny (ostrzeżenie o stanie, błąd).
 */
import { useEffect, useMemo, useState } from 'react'
import { clientOrdersApi, clientsApi, finishedGoodsApi, packagingApi, recipesApi, seasonedMeatApi } from '@/lib/api'
import { fmtKg } from '@/lib/utils'
import {
  batchNoPreview, cartTotals, groupLinesByClient, liczba, normalizeManualBatchNo,
  remainingOnLine, type ClientGroup, type PickableLine,
} from '../manualGoods'

const dzisiaj = () => new Date().toISOString().slice(0, 10)

/** Na ekranie nazwa HANDLOWA („ZAGROS"), bo tak biuro mówi o kliencie.
 *  Na backend leci nazwa z kartoteki („OKAYTEKIN KG") — po niej wiążą się
 *  zamówienia i dokumenty. */
const nazwaKlienta = (k: any): string =>
  String(k?.displayName || k?.display_name || k?.name || '')

/** Pozycja wpisana z ręki — bez zamówienia albo z klientem spoza listy. */
interface RecznaPozycja {
  qty: number
  kgPerUnit: number
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  clientId: string
  clientName: string
  /** Nazwa pokazywana operatorowi (handlowa); na backend idzie `clientName`. */
  clientLabel: string
}

const PUSTA_RECZNA = {
  qty: '', kgPerUnit: '', recipeId: '', packagingId: '', clientId: '',
}

export function AddFinishedGoodModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tryb, setTryb] = useState<'zamowienia' | 'recznie'>('zamowienia')
  const [zamowienia, setZamowienia] = useState<any[]>([])
  const [partie, setPartie] = useState<any[]>([])
  const [tuleje, setTuleje] = useState<any[]>([])
  const [receptury, setReceptury] = useState<any[]>([])
  const [klienci, setKlienci] = useState<any[]>([])

  const [wybrane, setWybrane] = useState<Record<string, number>>({})   // lineId → sztuki
  const [reczne, setReczne] = useState<RecznaPozycja[]>([])
  const [formaReczna, setFormaReczna] = useState({ ...PUSTA_RECZNA })

  const [zrodloPartii, setZrodloPartii] = useState<'masownia' | 'recznie'>('masownia')
  const [partieWybrane, setPartieWybrane] = useState<string[]>([])
  const [partiaReczna, setPartiaReczna] = useState('')
  const [data, setData] = useState(dzisiaj())

  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState('')
  const [pokazBledy, setPokazBledy] = useState(false)

  useEffect(() => {
    clientOrdersApi.list().then(r => setZamowienia(Array.isArray(r) ? r : [])).catch(() => setZamowienia([]))
    seasonedMeatApi.list().then(r => setPartie(Array.isArray(r) ? r : [])).catch(() => setPartie([]))
    packagingApi.all().then(r => setTuleje((Array.isArray(r) ? r : [])
      .filter((p: any) => String(p.type || '').toLowerCase() === 'tuleja'))).catch(() => setTuleje([]))
    recipesApi.list().then(r => setReceptury(Array.isArray(r) ? r : [])).catch(() => setReceptury([]))
    clientsApi.list().then((r: any) => setKlienci(Array.isArray(r) ? r : [])).catch(() => setKlienci([]))
  }, [])

  const grupy: ClientGroup[] = useMemo(() => groupLinesByClient(zamowienia), [zamowienia])
  const wszystkieLinie = useMemo(() => grupy.flatMap(g => g.lines), [grupy])
  const poId = useMemo(
    () => new Map(wszystkieLinie.map(l => [l.id, l])), [wszystkieLinie])

  const domyslnaIlosc = (l: PickableLine) => remainingOnLine(l) || l.qty || 0

  const przelacz = (l: PickableLine) => setWybrane(w => {
    if (w[l.id] != null) { const { [l.id]: _, ...reszta } = w; return reszta }
    return { ...w, [l.id]: domyslnaIlosc(l) }
  })

  const przelaczGrupe = (g: ClientGroup) => setWybrane(w => {
    const wszystkieZaznaczone = g.lines.every(l => w[l.id] != null)
    const next = { ...w }
    for (const l of g.lines) {
      if (wszystkieZaznaczone) delete next[l.id]
      else next[l.id] = next[l.id] ?? domyslnaIlosc(l)
    }
    return next
  })

  const przelaczWszystko = () => setWybrane(w => {
    const wszystkie = wszystkieLinie.every(l => w[l.id] != null)
    if (wszystkie) return {}
    return Object.fromEntries(wszystkieLinie.map(l => [l.id, w[l.id] ?? domyslnaIlosc(l)]))
  })

  const przelaczPartie = (batchNo: string) => setPartieWybrane(p =>
    p.includes(batchNo) ? p.filter(b => b !== batchNo) : [...p, batchNo])

  // ── Koszyk: pozycje z zamówień + wpisane z ręki ──
  const koszyk = useMemo(() => {
    const zZamowien = Object.entries(wybrane).flatMap(([lineId, qty]) => {
      const l = poId.get(lineId)
      if (!l) return []
      const grupa = grupy.find(g => g.lines.some(x => x.id === lineId))
      return [{
        qty: Math.round(liczba(String(qty))), kgPerUnit: l.kgPerUnit,
        recipeId: l.recipeId, recipeName: l.recipeName,
        productTypeId: l.productTypeId, productTypeName: l.productTypeName,
        packagingId: l.packagingId, packagingName: l.packagingName,
        clientId: grupa?.clientId ?? '', clientName: grupa?.clientName ?? '',
        // Zamówienie trzyma już nazwę, którą biuro zna z ekranu zamówień.
        clientLabel: grupa?.clientName ?? '',
        clientOrderNo: l.orderNo, zrodlo: `${l.orderNo} · ${l.recipeName}`,
      }]
    })
    const zReki = reczne.map(r => ({
      ...r, clientOrderNo: '', zrodlo: `${r.recipeName} · ręcznie`,
    }))
    return [...zZamowien, ...zReki]
  }, [wybrane, poId, grupy, reczne])

  const sumy = useMemo(() => cartTotals(koszyk), [koszyk])
  // Co DOKŁADNIE stanie na wyrobie. Bez tego biuro nie wie, czy wpisać sam
  // numer porządkowy („456"), czy pełny z datą — a numer ręczny leci na
  // wyrób bez zmian.
  const podgladPartii = useMemo(
    () => batchNoPreview({ mode: zrodloPartii, batchNos: partieWybrane, manual: partiaReczna, producedDate: data }),
    [zrodloPartii, partieWybrane, partiaReczna, data],
  )
  const tulejeSzt = koszyk.filter(p => p.packagingId).reduce((s, p) => s + p.qty, 0)

  const bledy: string[] = []
  if (!koszyk.length) bledy.push('Wybierz pozycje z zamówień albo wpisz wyrób ręcznie')
  if (koszyk.some(p => p.qty <= 0)) bledy.push('Któraś pozycja ma zero sztuk')
  if (!data) bledy.push('Podaj datę produkcji')
  if (zrodloPartii === 'recznie' && !partiaReczna.trim()) bledy.push('Wpisz numer partii')
  if (zrodloPartii === 'masownia' && !partieWybrane.length) bledy.push('Wskaż partię z masowni albo przełącz na numer ręczny')

  const dodajReczna = () => {
    const r = receptury.find((x: any) => x.id === formaReczna.recipeId)
    const t = tuleje.find((x: any) => x.id === formaReczna.packagingId)
    const k = klienci.find((x: any) => x.id === formaReczna.clientId)
    const qty = Math.round(liczba(formaReczna.qty))
    const kgPerUnit = liczba(formaReczna.kgPerUnit)
    if (!r || qty <= 0 || kgPerUnit <= 0) { setPokazBledy(true); return }
    setReczne(list => [...list, {
      qty, kgPerUnit,
      recipeId: r.id, recipeName: r.name,
      productTypeId: '', productTypeName: '',
      packagingId: t?.id ?? '', packagingName: t?.name ?? '',
      clientId: k?.id ?? '', clientName: k?.name ?? '', clientLabel: nazwaKlienta(k),
    }])
    setFormaReczna({ ...PUSTA_RECZNA })
  }

  const zapisz = async () => {
    setPokazBledy(true)
    if (bledy.length) return
    setZajety(true); setBlad('')
    try {
      await finishedGoodsApi.createBulk(koszyk.map(p => ({
        qty: p.qty, kgPerUnit: p.kgPerUnit, producedDate: data,
        recipeId: p.recipeId, recipeName: p.recipeName,
        productTypeId: p.productTypeId, productTypeName: p.productTypeName,
        packagingId: p.packagingId, packagingName: p.packagingName,
        clientId: p.clientId, clientName: p.clientName, clientOrderNo: p.clientOrderNo,
        batchNo: zrodloPartii === 'recznie' ? normalizeManualBatchNo(partiaReczna, data) : '',
        seasonedBatchNos: zrodloPartii === 'masownia' ? partieWybrane : [],
        consumeSeasoned: zrodloPartii === 'masownia' && partieWybrane.length > 0,
      })))
      onSaved()
      onClose()
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się zapisać wyrobu')
    } finally {
      setZajety(false)
    }
  }

  // ── Klocki wizualne (system biura: hairline, monochrom, znacznik) ──
  const znacznik = 'inline-block rounded-[3px] border border-ink-5 px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.05em]'
  const etykieta = 'text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-3'
  const input = 'h-8 w-full rounded-[3px] border border-surface-4 bg-white px-2 text-sm outline-none focus:border-ink'
  const zakladka = (aktywna: boolean) =>
    `rounded-[3px] border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.05em] ${
      aktywna ? 'border-ink bg-ink text-white' : 'border-surface-4 bg-white text-ink-3 hover:border-ink-4'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6">
      <div className="flex h-[86vh] w-[1180px] max-w-full flex-col rounded border border-surface-4 bg-white shadow-lg">

        {/* Nagłówek */}
        <div className="flex items-baseline gap-4 border-b border-surface-3 px-5 py-3">
          <h2 className="font-display text-lg font-bold tracking-tight">Dodaj wyrób gotowy</h2>
          <span className="text-xs text-ink-3">
            wejście biura, dopóki produkcja i masownia nie mają panelu
          </span>
          <label className="ml-auto flex items-center gap-2">
            <span className={etykieta}>Data produkcji</span>
            <input data-testid="pole-data" type="date" value={data}
              onChange={e => setData(e.target.value)}
              className="h-8 rounded-[3px] border border-surface-4 px-2 font-mono text-sm" />
          </label>
          <button type="button" onClick={onClose} aria-label="Zamknij"
            className="text-lg leading-none text-ink-3 hover:text-ink">✕</button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── Lewa kolumna: skąd bierzemy pozycje ── */}
          <div className="flex min-h-0 flex-[3] flex-col border-r border-surface-3">
            <div className="flex items-center gap-2 border-b border-surface-3 px-5 py-2.5">
              <button type="button" data-testid="tryb-zamowienia" className={zakladka(tryb === 'zamowienia')}
                onClick={() => setTryb('zamowienia')}>Z zamówień</button>
              <button type="button" data-testid="tryb-recznie" className={zakladka(tryb === 'recznie')}
                onClick={() => setTryb('recznie')}>Ręcznie</button>
              {tryb === 'zamowienia' && wszystkieLinie.length > 0 && (
                <button type="button" data-testid="zaznacz-wszystko" onClick={przelaczWszystko}
                  className="ml-auto text-xs font-semibold text-ink underline underline-offset-2">
                  {wszystkieLinie.every(l => wybrane[l.id] != null) ? 'Odznacz wszystko' : 'Zaznacz wszystko'}
                </button>
              )}
            </div>

            {tryb === 'zamowienia' ? (
              <div className="min-h-0 flex-1 overflow-auto">
                {grupy.map(g => {
                  const zaznaczonych = g.lines.filter(l => wybrane[l.id] != null).length
                  return (
                    <div key={g.clientId} data-testid={`grupa-${g.clientId}`}>
                      {/* Nagłówek klienta — sticky, żeby przy przewijaniu było
                          wiadomo, czyje pozycje się właśnie zaznacza. */}
                      <div className="sticky top-0 z-10 flex items-center gap-3 border-y border-surface-3 bg-surface-3 px-5 py-1.5">
                        <button type="button" data-testid={`grupa-zaznacz-${g.clientId}`}
                          onClick={() => przelaczGrupe(g)}
                          className="flex items-center gap-2 text-left">
                          <span className={`flex h-4 w-4 items-center justify-center rounded-[3px] border text-[10px] ${
                            zaznaczonych === g.lines.length ? 'border-ink bg-ink text-white'
                              : zaznaczonych > 0 ? 'border-ink text-ink' : 'border-surface-4'}`}>
                            {zaznaczonych === g.lines.length ? '✓' : zaznaczonych > 0 ? '–' : ''}
                          </span>
                          <span className="text-sm font-bold">{g.clientName}</span>
                        </button>
                        <span className={znacznik}>{g.lines.length} poz.</span>
                        <span className="ml-auto font-mono text-xs text-ink-3">
                          zostało {fmtKg(g.kgLeft, 0)} kg
                        </span>
                      </div>

                      <table className="w-full">
                        <tbody>
                          {g.lines.map(l => {
                            const wybrana = wybrane[l.id] != null
                            const brakuje = remainingOnLine(l)
                            return (
                              <tr key={l.id} data-testid={`pozycja-${l.id}`} onClick={() => przelacz(l)}
                                className={`cursor-pointer border-b border-surface-3 ${wybrana ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
                                <td className="w-8 py-1.5 pl-5">
                                  <span className={`flex h-4 w-4 items-center justify-center rounded-[3px] border text-[10px] ${
                                    wybrana ? 'border-ink bg-ink text-white' : 'border-surface-4'}`}>
                                    {wybrana ? '✓' : ''}
                                  </span>
                                </td>
                                <td className="py-1.5 font-mono text-xs text-ink-3">{l.orderNo}</td>
                                <td className="py-1.5 text-sm font-semibold">{l.recipeName}</td>
                                <td className="py-1.5 font-mono text-sm tabular-nums">{fmtKg(l.kgPerUnit)} kg</td>
                                <td className="py-1.5 text-xs text-ink-3">{l.packagingName || '—'}</td>
                                <td className="py-1.5 text-right font-mono text-xs tabular-nums text-ink-3">
                                  {brakuje} z {l.qty} szt.
                                </td>
                                <td className="w-24 py-1.5 pr-5 pl-3 text-right" onClick={e => e.stopPropagation()}>
                                  {wybrana && (
                                    <input data-testid={`ilosc-${l.id}`} value={String(wybrane[l.id])}
                                      inputMode="numeric"
                                      onChange={e => setWybrane(w => ({ ...w, [l.id]: Math.round(liczba(e.target.value)) }))}
                                      className="h-7 w-20 rounded-[3px] border border-ink-4 px-2 text-right font-mono text-sm tabular-nums" />
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
                {grupy.length === 0 && (
                  <div className="px-5 py-10 text-center text-sm text-ink-3">
                    Brak otwartych zamówień — wpisz wyrób ręcznie.
                  </div>
                )}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                <div className="grid grid-cols-6 gap-3">
                  <label className="col-span-3 flex flex-col gap-1">
                    <span className={etykieta}>Receptura</span>
                    <select data-testid="reczne-receptura" className={input} value={formaReczna.recipeId}
                      onChange={e => setFormaReczna(f => ({ ...f, recipeId: e.target.value }))}>
                      <option value="">— wybierz —</option>
                      {receptury.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={etykieta}>Sztuk</span>
                    <input data-testid="reczne-sztuki" inputMode="numeric" className={`${input} text-right font-mono tabular-nums`}
                      value={formaReczna.qty} onChange={e => setFormaReczna(f => ({ ...f, qty: e.target.value }))} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={etykieta}>Waga sztuki</span>
                    <input data-testid="reczne-waga" inputMode="decimal" className={`${input} text-right font-mono tabular-nums`}
                      value={formaReczna.kgPerUnit} onChange={e => setFormaReczna(f => ({ ...f, kgPerUnit: e.target.value }))} />
                  </label>
                  <div className="flex items-end pb-1 font-mono text-sm tabular-nums text-ink-3">
                    = {Math.round(liczba(formaReczna.qty) * liczba(formaReczna.kgPerUnit) * 100) / 100} kg
                  </div>
                  <label className="col-span-3 flex flex-col gap-1">
                    <span className={etykieta}>Tuleja</span>
                    <select data-testid="reczne-tuleja" className={input} value={formaReczna.packagingId}
                      onChange={e => setFormaReczna(f => ({ ...f, packagingId: e.target.value }))}>
                      <option value="">— bez tulei —</option>
                      {tuleje.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.name} ({Math.floor(Number(p.kgAvailable) || 0)} szt.)</option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-3 flex flex-col gap-1">
                    <span className={etykieta}>Klient</span>
                    <select data-testid="reczne-klient" className={input} value={formaReczna.clientId}
                      onChange={e => setFormaReczna(f => ({ ...f, clientId: e.target.value }))}>
                      <option value="">— na magazyn —</option>
                      {klienci.map((k: any) => (
                        <option key={k.id} value={k.id}>{nazwaKlienta(k)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" data-testid="dodaj-do-koszyka" onClick={dodajReczna}
                  className="mt-4 rounded-[3px] border border-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.05em] hover:bg-surface-3">
                  Dołóż pozycję
                </button>
                <p className="mt-3 text-xs text-ink-3">
                  Pozycja bez klienta wchodzi „na magazyn" — i tak pokryje zamówienie przy wystawianiu WZ.
                </p>
              </div>
            )}
          </div>

          {/* ── Prawa kolumna: partia + koszyk ── */}
          <div className="flex min-h-0 flex-[2] flex-col">
            <div className="border-b border-surface-3 px-5 py-3">
              <div className="flex items-center gap-2">
                <span className={etykieta}>Numer partii</span>
                <div className="ml-auto flex gap-1">
                  <button type="button" data-testid="partia-tryb-masownia" onClick={() => setZrodloPartii('masownia')}
                    className={zakladka(zrodloPartii === 'masownia')}>Z masowni</button>
                  <button type="button" data-testid="partia-tryb-recznie" onClick={() => setZrodloPartii('recznie')}
                    className={zakladka(zrodloPartii === 'recznie')}>Ręcznie</button>
                </div>
              </div>

              {zrodloPartii === 'masownia' ? (
                <>
                  <div className="mt-2.5 flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                    {partie.map((p: any) => (
                      <button key={p.id} type="button" data-testid={`partia-${p.batchNo}`}
                        onClick={() => przelaczPartie(p.batchNo)}
                        className={`rounded-[3px] border px-2 py-1 text-left ${
                          partieWybrane.includes(p.batchNo) ? 'border-ink bg-ink text-white' : 'border-surface-4 hover:border-ink-4'}`}>
                        <span className="font-mono text-sm font-bold">{p.batchNo}</span>
                        <span className="ml-1.5 text-[11px] opacity-70">{p.recipeName} · {fmtKg(p.kgAvailable, 0)} kg</span>
                      </button>
                    ))}
                    {partie.length === 0 && (
                      <span className="text-xs text-ink-3">Masownia nie ma wolnych partii — wpisz numer ręcznie.</span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-3">
                    Mięso zejdzie ze stanu masowni, a numer partii wyrobu powstanie z daty i wsadu.
                  </p>
                </>
              ) : (
                <>
                  <input data-testid="partia-reczna" value={partiaReczna} placeholder="np. 250826 344"
                    onChange={e => setPartiaReczna(e.target.value)}
                    className="mt-2.5 h-9 w-full rounded-[3px] border border-surface-4 px-2 font-mono text-base" />
                  <p className="mt-2 text-[11px] text-ink-3">
                    Wpisz sam numer porządkowy („456") — datę produkcji dokleimy z pola wyżej.
                    Masownia zostaje nietknięta: to droga dla wpisów, których nie ma w systemie.
                  </p>
                </>
              )}
            </div>

            {/* Numer, który faktycznie stanie na wyrobie i dokumentach. */}
            <div className="flex items-baseline gap-2 border-b border-surface-3 bg-surface-2 px-5 py-2">
              <span className={etykieta}>Na wyrobie stanie</span>
              <b data-testid="partia-podglad" className="ml-auto font-mono text-sm font-bold">
                {podgladPartii}
              </b>
            </div>

            {/* Koszyk */}
            <div data-testid="koszyk" className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-baseline gap-2 px-5 py-2">
                <span className={etykieta}>Do zapisania</span>
                <span className="ml-auto font-mono text-sm font-bold tabular-nums">
                  {sumy.pozycje === 0 ? 'nic nie wybrano'
                    : `${sumy.pozycje} ${sumy.pozycje === 1 ? 'pozycja' : 'pozycje'} · ${sumy.sztuki} szt. · ${fmtKg(sumy.kg)} kg`}
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto border-t border-surface-3">
                {koszyk.map((p, i) => (
                  <div key={`${p.clientOrderNo}-${p.recipeId}-${i}`}
                    className="flex items-baseline gap-2 border-b border-surface-3 px-5 py-1.5 text-sm">
                    <span className="font-mono text-xs tabular-nums text-ink-3">{p.qty}×</span>
                    <span className="font-mono text-xs tabular-nums">{fmtKg(p.kgPerUnit)} kg</span>
                    <span className="truncate font-semibold">{p.recipeName}</span>
                    <span className="truncate text-xs text-ink-3">
                      {(p as any).clientLabel || p.clientName || 'na magazyn'}
                    </span>
                    <span className="ml-auto font-mono text-xs tabular-nums">{fmtKg(p.qty * p.kgPerUnit)} kg</span>
                    {!p.clientOrderNo && (
                      <button type="button" data-testid={`usun-reczna-${i - Object.keys(wybrane).length}`}
                        onClick={() => setReczne(list => list.filter((_, k) => k !== i - Object.keys(wybrane).length))}
                        className="text-ink-3 hover:text-danger" aria-label="Usuń">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <div data-testid="skutki" className="border-t border-surface-3 px-5 py-2 text-[11px] text-ink-3">
                Ze stanu zejdzie: {tulejeSzt > 0 ? `${tulejeSzt} szt. tulei` : 'brak tulei'}
                {zrodloPartii === 'masownia' && partieWybrane.length
                  ? ` · ${fmtKg(sumy.kg)} kg mięsa (${partieWybrane.join(', ')})`
                  : ' · mięso bez zmian'}
              </div>
            </div>
          </div>
        </div>

        {/* Stopka */}
        <div className="flex items-center gap-3 border-t border-surface-3 px-5 py-3">
          {pokazBledy && bledy.length > 0 && (
            <span className="text-sm font-semibold text-danger">{bledy[0]}</span>
          )}
          {blad && <span className="text-sm font-semibold text-danger">{blad}</span>}
          <button type="button" onClick={onClose}
            className="ml-auto rounded-[3px] border border-surface-4 px-4 py-2 text-xs font-semibold uppercase tracking-[0.05em]">
            Anuluj
          </button>
          <button type="button" data-testid="zapisz-wyrob" onClick={zapisz} disabled={zajety}
            className="rounded-[3px] bg-ink px-5 py-2 text-xs font-semibold uppercase tracking-[0.05em] text-white disabled:opacity-40">
            {zajety ? 'Zapisuję…' : `Dodaj ${sumy.pozycje || ''} ${sumy.pozycje ? (sumy.pozycje === 1 ? 'pozycję' : 'pozycje') : 'wyrób'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
