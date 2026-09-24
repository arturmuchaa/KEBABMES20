import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, Truck, AlertTriangle, Check } from 'lucide-react'
import { zaladunkiApi } from '@/lib/api'
import { CmrDaneTransportu, DOMYSLNE_DANE_TRANSPORTU,
         type DaneTransportu } from '@/components/cmr/CmrDaneTransportu'
import { fmtKg } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

/**
 * Papiery jednego KURSU — wszystko, co wyjechało tym autem, w jednym miejscu.
 *
 * Magazynier nie ma ani drukarki, ani uprawnień, więc komplet drukuje biuro
 * (12.09.2026). Dokumenty otwieramy ich WŁASNYMI ekranami wydruku — te już
 * istnieją i są jedynym miejscem, które wie, jak dany papier ma wyglądać.
 * Powielanie tego tutaj skończyłoby się dwiema wersjami tego samego wydruku.
 */
type Dok = { id: string; number: string; doc_series?: string; split_scope?: string | null; scope?: string | null }
type Pozycja = {
  order_id: string
  order_no: string | null
  client_name: string | null
  wz_status: string | null
  /** Co FAKTYCZNIE wyjechało tym kursem — z tego biuro liczy „całość". */
  kg_zaladowane: number
  zaladowano: Array<{ stock_id: string; batch_no: string | null; szt: number }>
  wz: Dok[]
  hdi: Dok[]
  cmr: Dok[]
}

/** Decyzja biura dla jednego odbiorcy: całość na fakturę albo podział,
 *  oraz NUMER FAKTURY tego odbiorcy.
 *
 *  Numer jest per odbiorca, bo faktura jest per odbiorca. Do 21.09.2026 cały
 *  kurs szedł z jednym numerem z formularza transportu i kurs na czterech
 *  klientów dawał cztery CMR-y z fakturą pierwszego z nich (biuro: „powinienem
 *  móc do każdego klienta wpisać inny numer FV na CMR"). Przewoźnik i auto
 *  zostają wspólne — to jedno auto i jeden kierowca. */
type Decyzja = { tryb: 'calosc' | 'podzial'; kgFv: string; fakturaNr: string }

const PUSTA_DECYZJA: Decyzja = { tryb: 'calosc', kgFv: '', fakturaNr: '' }

function Papier({ do: doAdres, etykieta, numer }: { do: string; etykieta: string; numer: string }) {
  return (
    <Link
      to={doAdres}
      target="_blank"
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
    >
      <Printer size={14} className="text-slate-500" />
      <span className="font-semibold">{etykieta}</span>
      <code className="font-mono text-xs text-slate-600">{numer}</code>
    </Link>
  )
}

export function ZaladunekDrukPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [kurs, setKurs] = useState<any>(null)
  const [blad, setBlad] = useState('')
  const [zapisuje, setZapisuje] = useState(false)
  const [oznaczony, setOznaczony] = useState(false)
  // Decyzja biura per odbiorca oraz dane transportu na oba listy przewozowe.
  const [decyzje, setDecyzje] = useState<Record<string, Decyzja>>({})
  const [transport, setTransport] = useState<DaneTransportu>(DOMYSLNE_DANE_TRANSPORTU)
  const [wystawia, setWystawia] = useState(false)

  function wczytaj() {
    return zaladunkiApi.get(id).then((k) => {
      setKurs(k)
      // Numer rejestracyjny znamy z POTWIERDZENIA ZAŁADUNKU — magazynier
      // wpisał go przy skanowaniu, a ekran pokazuje go w nagłówku. Formularz
      // transportu startował mimo to z pustego pola i biuro przepisywało
      // numer ręcznie (zgłoszenie właściciela 24.09.2026: „nie zaciąga się
      // do pola CMR, widać tylko u góry").
      //
      // NIE NADPISUJEMY tego, co biuro już wpisało: auto bywa podmieniane
      // między załadunkiem a wystawieniem papierów, a wtedy racji ma biuro.
      if (k?.plate) {
        setTransport(t => (t.plate.trim() ? t : { ...t, plate: String(k.plate) }))
      }
      // Domyślnie CAŁOŚĆ na fakturę — tak wygląda większość kursów, a przy
      // podziale biuro i tak wpisuje kilogramy ręcznie.
      setDecyzje(Object.fromEntries(((k?.pozycje ?? []) as Pozycja[])
        .map(p => [p.order_id, { tryb: 'calosc', kgFv: '', fakturaNr: '' } as Decyzja])))
    })
  }

  /** Wystaw komplet dla wszystkich odbiorców czekających na biuro. */
  async function wystaw() {
    if (wystawia) return
    const czekajace = pozycjeDoWystawienia
    const orders = czekajace.map(p => {
      const d = decyzje[p.order_id] ?? PUSTA_DECYZJA
      const kg = d.tryb === 'calosc' ? p.kg_zaladowane : Number(d.kgFv.replace(',', '.'))
      // `invoice_no` przy zamówieniu NADPISUJE numer z formularza transportu —
      // pusty zostawia tamten, więc kurs na jednego odbiorcę działa jak dotąd.
      return { order_id: p.order_id, cel_kg: kg, invoice_no: d.fakturaNr.trim() }
    })
    const zly = orders.find(o => !(o.cel_kg > 0))
    if (zly) { setBlad('Podaj kilogramy na fakturę dla każdego odbiorcy'); return }

    const ok = window.confirm(
      `Wystawić komplet dokumentów dla ${orders.length} odbiorców?\n\n` +
      'WZ wewnętrzny (WM) ZDEJMIE towar ze stanu magazynu — do tej chwili ' +
      'towar wyjechał, ale magazyn go jeszcze pokazuje.')
    if (!ok) return

    setWystawia(true); setBlad('')
    try {
      await zaladunkiApi.wystaw(id, orders, { ...transport })
      await wczytaj()
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się wystawić dokumentów')
    } finally { setWystawia(false) }
  }

  useEffect(() => {
    if (!id) return
    wczytaj().catch(e => setBlad(e?.message || 'Nie udało się wczytać kursu'))
  }, [id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function oznacz() {
    if (zapisuje) return
    setZapisuje(true)
    try {
      await zaladunkiApi.wydrukowano(id)
      setOznaczony(true)
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się oznaczyć kursu')
    } finally {
      setZapisuje(false)
    }
  }

  const pozycje: Pozycja[] = kurs?.pozycje ?? []
  const pozycjeDoWystawienia = pozycje.filter(p => p.wz_status === 'do_wystawienia')

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link to="/office" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
          <ArrowLeft size={15} /> Pulpit
        </Link>
        <div className="flex items-center gap-2 font-bold">
          <Truck size={17} /> Papiery kursu
          {kurs?.plate && <code className="font-mono text-sm">{kurs.plate}</code>}
        </div>
      </div>

      {blad && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{blad}</div>}

      {/* ── Kurs czeka na BIURO ────────────────────────────────────────
          Skan tylko zapisał, co wyjechało; papiery wystawia biuro, bo
          magazynier nie ma ani drukarki, ani uprawnień. Dopiero wystawienie
          zdejmuje towar ze stanu — do tej chwili magazyn pokazuje go mimo
          że auto odjechało, i po to jest karta na pulpicie. */}
      {pozycjeDoWystawienia.length > 0 && (
        <Card className="border-sky-300 bg-sky-50/40">
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-bold text-sky-900">
              Do wystawienia · {pozycjeDoWystawienia.length}
              {' '}<span className="font-normal text-sky-800">
                — wybierz przy każdym odbiorcy, ile idzie na fakturę
              </span>
            </div>

            {pozycjeDoWystawienia.map((p) => {
              const d = decyzje[p.order_id] ?? PUSTA_DECYZJA
              const ustaw = (patch: Partial<Decyzja>) =>
                setDecyzje(s => ({ ...s, [p.order_id]: { ...d, ...patch } }))
              return (
                <div key={p.order_id} className="rounded-lg border border-sky-200 bg-white p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-bold">{p.client_name || '—'}</span>
                    <span className="text-xs text-muted-foreground">{p.order_no}</span>
                    <span className="ml-auto text-xs tabular-nums text-slate-600">
                      wyjechało <b>{fmtKg(p.kg_zaladowane, 1)} kg</b>
                      {' · '}{p.zaladowano.length} poz.
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        data-testid={`calosc-${p.order_id}`}
                        checked={d.tryb === 'calosc'}
                        onChange={() => ustaw({ tryb: 'calosc' })}
                      />
                      całość na fakturę
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        data-testid={`podziel-${p.order_id}`}
                        checked={d.tryb === 'podzial'}
                        onChange={() => ustaw({ tryb: 'podzial' })}
                      />
                      podziel:
                    </label>
                    <input
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40"
                      data-testid={`kg-fv-${p.order_id}`}
                      placeholder="kg na FV"
                      inputMode="decimal"
                      disabled={d.tryb !== 'podzial'}
                      value={d.kgFv}
                      onChange={e => ustaw({ kgFv: e.target.value })}
                    />
                    {d.tryb === 'podzial' && (
                      <span className="text-xs text-slate-500">
                        reszta ({fmtKg(Math.max(0, p.kg_zaladowane
                          - (Number(d.kgFv.replace(',', '.')) || 0)), 1)} kg) pójdzie na WZ
                      </span>
                    )}
                  </div>
                  {/* Numer faktury TEGO odbiorcy — wchodzi w pole 5 obu jego
                      listów przewozowych. Każdy klient ma własną fakturę. */}
                  <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      Nr faktury (CMR, pole 5)
                    </span>
                    <input
                      className="w-48 rounded border border-slate-300 px-2 py-1 text-sm"
                      data-testid={`faktura-${p.order_id}`}
                      placeholder="FV 11/09/2026"
                      value={d.fakturaNr}
                      onChange={e => ustaw({ fakturaNr: e.target.value })}
                    />
                  </label>
                </div>
              )
            })}

            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900">
                Dane na listy przewozowe (CMR) — wspólne dla całego kursu
              </div>
              {/* Bez numeru faktury: ten jest przy KAŻDYM odbiorcy wyżej. */}
              <CmrDaneTransportu
                wartosc={transport} onChange={setTransport} disabled={wystawia} bezFaktury
              />
            </div>

            <Button onClick={wystaw} disabled={wystawia} data-testid="wystaw-komplet">
              {wystawia ? 'Wystawiam…' : 'Wystaw komplet dokumentów'}
            </Button>
          </CardContent>
        </Card>
      )}

      {pozycje.map((p) => (
        <Card key={p.order_id}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-bold">{p.client_name || '—'}</span>
              <span className="text-xs text-muted-foreground">{p.order_no}</span>
              {p.wz_status === 'rozjazd' && (
                <Badge variant="outline" className="border-amber-400 text-amber-700 gap-1">
                  <AlertTriangle size={12} /> rozjazd — sprawdź przed wydrukiem
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {p.wz.map(d => (
                <Papier key={d.id} do={`/office/wz/${d.id}/druk`}
                  etykieta={d.doc_series === 'WM' ? 'WM (wewnętrzny)' : 'WZ'} numer={d.number} />
              ))}
              {p.hdi.map(d => (
                <Papier key={d.id} do={`/office/hdi/${d.id}/druk`}
                  etykieta={d.scope === 'fv' ? 'HDI do faktury' : 'HDI'} numer={d.number} />
              ))}
              {p.cmr.map(d => (
                <Papier key={d.id} do={`/office/cmr/${d.id}/druk`}
                  etykieta={d.scope === 'fv' ? 'CMR do faktury' : 'CMR na drogę'} numer={d.number} />
              ))}
              {p.wz.length + p.hdi.length + p.cmr.length === 0 && (
                <span className="text-sm text-muted-foreground">Brak wystawionych dokumentów</span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {kurs && (
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={oznacz} disabled={zapisuje || oznaczony || !!kurs.printed_at}>
            {oznaczony || kurs.printed_at
              ? <><Check size={15} className="mr-1.5" /> Oznaczone jako wydrukowane</>
              : 'Wydrukowane — zdejmij z pulpitu'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Ponowny wydruk zawsze z listy „Dokumenty WZ" — dokumenty się nie zmieniają.
          </span>
        </div>
      )}
    </div>
  )
}
