import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Plus, Pencil, Trash2, RefreshCw, Search, ShieldAlert, Users, MapPin } from 'lucide-react'
import { useApp, CommandBar, Dialog, type Cmd } from '../../shell/context'
import { useDock } from '../../shell/useDock'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { useApi } from '@/hooks/useApi'
import { clientGroupsApi, clientsApi, suppliersApi } from '@/lib/api'
import type { Client } from '@/lib/mockApi'
import type { Supplier } from '@/types'
import { EdytorKontrahenta } from './EdytorKontrahenta'
import { KartaDostawcy, KartaOdbiorcy } from './Karta'
import { GrupyDialog } from './GrupyDialog'
import { PoprawAdresyDialog } from './PoprawAdresyDialog'
import { czyUe, dataKrotka, filtruj, krajZVat, pustyFormularz, zDostawcy, zKlienta, type Formularz, type Rodzaj } from './model'

/** Klucz, którym inne moduły (zamówienie, papiery kursu) otwierają kartę klienta. */
export const KLUCZ_WYBRANY = 'protrima.kontrahenci.wybrany'
export function otworzKontrahenta(openModule: (k: string) => void, clientId: string) {
  sessionStorage.setItem(KLUCZ_WYBRANY, clientId)
  window.dispatchEvent(new CustomEvent('protrima:kontrahent', { detail: clientId }))
  openModule('kontrahenci')
}

type FiltrVat = '' | 'nieaktywny' | 'niesprawdzony'
type Okno = { rodzaj: 'edytor'; start: Formularz; id?: string } | { rodzaj: 'usun'; id: string; nazwa: string } | { rodzaj: 'grupy' } | { rodzaj: 'adresy' } | null

const krajK = (k: { country?: string; nip?: string }) => (k.country || krajZVat(k.nip ?? '')).toUpperCase()

/**
 * Kontrahenci (PROTRIMA, 27.11.2026): kartoteka odbiorców i dostawców.
 * Pobieranie danych po NIP (GUS / wykaz VAT MF) i VAT UE (VIES) z rozpisanym
 * adresem, status VAT UE odbiorców z historią sprawdzeń, grupy odbiorców
 * i poprawa adresów w kartotece.
 */
export function KontrahenciModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const klienciRes = useApi(() => clientsApi.list())
  const dostawcyRes = useApi(() => suppliersApi.list())
  const grupyRes = useApi(() => clientGroupsApi.list())
  const [rodzaj, setRodzaj] = useState<Rodzaj>('odbiorcy')
  const [q, setQ] = useState('')
  const [filtrVat, setFiltrVat] = useState<FiltrVat>('')
  const [sel, setSel] = useState<string | null>(() => {
    const id = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KLUCZ_WYBRANY)
    if (id) sessionStorage.removeItem(KLUCZ_WYBRANY)
    return id
  })
  const [maxed, setMaxed] = useState(false)
  const [okno, setOkno] = useState<Okno>(null)
  const workRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dock = useDock(workRef, 'kontrahenci')

  // Moduł już otwarty, a ktoś kliknął klienta w zamówieniu — przejdź do jego karty.
  useEffect(() => {
    const h = (e: Event) => { const id = (e as CustomEvent<string>).detail; sessionStorage.removeItem(KLUCZ_WYBRANY); setRodzaj('odbiorcy'); setQ(''); setFiltrVat(''); setSel(id) }
    window.addEventListener('protrima:kontrahent', h)
    return () => window.removeEventListener('protrima:kontrahent', h)
  }, [])

  const klienci = useMemo(() => ((klienciRes.data ?? []) as Client[]).filter(c => c.active !== false), [klienciRes.data])
  const dostawcy = useMemo(() => ((dostawcyRes.data ?? []) as Supplier[]).filter(d => d.active !== false), [dostawcyRes.data])
  const grupaKlienta = useMemo(() => {
    const m = new Map<string, string>()
    ;(grupyRes.data ?? []).forEach(g => g.members.forEach(x => m.set(x.id, g.name)))
    return m
  }, [grupyRes.data])
  const sortNazwa = <T extends { name: string; displayName?: string }>(l: T[]) => l.slice().sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pl'))

  const widoczniKlienci = useMemo(() => sortNazwa(filtruj(klienci, q).filter(c => {
    if (!filtrVat) return true
    if (!czyUe(krajK(c))) return false
    return filtrVat === 'nieaktywny' ? c.vatUeStatus === 'nieaktywny' : c.vatUeStatus !== 'aktywny' && c.vatUeStatus !== 'nieaktywny'
  })), [klienci, q, filtrVat])
  const widoczniDostawcy = useMemo(() => sortNazwa(filtruj(dostawcy, q)), [dostawcy, q])
  const widoczne: Array<Client | Supplier> = rodzaj === 'odbiorcy' ? widoczniKlienci : widoczniDostawcy
  const wybranyK = rodzaj === 'odbiorcy' ? klienci.find(c => c.id === sel) ?? null : null
  const wybranyD = rodzaj === 'dostawcy' ? dostawcy.find(d => d.id === sel) ?? null : null
  const wybrany = wybranyK ?? wybranyD
  const nieaktywnych = klienci.filter(c => c.vatUeStatus === 'nieaktywny').length

  const odswiez = useCallback(() => { void klienciRes.refetch(); void dostawcyRes.refetch(); void grupyRes.refetch() }, [klienciRes, dostawcyRes, grupyRes])
  const nowy = useCallback(() => setOkno({ rodzaj: 'edytor', start: pustyFormularz() }), [])
  const edytuj = useCallback(() => {
    if (wybranyK) setOkno({ rodzaj: 'edytor', start: zKlienta(wybranyK), id: wybranyK.id })
    else if (wybranyD) setOkno({ rodzaj: 'edytor', start: zDostawcy(wybranyD), id: wybranyD.id })
  }, [wybranyK, wybranyD])

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'new', group: 1, label: rodzaj === 'odbiorcy' ? 'Nowy odbiorca' : 'Nowy dostawca', icon: <Plus size={17} />, kbd: 'Ctrl+N', primary: true, run: nowy },
    { id: 'edit', group: 2, label: 'Edytuj', icon: <Pencil size={17} />, kbd: 'F2', disabled: !wybrany, run: edytuj },
    ...(rodzaj === 'odbiorcy' ? [{ id: 'groups', group: 2, label: 'Grupy odbiorców', icon: <Users size={17} />, tip: 'Kilka spółek jednego kontrahenta — wspólna pula wyrobu', run: () => setOkno({ rodzaj: 'grupy' }) }] : []),
    { id: 'addresses', group: 2, label: 'Popraw adresy', icon: <MapPin size={17} />, tip: 'Propozycje poprawy zapisanych adresów (kod, wielkie litery, spacje) — do zatwierdzenia', run: () => setOkno({ rodzaj: 'adresy' }) },
    { id: 'deactivate', group: 3, label: 'Usuń z kartoteki', icon: <Trash2 size={17} />, disabled: !wybrany, tip: 'Dezaktywacja — dokumenty i historia zostają',
      run: () => wybrany && setOkno({ rodzaj: 'usun', id: wybrany.id, nazwa: wybrany.displayName || wybrany.name }) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: odswiez },
  ], [rodzaj, wybrany, nowy, edytuj, odswiez])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Odbiorcy <b>{klienci.length}</b> · dostawcy <b>{dostawcy.length}</b>{nieaktywnych ? <> · VAT UE nieaktywny <b className="crit-ink">{nieaktywnych}</b></> : null}</span>)
  }, [active, klienci.length, dostawcy.length, nieaktywnych, setCtx])

  useEffect(() => {
    if (!active || okno) return
    const key = (e: KeyboardEvent) => {
      const wPolu = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName ?? '')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); nowy() }
      else if (e.key === 'F2' && wybrany) { e.preventDefault(); edytuj() }
      else if (e.key === 'Escape' && sel && !wPolu) { e.preventDefault(); setSel(null) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, okno, wybrany, sel, nowy, edytuj])

  const wybierz = (id: string) => { setSel(id); requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })) }
  const naLiscie = (e: React.KeyboardEvent) => {
    const i = widoczne.findIndex(r => r.id === sel)
    if (e.key === 'ArrowDown') { e.preventDefault(); const r = widoczne[Math.min(widoczne.length - 1, i + 1)]; if (r) wybierz(r.id) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const r = widoczne[Math.max(0, i - 1)]; if (r) wybierz(r.id) }
    else if (e.key === 'Enter' && wybrany) { e.preventDefault(); edytuj() }
  }
  const naSzukaniu = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && widoczne[0]) { e.preventDefault(); wybierz(widoczne[0].id); listRef.current?.focus() }
    else if (e.key === 'Enter' && widoczne.length === 1) { e.preventDefault(); wybierz(widoczne[0].id) }
    else if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ('') }
  }
  const zmienRodzaj = (r: Rodzaj) => { setRodzaj(r); setSel(null); setFiltrVat('') }

  const res = rodzaj === 'odbiorcy' ? klienciRes : dostawcyRes
  const ladowanie = res.loading && !res.data
  const filtry = !!(q || filtrVat)
  const COLS = 6

  const usun = async (id: string, nazwa: string) => {
    try {
      if (rodzaj === 'odbiorcy') await clientsApi.deactivate(id); else await suppliersApi.delete(id)
      app.toast({ kind: 'ok', title: `Usunięto „${nazwa}” z kartoteki`, detail: 'Dokumenty i historia zostają.' })
      setOkno(null); setSel(null); odswiez()
    } catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się usunąć', detail: e instanceof Error ? e.message : undefined }) }
  }

  return (
    <>
      <CommandBar title="Kontrahenci" count={rodzaj === 'odbiorcy' ? 'odbiorcy — kartoteka i VAT UE' : 'dostawcy — kartoteka i wykazy HACCP'} cmds={cmds} />
      <div className="toolbar" role="toolbar" aria-label="Widoki i filtry kontrahentów">
        <div className="seg" role="group" aria-label="Rodzaj kontrahenta">
          <button type="button" aria-pressed={rodzaj === 'odbiorcy'} onClick={() => zmienRodzaj('odbiorcy')}>Odbiorcy<span className="count">{klienci.length}</span></button>
          <button type="button" aria-pressed={rodzaj === 'dostawcy'} onClick={() => zmienRodzaj('dostawcy')}>Dostawcy<span className="count">{dostawcy.length}</span></button>
        </div>
        <span className="vsep" />
        <div className="field-wrap search">
          <Search size={15} />
          <input ref={searchRef} className="field" placeholder="Nazwa, NIP albo miasto…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={naSzukaniu} aria-label="Szukaj kontrahenta" />
          {!q && <span className="kbd">Ctrl F</span>}
        </div>
        {rodzaj === 'odbiorcy' && <>
          <button className={`chip${filtrVat === 'nieaktywny' ? ' on' : ''}`} onClick={() => setFiltrVat(v => (v === 'nieaktywny' ? '' : 'nieaktywny'))} aria-pressed={filtrVat === 'nieaktywny'}>
            <ShieldAlert size={13} />VAT UE nieaktywny{nieaktywnych ? ` (${nieaktywnych})` : ''}</button>
          <button className={`chip${filtrVat === 'niesprawdzony' ? ' on' : ''}`} onClick={() => setFiltrVat(v => (v === 'niesprawdzony' ? '' : 'niesprawdzony'))} aria-pressed={filtrVat === 'niesprawdzony'}>
            VAT UE nie sprawdzony</button>
        </>}
        {filtry && <button className="btn sm ghost" onClick={() => { setQ(''); setFiltrVat('') }}>Wyczyść filtry</button>}
      </div>

      <div className={`workarea${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane" style={dock.listStyle(!!wybrany, maxed)}>
          <div className="tbl-wrap" ref={listRef} tabIndex={0} onKeyDown={naLiscie}>
            <table className="tbl kh-lista" role="grid" aria-label="Lista kontrahentów">
              <thead><tr>
                <th>Kontrahent</th><th className="c" style={{ width: 56 }}>Kraj</th><th>{rodzaj === 'odbiorcy' ? 'NIP / VAT UE' : 'NIP'}</th><th>Miasto</th>
                {rodzaj === 'odbiorcy' ? <><th>VAT UE</th><th className="hide-m">Grupa</th></> : <><th>WNI</th><th className="hide-m">Zakres dostaw</th></>}
              </tr></thead>
              <tbody>
                {ladowanie && <SzkieletWierszy kolumny={COLS} wiersze={6} />}
                {res.error && !ladowanie && <tr><td colSpan={COLS}><Pusto ikona={<Building2 size={20} />} tytul="Nie udało się pobrać kartoteki"
                  akcja={<button className="btn sm" onClick={odswiez}>Spróbuj ponownie</button>}>{res.error}</Pusto></td></tr>}
                {!ladowanie && !res.error && widoczne.length === 0 && <tr><td colSpan={COLS}>
                  {filtry ? <Pusto ikona={<Search size={20} />} tytul="Nikt nie pasuje" akcja={<button className="btn sm" onClick={() => { setQ(''); setFiltrVat('') }}>Wyczyść filtry</button>}>Szukamy w nazwie, nazwie wyświetlanej, NIP-ie i mieście.</Pusto>
                    : <Pusto ikona={<Building2 size={20} />} tytul={rodzaj === 'odbiorcy' ? 'Brak odbiorców' : 'Brak dostawców'} akcja={<button className="btn sm primary" onClick={nowy}><Plus size={14} />Dodaj</button>}>Wpisz NIP albo VAT UE — dane firmy pobierzemy z rejestru.</Pusto>}
                </td></tr>}
                {widoczne.map((k, i) => {
                  const kraj = krajK(k)
                  const c = rodzaj === 'odbiorcy' ? k as Client : null
                  const d = rodzaj === 'dostawcy' ? k as Supplier : null
                  return (
                    <tr key={k.id} data-id={k.id} className={`row${i % 2 ? ' zebra' : ''}${sel === k.id ? ' sel' : ''}`} aria-selected={sel === k.id}
                      onClick={() => setSel(k.id)} onDoubleClick={() => { setSel(k.id); setOkno({ rodzaj: 'edytor', start: c ? zKlienta(c) : zDostawcy(d!), id: k.id }) }}>
                      <td className="ell" style={{ maxWidth: 360 }}>
                        {k.displayName ? <><b>{k.displayName}</b><div className="sub ell">{k.name}</div></> : <b>{k.name}</b>}
                      </td>
                      <td className="c"><span className="tag outline">{kraj}</span></td>
                      <td className="code">{k.nip || <span className="faint">—</span>}</td>
                      <td className="ell" style={{ maxWidth: 220 }}>{[k.postalCode?.trim(), k.city?.trim()].filter(Boolean).join(' ') || <span className="faint">—</span>}</td>
                      {c && <><td><StatusVat c={c} kraj={kraj} /></td><td className="hide-m">{grupaKlienta.get(c.id) ?? <span className="faint">—</span>}</td></>}
                      {d && <><td className="code">{d.vetNumber || <span className="faint">—</span>}</td><td className="hide-m ell" style={{ maxWidth: 240 }}>{d.supplyScope || <span className="faint">—</span>}</td></>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        {wybrany && <>
          <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'}
            onMouseDown={e => { setMaxed(false); dock.startDrag(e) }} onDoubleClick={() => { dock.reset(); setMaxed(false) }} />
          <div className="dock" aria-label="Szczegóły kontrahenta">
            {wybranyK && <KartaOdbiorcy c={wybranyK} grupa={grupaKlienta.get(wybranyK.id)} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(null)} onZmiana={() => void klienciRes.refetch()} />}
            {wybranyD && <KartaDostawcy d={wybranyD} maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setSel(null)} />}
          </div>
        </>}
      </div>

      {okno?.rodzaj === 'edytor' && <EdytorKontrahenta rodzaj={rodzaj} start={okno.start} id={okno.id} onClose={() => setOkno(null)}
        onZapisany={row => {
          app.toast({ kind: 'ok', title: okno.id ? `Zapisano „${row.displayName || row.name}”` : `Dodano „${row.displayName || row.name}”` })
          setOkno(null); setSel(row.id); odswiez()
        }} />}
      {okno?.rodzaj === 'usun' && <Dialog title={`Usunąć „${okno.nazwa}” z kartoteki?`} icon={<Trash2 size={20} />} onClose={() => setOkno(null)}
        footer={<><button className="btn" data-autofocus onClick={() => setOkno(null)}>Wróć</button><button className="btn danger" onClick={() => void usun(okno.id, okno.nazwa)}>Usuń z kartoteki</button></>}>
        <p>Kontrahent zniknie z list wyboru. Wystawione dokumenty, zamówienia i historia zostają bez zmian.</p>
      </Dialog>}
      {okno?.rodzaj === 'grupy' && <GrupyDialog klienci={klienci} onClose={() => { setOkno(null); void grupyRes.refetch() }} />}
      {okno?.rodzaj === 'adresy' && <PoprawAdresyDialog onClose={() => setOkno(null)} onZastosowano={() => { setOkno(null); odswiez() }} />}
    </>
  )
}

function StatusVat({ c, kraj }: { c: Client; kraj: string }) {
  if (!czyUe(kraj)) return <span className="faint">{kraj === 'PL' ? '—' : 'poza UE'}</span>
  if (c.vatUeStatus === 'aktywny') return <span className="kh-vu ok"><i />{`aktywny ${dataKrotka(c.vatUeCheckedAt)}`}</span>
  if (c.vatUeStatus === 'nieaktywny') return <span className="kh-vu bad"><i />{`nieaktywny ${dataKrotka(c.vatUeCheckedAt)}`}</span>
  return <span className="kh-vu"><i />nie sprawdzono</span>
}
