import { useCallback, useMemo, useState } from 'react'
import { Download, FileDown, Printer } from 'lucide-react'
import { useApp, type AppApi } from '../../shell/context'
import { downloadDocPdf, zapiszDokumentPdf } from '@/lib/api'
import { folderPliku } from '@/lib/druk/zapis'
import { drukujZaznaczone, type PapierKursu } from './kurs'

const pliki = (n: number) => (n === 1 ? 'plik' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'pliki' : 'plików')

/**
 * „Zapisz PDF” dla kilku papierów: KAŻDY w osobnym pliku, pod nazwą z serwera
 * (WZ_KLIENT_nr.pdf), od razu do Pobranych — bez okna drukarki (20.11.2026).
 * Błąd jednego papieru nie zatrzymuje reszty.
 */
export async function zapiszPapiery(papiery: Pick<PapierKursu, 'url' | 'plik' | 'etykieta' | 'numer'>[], app: Pick<AppApi, 'toast'>): Promise<number> {
  const ok: { nazwa: string; sciezka: string | null }[] = []
  for (const p of papiery) {
    try { ok.push(await zapiszDokumentPdf(p.url, p.plik)) }
    catch (e) { app.toast({ kind: 'warn', title: `Nie udało się zapisać ${p.etykieta} ${p.numer}`.trim(), detail: e instanceof Error ? e.message : '' }) }
  }
  if (ok.length) {
    const gdzie = ok.find(z => z.sciezka)?.sciezka
    app.toast({ kind: 'ok', title: `Zapisano ${ok.length} ${pliki(ok.length)} PDF`,
      detail: `${gdzie ? `${folderPliku(gdzie)}: ` : ''}${ok.map(z => (z.sciezka ? z.sciezka.slice(folderPliku(z.sciezka).length + 1) : z.nazwa)).join(', ')}` })
  }
  return ok.length
}

/**
 * Zaznaczanie papierów do wspólnego wydruku — jedna logika dla papierów kursu
 * i dla zakładki Dokumenty zamówienia. Zaznaczone idą do JEDNEGO PDF-a
 * w kolejności listy; pojedynczy papier dalej otwiera się kliknięciem.
 */
export function useZaznaczonePapiery(wszystkie: PapierKursu[], nazwaZestawu: string) {
  const app = useApp()
  const [wybrane, setWybrane] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  // Papier, który zniknął z listy (odświeżenie), nie zostaje „zaznaczony w tle”.
  const zaznaczone = useMemo(() => wszystkie.filter(p => wybrane.has(p.key)), [wszystkie, wybrane])
  const przelacz = useCallback((key: string) => setWybrane(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n }), [])
  const ustaw = useCallback((klucze: string[], tak: boolean) => setWybrane(s => { const n = new Set(s); klucze.forEach(k => (tak ? n.add(k) : n.delete(k))); return n }), [])
  const otworz = useCallback(async (p: PapierKursu) => {
    setBusy(p.key)
    try { await downloadDocPdf(p.url, p.plik) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }) }
    finally { setBusy(null) }
  }, [app])
  const drukuj = useCallback(async () => {
    if (!zaznaczone.length) return
    setBusy('zaznaczone')
    try { await drukujZaznaczone(zaznaczone, nazwaZestawu) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się przygotować wydruku', detail: e instanceof Error ? e.message : '' }) }
    finally { setBusy(null) }
  }, [zaznaczone, nazwaZestawu, app])
  const zapisz = useCallback(async () => {
    if (!zaznaczone.length) return
    setBusy('zapis')
    try { await zapiszPapiery(zaznaczone, app) }
    finally { setBusy(null) }
  }, [zaznaczone, app])
  // Stały obiekt między renderami — moduły trzymają go w zależnościach `cmds`; nowy co render kręcił pętlę setCmds ↔ powłoka.
  return useMemo(() => ({ wybrane, zaznaczone, przelacz, ustaw, otworz, drukuj, zapisz, busy }), [wybrane, zaznaczone, przelacz, ustaw, otworz, drukuj, zapisz, busy])
}

export type ZaznaczonePapiery = ReturnType<typeof useZaznaczonePapiery>

/** Jeden papier: ptaszek „do wydruku” + przycisk otwierający sam ten dokument. */
export function PapierChip({ p, z, zablokowany }: { p: PapierKursu; z: ZaznaczonePapiery; zablokowany?: boolean }) {
  const opis = `${p.etykieta} ${p.numer}`.trim()
  return (
    <span className={`papier-chip${z.wybrane.has(p.key) ? ' on' : ''}`}>
      <input type="checkbox" className="cbx" checked={z.wybrane.has(p.key)} onChange={() => z.przelacz(p.key)} aria-label={`Zaznacz do wydruku: ${opis}`} />
      <button className="btn sm" disabled={!!z.busy || zablokowany} onClick={() => void z.otworz(p)}>
        <FileDown size={14} />{p.etykieta} {p.numer && <span className="code">{p.numer}</span>}</button>
    </span>
  )
}

/** „Drukuj zaznaczone (3)” — jeden PDF ze wszystkimi zaznaczonymi papierami. */
export function DrukujZaznaczone({ z, zablokowany }: { z: ZaznaczonePapiery; zablokowany?: boolean }) {
  const n = z.zaznaczone.length
  return (
    <button className="btn primary" disabled={!n || !!z.busy || zablokowany} onClick={() => void z.drukuj()}
      data-tip={n ? 'Okno druku ze wszystkimi zaznaczonymi — drukujesz raz' : 'Zaznacz ptaszkiem dokumenty do wydruku'}>
      <Printer size={15} />{z.busy === 'zaznaczone' ? 'Przygotowuję…' : `Drukuj zaznaczone${n ? ` (${n})` : ''}`}</button>
  )
}

/** „Zapisz zaznaczone PDF (3)” — każdy papier w osobnym pliku, od razu do Pobranych. */
export function ZapiszZaznaczone({ z, zablokowany }: { z: ZaznaczonePapiery; zablokowany?: boolean }) {
  const n = z.zaznaczone.length
  return (
    <button className="btn" disabled={!n || !!z.busy || zablokowany} onClick={() => void z.zapisz()}
      data-tip={n ? 'Każdy dokument w osobnym pliku PDF, od razu do folderu Pobrane' : 'Zaznacz ptaszkiem dokumenty do zapisu'}>
      <Download size={15} />{z.busy === 'zapis' ? 'Zapisuję…' : `Zapisz zaznaczone PDF${n ? ` (${n})` : ''}`}</button>
  )
}
