/**
 * SplitDialog — okno podziału wysyłki na fakturę i WZ (Task 8).
 *
 * Biuro wpisuje, ile kilogramów z zamówienia idzie na fakturę (wystawianą
 * w Subiekcie, POZA tym systemem) — reszta jedzie na WZ. Całą matematykę
 * (który wyrób, ile sztuk, żeby trafić jak najbliżej celu) liczy WYŁĄCZNIE
 * backend (`order_split_service.podziel_pozycje`) — to okno niczego nie
 * przelicza samo, tylko pyta API i pokazuje dokładnie to, co przyszło.
 * Ręczna korekta pojedynczej linii NIE woła podglądu na nowo (backend nie
 * ma takiej trasy) — czeka jako `per_line` na „Zapisz podział".
 *
 * `trafiono === false` (cel nie da się trafić całymi sztukami) to NIE jest
 * szczegół zaokrąglenia — biuro ma to widzieć wprost, tuż obok odchyłki,
 * bez szukania (decyzja właściciela, Task 8).
 *
 * Backend odmawia w DWIE STRONY, żeby dwa dokumenty jednej wysyłki nigdy
 * się nie rozjechały:
 *   - po wystawieniu kompletu dokumentów zapis/kasowanie podziału jest
 *     zablokowane („najpierw anuluj dokumenty podziału") — to okno NIE
 *     zostawia biura w ślepym zaułku: przy takiej odmowie od razu proponuje
 *     anulowanie kompletu, tu na miejscu, z jasno napisaną konsekwencją
 *     (towar wraca na stan, numery WM/WZ/HDI/CMR przepadają);
 *   - gdy zamówienie dostało nową pozycję bez zapisanego podziału,
 *     wystawienie kompletu odmawia („najpierw zapisz podział") — wyjściem
 *     jest przycisk „Zapisz podział" stojący w TYM SAMYM oknie, więc nie
 *     trzeba niczego dodatkowo proponować, wystarczy pokazać komunikat.
 *
 * REGUŁA „Wystaw komplet dokumentów": wolno go kliknąć TYLKO wtedy, gdy to,
 * co widać na ekranie, jest tym, co jest ZAPISANE W BAZIE. Powód jest w
 * `orderSplitApi.documents`: ta trasa wysyła samo `{hdi_fv}` — ani celu, ani
 * `per_line` — więc komplet ZAWSZE powstaje z podziału leżącego w bazie,
 * niezależnie od tego, co pokazuje okno. Wpisanie nowej liczby w „Na fakturę
 * [kg]" robi NOWY, niezapisany podgląd bez dotykania `overrides`, więc ani
 * obecność podglądu, ani brak ręcznej korekty nie są dowodem zgodności:
 * „zapisz 8000 → wpisz 9000 → wystaw" dawało komplet na 8000 przy ekranie
 * pokazującym 9000, a numery dokumentów są wypalone w chwili wystawienia.
 * `savedSplit` trzyma cel i sztuki na fakturę z OSTATNIEGO udanego zapisu
 * W TEJ SESJI (Task 7 nie ma trasy „pobierz obecny podział", więc to jedyna
 * pewna wiedza o bazie, jaką okno ma); `matchesSaved` porównuje to z bieżącym
 * ekranem i blokuje przycisk przy jakiejkolwiek rozbieżności — w tym wtedy,
 * gdy w tej sesji nie zapisano jeszcze niczego.
 */
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn, fmtKgTrim } from '@/lib/utils'
import { orderSplitApi, type SplitPreview, type SplitDocuments } from '@/lib/api'

export interface SplitDialogProps {
  orderId: string
  onClose: () => void
  /** Suma zamówienia w kg — do przycisku „50/50" i podpowiedzi w nagłówku.
   *  Task 7 nie ma trasy „pobierz obecny podział", więc to jedyna liczba,
   *  jaką ekran zna, zanim biuro cokolwiek wpisze. */
  kgCalosc?: number
  orderNo?: string
  clientName?: string
}

/** Odmowa „najpierw anuluj dokumenty podziału" — WSPÓLNY tekst dla
 *  `zapisz_podzial`/`wyczysc_podzial` (patrz `wz_service.KOMUNIKAT_ANULUJ_PODZIAL`).
 *  Status HTTP (400) jest ten sam dla każdej odmowy tej trasy, więc jedyny
 *  sposób odróżnienia dwóch odmów jest po treści komunikatu. */
const WYMAGA_ANULOWANIA = /anuluj dokument(y|ów) podzia/i

function odchylkaTekst(odchylka: number): string {
  const znak = odchylka > 0 ? '+' : ''
  return `${znak}${fmtKgTrim(odchylka)} kg`
}

/** Ręczna korekta pola „na FV" — puste pole to jawne ZERO (biuro wykasowało
 *  liczbę, żeby zdjąć tę pozycję z faktury), nie „zostaw jak było". Śmieciowy
 *  tekst (nie liczba) wraca `undefined` — wtedy pozycja NIE trafia do
 *  `per_line` i zostaje przy tym, co policzył backend (fix po review, runda 3). */
function parseOverride(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (raw.trim() === '') return 0
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? undefined : n
}

/** Migawka „ile sztuk na fakturę per pozycja" — do porównania z tym, co
 *  faktycznie leży w bazie (`SavedSplit`). Brakujący klucz w którejkolwiek
 *  stronie liczy się jako 0, nie jako „pomiń" — inaczej nowa/usunięta
 *  pozycja przechodziłaby porównanie po cichu. */
function perLineEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  }
  return true
}

interface SavedSplit { celKg: number; perLine: Record<string, number> }

export function SplitDialog({ orderId, onClose, kgCalosc, orderNo, clientName }: SplitDialogProps) {
  const [celKgInput, setCelKgInput] = useState('')
  const [preview, setPreview] = useState<SplitPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  // Ręczne korekty biura per pozycja — surowy tekst z pola, dopóki nie
  // trafią do zapisu. Klucz = id pozycji, wartość = to, co operator wpisał.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [hdiFv, setHdiFv] = useState(false)
  const [err, setErr] = useState('')
  const [needsCancel, setNeedsCancel] = useState(false)
  const [info, setInfo] = useState('')
  const [documents, setDocuments] = useState<SplitDocuments | null>(null)
  // Cel i sztuki na fakturę per pozycja z OSTATNIEGO udanego zapisu w tej
  // sesji — jedyne źródło prawdy o tym, co NAPRAWDĘ leży w bazie (Task 7 nie
  // ma trasy „pobierz obecny podział"). `null` = w tej sesji nie zapisano
  // jeszcze niczego, więc okno nie ma czym potwierdzić zgodności z bazą.
  const [savedSplit, setSavedSplit] = useState<SavedSplit | null>(null)
  // Biuro ma ręczną korektę linii, której jeszcze nie zapisało — wiersze
  // pokazują nowe liczby, ale sumy w stopce są wciąż SPRZED tej korekty
  // (przeliczyć je umie tylko backend, przy zapisie). Steruje WYŁĄCZNIE tym
  // ostrzeżeniem; bramki „Wystaw komplet" pilnuje `matchesSaved`, bo ta sama
  // rozbieżność powstaje też bez żadnej ręcznej korekty — samą zmianą celu.
  const hasPendingOverrides = Object.keys(overrides).length > 0
  // Czy to, co TERAZ na ekranie, jest dokładnie tym, co zapisane w bazie:
  // cel z górnego pola plus sztuki na fakturę z każdego wiersza (łącznie z
  // niezapisanymi ręcznymi korektami). Jedna bramka zamiast kilku, bo to
  // jedno pytanie — i pokrywa wszystkie drogi do rozjazdu: brak podglądu
  // (nie ma czego porównywać), brak zapisu w tej sesji (nie wiadomo, co
  // leży w bazie), zmieniony cel, poprawiona linia.
  const celKgTeraz = parseFloat(celKgInput.replace(',', '.'))
  const matchesSaved =
    preview !== null && savedSplit !== null && !Number.isNaN(celKgTeraz) &&
    celKgTeraz === savedSplit.celKg &&
    perLineEqual(
      Object.fromEntries(
        preview.lines.map(l => [l.id, parseOverride(overrides[l.id]) ?? l.qty_invoice])),
      savedSplit.perLine)
  // Licznik żądań podglądu: „8000" wpisane znak po znaku to kilka POST-ów,
  // które mogą wrócić NIE PO KOLEI. Bez tego spóźniona odpowiedź na stary
  // cel potrafiłaby nadpisać tabelę już PO tym, jak backend odpowiedział na
  // aktualny — operator zatwierdzałby podział, którego nigdy nie widział.
  const previewSeq = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function runPreview(celKg: number) {
    const seq = ++previewSeq.current
    setLoadingPreview(true)
    setDocuments(null); setInfo('')
    try {
      const r = await orderSplitApi.preview(orderId, celKg)
      if (seq !== previewSeq.current) return  // spóźniona odpowiedź na stary cel — pomiń
      setPreview(r)
      setOverrides({})
    } catch (e: any) {
      if (seq !== previewSeq.current) return
      setErr(e?.message || 'Nie udało się policzyć podziału')
      setPreview(null)
    } finally {
      if (seq === previewSeq.current) setLoadingPreview(false)
    }
  }

  function onCelKgChange(raw: string) {
    setCelKgInput(raw)
    setErr(''); setNeedsCancel(false)
    const n = parseFloat(raw.replace(',', '.'))
    if (raw.trim() === '' || Number.isNaN(n) || n < 0) {
      // Unieważnij żądanie w locie: bez podbicia licznika jego spóźniona
      // odpowiedź przechodzi kontrolę `seq === previewSeq.current` i wskrzesza
      // tabelę dla celu, którego w polu już nie ma. Po podbiciu nikt już nie
      // zgasi „Liczę…" (stary `finally` też odpada na tej kontroli), więc
      // gasimy je tutaj — inaczej zamiast podpowiedzi zostaje wieczny spinner.
      previewSeq.current++
      setPreview(null)
      setLoadingPreview(false)
      return
    }
    void runPreview(n)
  }

  function on5050() {
    if (kgCalosc == null) return
    // Właściciel zaakceptował, że nieparzystej całości nie da się rozłożyć
    // idealnie po połowie całymi sztukami — cel idzie NIEZAOKRĄGLONY,
    // a to, jak backend go rozłoży, pokazuje podgląd (Task 8, decyzja 3).
    const polowa = kgCalosc / 2
    setCelKgInput(String(polowa))
    setErr(''); setNeedsCancel(false)
    void runPreview(polowa)
  }

  async function handleSave() {
    if (!preview) return
    const celKg = parseFloat(celKgInput.replace(',', '.'))
    if (Number.isNaN(celKg)) return
    const perLine: Record<string, number> = {}
    for (const line of preview.lines) {
      const n = parseOverride(overrides[line.id])
      if (n !== undefined) perLine[line.id] = n
    }
    setSaving(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      const r = await orderSplitApi.save(orderId, celKg, Object.keys(perLine).length ? perLine : undefined)
      setPreview(r)
      setOverrides({})
      // To, co ZAPISANE — czytane z odpowiedzi zapisu (czyli z tego, co
      // backend faktycznie zapisał), nie z lokalnego stanu, który właśnie
      // zresetowaliśmy.
      setSavedSplit({
        celKg,
        perLine: Object.fromEntries(r.lines.map(l => [l.id, l.qty_invoice])),
      })
      setInfo('Podział zapisany.')
    } catch (e: any) {
      const msg = e?.message || 'Nie udało się zapisać podziału'
      setErr(msg)
      setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally {
      setSaving(false)
    }
  }

  async function handleIssue() {
    // Ten przycisk ZDEJMUJE STAN MAGAZYNU i wypala numery dokumentów, a
    // powstają one z podziału ZAPISANEGO W BAZIE — nie z tego, co na ekranie.
    // Wolno go więc ruszyć tylko wtedy, gdy jedno jest drugim (`matchesSaved`).
    // Bramka siedzi też tutaj, nie tylko w atrybucie `disabled`, żeby żadna
    // inna droga do handlera jej nie ominęła.
    if (issuing || !matchesSaved) return
    const listaDokumentow = hdiFv
      ? 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR, HDI na całość i HDI do faktury'
      : 'WZ wewnętrzny (WM), WZ dla klienta, 2× CMR i HDI na całość'
    const ok = window.confirm(
      `Wystawić komplet dokumentów?\n\nPowstaną: ${listaDokumentow}.\n\n` +
      'WZ wewnętrzny ZDEJMIE towar ze stanu magazynu wyrobów gotowych — cofniesz to ' +
      'TYLKO anulując cały komplet.')
    if (!ok) return
    setIssuing(true); setErr(''); setNeedsCancel(false); setInfo('')
    try {
      const r = await orderSplitApi.documents(orderId, hdiFv)
      setDocuments(r)
    } catch (e: any) {
      const msg = e?.message || 'Nie udało się wystawić dokumentów'
      setErr(msg)
      setNeedsCancel(WYMAGA_ANULOWANIA.test(msg))
    } finally {
      setIssuing(false)
    }
  }

  async function handleCancelDocuments() {
    const ok = window.confirm(
      'Anulować dokumenty podziału?\n\n' +
      'Towar wróci na stan, a numery WM / WZ / HDI / CMR tego kompletu przepadną ' +
      '— trzeba będzie wystawić je jeszcze raz.')
    if (!ok) return
    setCancelling(true)
    try {
      const r = await orderSplitApi.cancelDocuments(orderId)
      setNeedsCancel(false); setErr(''); setDocuments(null)
      const zwrocono = r?.returned_qty ?? 0
      setInfo(`Dokumenty podziału anulowane, towar wrócił na stan (${zwrocono} szt). ` +
              'Popraw podział i zapisz ponownie.')
    } catch (e: any) {
      setErr(e?.message || 'Nie udało się anulować dokumentów')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-surface-4 bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-surface-3 px-5 py-3">
          <div>
            <h2 className="text-[15px] font-bold text-ink">Podział wysyłki — faktura i WZ</h2>
            <p className="text-[11.5px] text-ink-4">
              {orderNo ? `Zamówienie ${orderNo}` : `Zamówienie ${orderId}`}
              {clientName ? ` · ${clientName}` : ''}
              {kgCalosc != null ? ` · razem ${fmtKgTrim(kgCalosc)} kg` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-ink-4 hover:text-ink" aria-label="Zamknij">
            <X size={16} />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                Na fakturę [kg]
              </span>
              <input
                type="number" min="0" step="0.5" inputMode="decimal"
                value={celKgInput}
                onChange={e => onCelKgChange(e.target.value)}
                className="h-9 w-40 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums"
              />
            </label>
            <button type="button" onClick={on5050} disabled={kgCalosc == null}
              title={kgCalosc == null ? 'Nieznana suma zamówienia' : 'Połowa całości na fakturę'}
              className="h-9 rounded border border-surface-4 px-3 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-40">
              50/50
            </button>
            {loadingPreview && <span className="text-[11.5px] text-ink-4">Liczę…</span>}
          </div>

          {preview && (
            <>
              {preview.trafiono === false && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  Nie da się trafić dokładnie w podany cel całymi sztukami — najbliższy możliwy
                  podział to <b>{fmtKgTrim(preview.kg_fv)}</b> kg na fakturę
                  (odchyłka <b>{odchylkaTekst(preview.odchylka)}</b>).
                </div>
              )}

              <div className="overflow-x-auto rounded border border-surface-4">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-wider text-ink-4">
                    <tr>
                      <th className="px-3 py-2 text-left">Receptura</th>
                      <th className="px-3 py-2 text-right">kg/szt</th>
                      <th className="px-3 py-2 text-right">Zamówiono</th>
                      <th className="px-3 py-2 text-right">Na FV</th>
                      <th className="px-3 py-2 text-right">Na WZ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-3">
                    {preview.lines.map(line => {
                      const raw = overrides[line.id]
                      const parsed = parseOverride(raw)
                      const naWz = parsed !== undefined ? line.qty - parsed : line.qty_wz
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink">{line.recipe_name}</div>
                            {line.product_type_name && (
                              <div className="text-[11px] text-ink-4">{line.product_type_name}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtKgTrim(line.kg_per_unit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number" min="0" max={line.qty} step="1"
                              value={raw ?? String(line.qty_invoice)}
                              onChange={e => setOverrides(o => ({ ...o, [line.id]: e.target.value }))}
                              aria-label={`na FV — ${line.recipe_name}`}
                              className="h-8 w-20 rounded border border-surface-4 bg-surface px-2 text-right tabular-nums"
                            />
                          </td>
                          <td className={cn('px-3 py-2 text-right tabular-nums',
                            naWz < 0 && 'font-semibold text-red-600')}>
                            {naWz}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-1 rounded border px-3 py-2 text-[12.5px]',
                hasPendingOverrides ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-surface-4 bg-surface-2 text-ink-3')}>
                {hasPendingOverrides && (
                  // Wiersze pokazują NOWE liczby (po ręcznej korekcie), ale te
                  // sumy wciąż liczone są z poprzedniej odpowiedzi API — nie
                  // wolno dać biuru odczytać ich jako aktualnych (przeliczenie
                  // sum to „split", a tego ekran sam nie robi — patrz „Zapisz").
                  <div className="basis-full text-[11.5px] font-semibold text-amber-800">
                    Sumy poniżej są sprzed tej korekty — zapisz podział, żeby je przeliczyć.
                  </div>
                )}
                <div>Razem <b className="text-ink">{fmtKgTrim(preview.kg_calosc)}</b> kg</div>
                <div>Na fakturę <b className="text-ink">{fmtKgTrim(preview.kg_fv)}</b> kg</div>
                <div>Na WZ <b className="text-ink">{fmtKgTrim(preview.kg_wz)}</b> kg</div>
                <div className={cn(preview.trafiono === false && 'font-semibold text-amber-700')}>
                  Odchyłka <b>{odchylkaTekst(preview.odchylka)}</b>
                </div>
              </div>
            </>
          )}

          {!preview && !loadingPreview && (
            <div className="rounded border border-dashed border-surface-4 px-3 py-6 text-center text-[12.5px] text-ink-4">
              Wpisz kilogramy na fakturę (albo kliknij „50/50"), żeby zobaczyć podział pozycji.
            </div>
          )}

          {err && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
              <div>{err}</div>
              {needsCancel && (
                <>
                  <div className="text-[11.5px] text-red-700/80">
                    Wyjście jest jedno: anulować komplet dokumentów tego podziału. Towar wróci na
                    stan, a numery WM / WZ / HDI / CMR przepadną — trzeba będzie wystawić je
                    jeszcze raz.
                  </div>
                  <button type="button" onClick={handleCancelDocuments} disabled={cancelling}
                    className="rounded bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {cancelling ? 'Anuluję…' : 'Anuluj dokumenty podziału'}
                  </button>
                </>
              )}
            </div>
          )}

          {info && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">
              {info}
            </div>
          )}

          {documents && (
            <div className="space-y-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-3 text-[12.5px]">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-emerald-800">Komplet dokumentów wystawiony</div>
                {/* Tu WIADOMO na pewno, że dokumenty istnieją — akcja wycofania
                    stoi obok nich ZAWSZE, nie tylko po odmowie (`needsCancel`),
                    bo bez tego jedyna droga do niej bywała nieosiągalna
                    (review, runda 3, Important 2). */}
                <button type="button" onClick={handleCancelDocuments} disabled={cancelling}
                  className="shrink-0 rounded border border-red-300 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                  {cancelling ? 'Anuluję…' : 'Anuluj dokumenty podziału'}
                </button>
              </div>
              <DocRow label="WZ wewnętrzny (WM)" doc={documents.wm} typ="wz" />
              <DocRow label="WZ dla klienta" doc={documents.wz} typ="wz" />
              {(documents.cmr ?? []).map((c, i) => (
                <DocRow key={c?.id ?? i} label={i === 0 ? 'CMR — całość' : 'CMR — do faktury'} doc={c} typ="cmr" />
              ))}
              <DocRow label="HDI — całość" doc={documents.hdi_calosc} typ="hdi" />
              {documents.hdi_fv && <DocRow label="HDI — do faktury" doc={documents.hdi_fv} typ="hdi" />}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-3 px-5 py-3">
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" checked={hdiFv} onChange={e => setHdiFv(e.target.checked)} />
            także HDI do faktury
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
              Zamknij
            </button>
            <button type="button" onClick={handleSave} disabled={!preview || saving}
              className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2 disabled:opacity-50">
              {saving ? 'Zapisywanie…' : 'Zapisz podział'}
            </button>
            {/* ZDEJMUJE STAN: aktywny tylko, gdy ekran = baza (`matchesSaved`). */}
            <button type="button" onClick={handleIssue}
              disabled={issuing || !matchesSaved}
              className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
              {issuing ? 'Wystawiam…' : 'Wystaw komplet dokumentów'}
            </button>
          </div>
          {!issuing && !matchesSaved && (
            // Widoczny powód blokady zamiast wyszarzonego przycisku bez
            // wyjaśnienia — biuro ma wiedzieć, co zrobić, nie zgadywać.
            // Wyjście jest w TYM oknie: przycisk „Zapisz podział" obok.
            <div className="basis-full text-right text-[11px] text-ink-4">
              {!preview
                ? 'Wpisz kilogramy na fakturę (albo kliknij „50/50"), żeby zobaczyć podział przed wystawieniem.'
                : 'Zapisz podział, żeby wystawić komplet dokumentów — powstają one z tego, co zapisane w bazie, nie z tego, co widać na ekranie.'}
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}

function DocRow({ label, doc, typ }: {
  label: string; doc?: { id: string; number: string } | null; typ: 'wz' | 'hdi' | 'cmr'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}: <b className="font-mono">{doc?.number ?? '—'}</b></span>
      {doc?.id && (
        <a href={`/office/${typ}/${doc.id}/druk`} target="_blank" rel="noreferrer"
          className="text-[11.5px] font-medium text-primary hover:underline">
          Drukuj
        </a>
      )}
    </div>
  )
}
