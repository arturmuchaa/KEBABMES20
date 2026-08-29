/**
 * WYKAZY DOSTAWCÓW I ODBIORCÓW — karty 1.1.3 i 1.3.2 oPRP oraz zakładowy
 * wykaz odbiorców.
 *
 * Do 29.08.2026 MES miał kartotekę kontrahentów, ale księga HACCP dostawała
 * listy przepisywane ręcznie do Worda — i rozjeżdżały się z kartoteką przy
 * pierwszym nowym dostawcy. Tutaj wykaz powstaje z tych samych danych, na
 * których pracuje przyjęcie.
 *
 * Biuro ZAZNACZA pozycje: kartoteka trzyma też kontrahentów jednorazowych i
 * takich, którzy przestali dostarczać, a na wykazie do księgi mają być tylko
 * dostawcy zatwierdzeni. Podpowiedź: numer weterynaryjny dzieli dostawców na
 * artykuły pochodzenia zwierzęcego (karta 1.1.3) i resztę (karta 1.3.2).
 *
 * WYGLĄD = karta 5.1.1.1 / raport rozbioru: ta sama typografia, belka, pola
 * meta i stopka z numerem karty. Kolor wyłącznie w logo.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientsApi, rawBatchesApi, suppliersApi } from '@/lib/apiClient'
import { drukuj } from '@/lib/print'
import { fmtDatePl } from '@/lib/utils'
import { Printer, CheckSquare, Square } from 'lucide-react'
import type { Supplier } from '@/types'
import type { Client } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const printStyles = `
@media print {
  @page { size: A4 portrait; margin: 5mm 7mm; }
  body * { visibility: hidden; }
  #wykaz, #wykaz * { visibility: visible; }
  #wykaz { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}
`

const DOC_CSS = `
@font-face { font-family:'RCWyk'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCWyk'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin.woff2') format('woff2'); }
@font-face { font-family:'RCWyk'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCWyk'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin.woff2') format('woff2'); }

.wyk, .wyk * { box-sizing:border-box; }
.wyk { font-family:'RCWyk',Arial,sans-serif; color:#111; font-size:8.4pt; line-height:1.25;
  background:#fff; width:196mm; margin:0 auto 6mm; padding:0;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media print { .wyk { width:auto; margin:0; } }

.wyk .top { display:flex; align-items:flex-start; gap:6mm; }
.wyk .top img { height:10mm; }
.wyk .plant { flex:1; text-align:center; padding-top:.8mm; }
.wyk .plant .nm { font-weight:700; font-size:9pt; letter-spacing:.02em; }
.wyk .plant .ad { font-size:7pt; color:#333; }
.wyk .rule { height:1.4mm; margin:2.6mm 0 0; background:#9a9a9a; }
.wyk h1 { font-size:12pt; font-weight:700; text-align:center; letter-spacing:.03em;
  margin:1.6mm 0 .5mm; text-transform:uppercase; }
.wyk .sub { text-align:center; font-size:7.2pt; color:#444; margin-bottom:2mm; }

.wyk .meta { display:flex; gap:2mm; margin-bottom:2mm; }
.wyk .fld { flex:1; border:.35mm solid #777; padding:.9mm 1.6mm; min-height:8.5mm; }
.wyk .fld.w2 { flex:2; }
.wyk .fld .lb { font-size:6.6pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
.wyk .fld .vl { font-size:10pt; font-weight:700; margin-top:.7mm;
  font-variant-numeric:tabular-nums; }

.wyk .cap { font-size:7.2pt; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  background:#dcdcdc; border:.28mm solid #8c8c8c; border-bottom:0; padding:1mm 1.6mm; }
.wyk .blk { margin-top:2.4mm; }
.wyk table { width:100%; border-collapse:collapse; }
.wyk th { background:#ededed; color:#1a1a1a; font-size:6.8pt; font-weight:700;
  text-transform:uppercase; letter-spacing:.03em; border:.28mm solid #8c8c8c;
  padding:1mm .8mm; text-align:left; vertical-align:middle; }
.wyk td { border:.28mm solid #8c8c8c; padding:1.2mm .8mm; font-size:8.4pt; }
.wyk td.c { text-align:center; font-variant-numeric:tabular-nums; }
.wyk td.mono { font-variant-numeric:tabular-nums; }
.wyk tr.pusty td { height:5.4mm; }

/* Kwartalna weryfikacja z wzoru 1.1.3 — cztery kratki na wpis ręczny. */
.wyk .kw { display:flex; gap:2mm; margin-top:2.4mm; }
.wyk .kwbox { flex:1; border:.35mm solid #777; padding:1mm 1.6mm; min-height:13mm; }
.wyk .kwbox .lb { font-size:6.6pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
.wyk .kwbox .ln { font-size:6.6pt; color:#666; margin-top:3.4mm; }

.wyk .sg { display:flex; gap:3mm; margin-top:2.4mm; }
.wyk .sgbox { flex:1; border:.35mm solid #777; padding:1.2mm 2mm; min-height:14mm; background:#fff; }
.wyk .sgbox .lb { font-size:6.6pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }

.wyk .foot { display:flex; justify-content:space-between; margin-top:2.4mm;
  font-size:6.8pt; font-weight:700; color:#333; letter-spacing:.04em; }
.wyk .foot .l { font-weight:400; color:#555; }
`

/** Który wykaz drukujemy. */
type Rodzaj = 'apz' | 'ddfip' | 'odbiorcy'

interface Wiersz {
  id: string
  nazwa: string
  /** Numer weterynaryjny (karta 1.1.3) albo NIP (odbiorcy). */
  numer: string
  adres: string
  zakres: string
}

const OPIS: Record<Rodzaj, {
  przycisk: string
  karta: string
  tytul: string
  podtytul: string
  stopka: string
  kolumny: string[]
}> = {
  apz: {
    przycisk: 'Karta 1.1.3 — dostawcy mięsa',
    karta: '1.1.3',
    tytul: 'Lista dostawców artykułów pochodzenia zwierzęcego',
    podtytul: 'Wykaz dostawców zatwierdzonych wg Głównego Lekarza Weterynarii — '
      + 'aktualizacja raz na kwartał, przez przegląd wykazu na stronach GLW',
    stopka: 'Karta 1.1.3 do instrukcji 1.1 — operacyjne programy warunków wstępnych (oPRP)',
    kolumny: ['Lp.', 'Nazwa dostawcy', 'Numer IW'],
  },
  ddfip: {
    przycisk: 'Karta 1.3.2 — opakowania i przyprawy',
    karta: '1.3.2',
    tytul: 'Lista dostawców opakowań, przypraw i dodatków technologicznych',
    podtytul: 'Dostawcy opakowań, przypraw, dodatków technologicznych i innych '
      + 'materiałów pomocniczych niezbędnych do pracy zakładu',
    stopka: 'Karta 1.3.2 do instrukcji 1.3 — operacyjne programy warunków wstępnych (oPRP)',
    kolumny: ['Lp.', 'Nazwa dostawcy', 'Adres', 'Zakres dostaw'],
  },
  odbiorcy: {
    przycisk: 'Wykaz odbiorców',
    karta: '—',
    tytul: 'Wykaz odbiorców wyrobów gotowych',
    podtytul: 'Odbiorcy, do których zakład wysyła wyrób gotowy — '
      + 'do identyfikacji kierunków sprzedaży przy wycofaniu z rynku (instrukcja 2.7)',
    // Księga nie ma karty na odbiorców — nie wymyślamy numeru, żeby nie
    // wejść w numer zajęty przez inny dokument. Biuro nada go w księdze.
    stopka: 'Wykaz zakładowy — poza numeracją księgi HACCP',
    kolumny: ['Lp.', 'Nazwa odbiorcy', 'Adres', 'NIP'],
  },
}

/** Ile pustych wierszy dopisujemy pod listą — miejsce na dopiski ręką. */
const PUSTE_WIERSZE = 4

function adresPelny(x: { address?: string; postalCode?: string; city?: string }): string {
  const miasto = [x.postalCode, x.city].filter(Boolean).join(' ').trim()
  return [x.address, miasto].filter(Boolean).join(', ')
}

export function PartnerListsPage() {
  const { data: dostawcy, loading: l1 } = useApi(() => suppliersApi.list())
  const { data: odbiorcy, loading: l2 } = useApi(() => clientsApi.list())
  // Kto realnie dostarczał mięso — kartoteka tego nie mówi (numer
  // weterynaryjny bywa niewypełniony nawet u głównego dostawcy), a przyjęcia
  // owszem. Stąd bierzemy podpowiedź, na którą kartę trafia dostawca.
  const { data: partie } = useApi<{ data: any[] }>(() => (rawBatchesApi as any).all())

  const [rodzaj, setRodzaj] = useState<Rodzaj>('apz')
  /** Ręczny wybór biura; `null` = jeszcze nie ruszane, obowiązuje podpowiedź. */
  const [wybor, setWybor] = useState<Record<Rodzaj, Set<string> | null>>({
    apz: null, ddfip: null, odbiorcy: null,
  })

  /** Dostawcy, od których przyszła choć jedna partia surowca. */
  const dostawcyMiesa = useMemo(() => {
    const set = new Set<string>()
    for (const b of (partie?.data ?? [])) {
      if (b?.supplierId) set.add(String(b.supplierId))
    }
    return set
  }, [partie])

  const wszystkie = useMemo<Wiersz[]>(() => {
    const sup = (dostawcy ?? []) as Supplier[]
    const cli = (odbiorcy ?? []) as Client[]
    if (rodzaj === 'odbiorcy') {
      return cli.map(c => ({
        id: c.id,
        nazwa: c.displayName || c.name,
        numer: c.nip || '',
        adres: adresPelny(c),
        zakres: '',
      })).sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
    }
    // Obie karty dostawców widzą CAŁĄ kartotekę — podział to tylko podpowiedź,
    // bo jeden dostawca potrafi wozić i mięso, i przyprawy.
    return sup.map(s => ({
      id: s.id,
      nazwa: s.displayName || s.name,
      numer: s.vetNumber || '',
      adres: adresPelny(s),
      zakres: s.supplyScope || '',
    })).sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))
  }, [dostawcy, odbiorcy, rodzaj])

  /** Podpowiedź: mięso (przyjęcia albo numer weterynaryjny) → karta 1.1.3. */
  const domyslne = useMemo(() => {
    const set = new Set<string>()
    for (const w of wszystkie) {
      const miesny = dostawcyMiesa.has(w.id) || Boolean(w.numer.trim())
      if (rodzaj === 'odbiorcy' || (rodzaj === 'apz' ? miesny : !miesny)) set.add(w.id)
    }
    return set
  }, [wszystkie, dostawcyMiesa, rodzaj])

  const zaznaczone = wybor[rodzaj] ?? domyslne
  const wybrane = useMemo(
    () => wszystkie.filter(w => zaznaczone.has(w.id)), [wszystkie, zaznaczone])

  const przelacz = (id: string) => setWybor(p => {
    const n = new Set(p[rodzaj] ?? domyslne)
    n.has(id) ? n.delete(id) : n.add(id)
    return { ...p, [rodzaj]: n }
  })
  const zaznaczWszystkie = () =>
    setWybor(p => ({ ...p, [rodzaj]: new Set(wszystkie.map(w => w.id)) }))
  const odznaczWszystkie = () => setWybor(p => ({ ...p, [rodzaj]: new Set<string>() }))

  const handlePrint = () => {
    const s = document.createElement('style')
    s.textContent = printStyles
    document.head.appendChild(s)
    void drukuj()
    setTimeout(() => document.head.removeChild(s), 2000)
  }

  const opis = OPIS[rodzaj]
  const dzis = new Date().toISOString().slice(0, 10)

  if (l1 || l2) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <style>{printStyles}</style>

      <Card className="no-print">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Wykaz do księgi HACCP</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OPIS) as Rodzaj[]).map(r => (
              <Button
                key={r}
                size="sm"
                variant={r === rodzaj ? 'default' : 'outline'}
                onClick={() => setRodzaj(r)}
              >
                {OPIS[r].przycisk}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">
              Na wykazie: <b className="text-foreground">{wybrane.length}</b> z {wszystkie.length}
              {rodzaj !== 'odbiorcy' && ' · zaznaczeni z góry to podpowiedź z przyjęć'}
            </span>
            <Button size="sm" variant="ghost" onClick={zaznaczWszystkie}>Zaznacz wszystkie</Button>
            <Button size="sm" variant="ghost" onClick={odznaczWszystkie}>Odznacz wszystkie</Button>
            <Button size="sm" className="ml-auto gap-2" onClick={handlePrint}
              disabled={wybrane.length === 0}>
              <Printer size={14} /> Drukuj wykaz
            </Button>
          </div>

          <div className="border rounded-md divide-y max-h-[340px] overflow-y-auto">
            {wszystkie.length === 0 && (
              <div className="p-4 text-[13px] text-muted-foreground">
                Kartoteka nie ma pozycji dla tego wykazu.
              </div>
            )}
            {wszystkie.map(w => {
              const on = zaznaczone.has(w.id)
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => przelacz(w.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  {on
                    ? <CheckSquare size={15} className="text-primary flex-shrink-0" />
                    : <Square size={15} className="text-muted-foreground flex-shrink-0" />}
                  <span className={`text-[13px] font-semibold flex-1 min-w-0 truncate${on ? '' : ' text-muted-foreground'}`}>
                    {w.nazwa}
                  </span>
                  <span className="text-[12px] text-muted-foreground truncate max-w-[45%]">
                    {rodzaj === 'ddfip' ? (w.zakres || w.adres) : (w.numer || w.adres)}
                  </span>
                </button>
              )
            })}
          </div>

          {rodzaj === 'ddfip' && (
            <p className="text-[12px] text-muted-foreground">
              Kolumnę „Zakres dostaw” wypełnia się w kartotece dostawcy — puste pole
              zostaje na karcie kratką do dopisania ręką.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── KARTA DO DRUKU ─────────────────────────────────────────── */}
      <div id="wykaz">
        <div className="wyk">
          <style>{DOC_CSS}</style>

          <div className="top">
            <img src="/logo-ksiezyc-print.png" alt="Księżyc" />
            <div className="plant">
              <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
              <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
            </div>
          </div>
          <div className="rule" />

          <h1>{opis.tytul}</h1>
          <div className="sub">{opis.podtytul}</div>

          <div className="meta">
            <div className="fld"><div className="lb">Nr karty</div><div className="vl">{opis.karta}</div></div>
            <div className="fld"><div className="lb">Data sporządzenia</div><div className="vl">{fmtDatePl(dzis)}</div></div>
            <div className="fld"><div className="lb">Pozycji</div><div className="vl">{wybrane.length}</div></div>
            <div className="fld"><div className="lb">Edycja</div><div className="vl">2</div></div>
          </div>

          {/* Kwartalna weryfikacja tylko na 1.1.3 — tak jak we wzorze. */}
          {rodzaj === 'apz' && (
            <div className="kw">
              {['I kwartał', 'II kwartał', 'III kwartał', 'IV kwartał'].map(k => (
                <div key={k} className="kwbox">
                  <div className="lb">{k}</div>
                  <div className="ln">Data weryfikacji</div>
                  <div className="ln">Podpis</div>
                </div>
              ))}
            </div>
          )}

          <div className="blk">
            <div className="cap">
              {rodzaj === 'odbiorcy' ? 'Odbiorcy wyrobu gotowego' : 'Dostawcy zatwierdzeni'}
            </div>
            <table>
              <thead>
                <tr>
                  {opis.kolumny.map((h, i) => (
                    <th key={h} style={{ width: i === 0 ? '10mm' : undefined }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wybrane.map((w, i) => (
                  <tr key={w.id}>
                    <td className="c">{i + 1}</td>
                    <td style={{ fontWeight: 700 }}>{w.nazwa}</td>
                    {rodzaj === 'apz'
                      ? <td className="mono">{w.numer || ''}</td>
                      : <>
                          <td>{w.adres}</td>
                          <td className="mono">{rodzaj === 'ddfip' ? w.zakres : w.numer}</td>
                        </>}
                  </tr>
                ))}
                {/* Puste wiersze: wykaz aktualizuje się kwartalnie, a nowy
                    dostawca bywa dopisywany ręką między wydrukami. */}
                {Array.from({ length: PUSTE_WIERSZE }, (_, i) => (
                  <tr className="pusty" key={`p${i}`}>
                    <td className="c">{wybrane.length + i + 1}</td>
                    <td />
                    <td />
                    {rodzaj !== 'apz' && <td />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sg">
            <div className="sgbox"><div className="lb">Sporządził — data i podpis</div></div>
            <div className="sgbox"><div className="lb">Zatwierdził — data i podpis</div></div>
          </div>

          <div className="foot">
            <span className="l">Przechowywanie zapisu: min. 1 rok</span>
            <span>{opis.stopka}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
