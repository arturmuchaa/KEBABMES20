import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FilePlus2, Printer, Save, Tags, Trash2 } from 'lucide-react'
import { useApp, CommandBar, type Cmd } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { useApi } from '@/hooks/useApi'
import { clientsApi, labelDesignsApi, productTypesApi, recipesApi, type LabelDesign, type LabelDesignSummary, type LabelField } from '@/lib/api'
import { useStudioHistory } from '@/features/labels/useStudioHistory'
import { drukujEtykiety, opisBledu } from '../../drukarka/drukarka'
import { drukuj } from '@/lib/print'
import { KROK_MM, PRZYKLAD, przesun } from './model'
import { profilRolki, zplSzablonu } from './zpl'
import { ListaSzablonow } from './ListaSzablonow'
import { Plotno } from './Plotno'
import { PanelPola, type Zakladka } from './PanelPola'
import { NowySzablon } from './NowySzablon'

const BEZ_POL: LabelField[] = []
const BEZ_SLOTU2: Record<string, LabelField> = {}
const odcisk = (d: LabelDesign | null) => (d ? JSON.stringify({ ...d, updatedAt: null, updatedBy: null }) : '')

/**
 * Projektor etykiet kebabów (spec 2026-11-27-projektor-etykiet-design.md).
 *
 * Właściciel: „daję nakładkę PDF, wczytuje się podgląd, ustawiam pola i zapisuję,
 * a potem na te pola wczytują się odpowiednie dane”. Lewa kolumna — szablony
 * klientów, środek — etykieta 1:1 z polami przeciąganymi myszą, prawa — pole,
 * przypisanie (klient, rodzaj, receptura) i ustawienia druku. Strzałki 0,5 mm
 * (Shift 5 mm), Delete, Ctrl+Z / Ctrl+Shift+Z, Ctrl+S.
 */
export function EtykietyModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const [lista, setLista] = useState<LabelDesignSummary[]>([])
  const [projekt, setProjekt] = useState<LabelDesign | null>(null)
  const [zapisany, setZapisany] = useState('')
  const [sel, setSel] = useState<{ id: string; slot: 0 | 1 } | null>(null)
  const [zakladka, setZakladka] = useState<Zakladka>('pole')
  const [nowy, setNowy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [zajety, setZajety] = useState(false)
  const [przeciaga, setPrzeciaga] = useState(false)
  const [szukaj, setSzukaj] = useState('')

  const klienciRes = useApi(() => clientsApi.list())
  const rodzajeRes = useApi(() => productTypesApi.list())
  const recepturyRes = useApi(() => recipesApi.list())
  const klienci = useMemo(() => ((klienciRes.data ?? []) as Array<{ id: string; name: string; displayName?: string }>)
    .map(k => ({ id: k.id, label: k.displayName || k.name, sub: k.displayName && k.displayName !== k.name ? k.name : undefined }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pl')), [klienciRes.data])
  const rodzaje = useMemo(() => ((rodzajeRes.data ?? []) as Array<{ id: string; name: string }>).map(r => ({ id: r.id, label: r.name })), [rodzajeRes.data])
  const receptury = useMemo(() => ((recepturyRes.data ?? []) as Array<{ id: string; name: string }>).map(r => ({ id: r.id, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pl')), [recepturyRes.data])

  const wczytajListe = useCallback(async () => {
    try { setLista(await labelDesignsApi.list()) } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { void wczytajListe() }, [wczytajListe])

  const zmieniony = !!projekt && odcisk(projekt) !== zapisany
  const ustaw = (zm: Partial<LabelDesign>) => setProjekt(p => (p ? { ...p, ...zm } : p))

  // Cofanie/ponawianie pól (przeciąganie = jeden krok).
  const historia = useStudioHistory(
    { fields: projekt?.fields ?? BEZ_POL, slot2Fields: projekt?.slot2Fields ?? BEZ_SLOTU2 } as Record<string, unknown>,
    s => ustaw({ fields: s.fields as LabelField[], slot2Fields: s.slot2Fields as Record<string, LabelField> }),
    projekt?.id ?? (projekt ? 'nowy' : 'brak'), przeciaga)

  const otworz = async (id: string) => {
    if (zmieniony && projekt?.id === id) return
    setBlad(null)
    try {
      const d = await labelDesignsApi.get(id)
      setProjekt(d); setZapisany(odcisk(d)); setSel(null); setZakladka('pole')
    } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }

  const zmienPole = useCallback((id: string, slot: 0 | 1, zm: Partial<LabelField>) => {
    setProjekt(p => {
      if (!p) return p
      if (slot === 1 && ('xMm' in zm || 'yMm' in zm)) {
        const baza = p.fields.find(f => f.id === id)
        if (!baza) return p
        const obecne = p.slot2Fields[id] ?? { ...baza, xMm: baza.xMm + (p.slotOffset?.dxMm ?? 105), yMm: baza.yMm + (p.slotOffset?.dyMm ?? 0) }
        return { ...p, slot2Fields: { ...p.slot2Fields, [id]: { ...obecne, ...zm } } }
      }
      return { ...p, fields: p.fields.map(f => (f.id === id ? { ...f, ...zm } : f)) }
    })
  }, [])

  const usunPole = useCallback((id: string) => {
    setProjekt(p => {
      if (!p) return p
      const { [id]: _pominiete, ...reszta } = p.slot2Fields
      return { ...p, fields: p.fields.filter(f => f.id !== id), slot2Fields: reszta }
    })
    setSel(null)
  }, [])

  const zapisz = useCallback(async (): Promise<boolean> => {
    if (!projekt || zajety) return false
    if (!projekt.clientId) { setBlad('Wybierz klienta w zakładce Przypisanie — szablon zawsze należy do klienta'); setZakladka('przypisanie'); return false }
    setZajety(true); setBlad(null)
    try {
      const nazwaKl = klienci.find(k => k.id === projekt.clientId)?.label ?? ''
      const dane = { ...projekt, name: projekt.name.trim() || `${nazwaKl} · ${projekt.printMode === 'a4' ? 'A4' : 'Zebra'}` }
      const { id } = await labelDesignsApi.save(dane)
      const zapisane = { ...dane, id }
      setProjekt(zapisane); setZapisany(odcisk(zapisane))
      await wczytajListe()
      app.toast({ kind: 'ok', title: `Zapisano szablon ${dane.name}` })
      return true
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e)); return false
    } finally { setZajety(false) }
  }, [projekt, zajety, klienci, wczytajListe, app])

  const probnyDruk = useCallback(async () => {
    if (!projekt || zajety) return
    setZajety(true); setBlad(null)
    try {
      const sztuka = { ...PRZYKLAD, clientName: klienci.find(k => k.id === projekt.clientId)?.label ?? PRZYKLAD.clientName }
      if (projekt.printMode === 'zebra') {
        await drukujEtykiety([zplSzablonu(projekt, sztuka, { razem: 29, orgCode: 'HAL-0000' })], profilRolki(projekt))
      } else {
        const { zbudujPdfA4 } = await import('./pdfA4')
        const pdfBase64 = await zbudujPdfA4(projekt, projekt.labelsPerSheet === 2 ? [sztuka, { ...sztuka, id: 'przyklad2', qrSeq: 4 }] : [sztuka],
          { orgCode: 'HAL-0000', razem: { '': 29 } })
        await drukuj({ rodzaj: 'etykiety', tytul: `Próbny wydruk — ${projekt.name || 'szablon etykiety'}`, pdfBase64 })
      }
    } catch (e) { setBlad(await opisBledu(e)) } finally { setZajety(false) }
  }, [projekt, zajety, klienci])

  const usunSzablon = useCallback(async () => {
    if (!projekt?.id) { setProjekt(null); return }
    try {
      await labelDesignsApi.remove(projekt.id)
      setProjekt(null); setZapisany(''); setSel(null)
      await wczytajListe()
      app.toast({ kind: 'ok', title: 'Usunięto szablon' })
    } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }, [projekt, wczytajListe, app])

  // Klawiatura projektora (poza polami formularza).
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void zapisz(); return }
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) historia.redo(); else historia.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); historia.redo(); return }
      if (!projekt || !sel) return
      const pole = sel.slot === 1 ? (projekt.slot2Fields[sel.id] ?? null) : projekt.fields.find(f => f.id === sel.id) ?? null
      const baza = projekt.fields.find(f => f.id === sel.id)
      if (!baza) return
      const krok = e.shiftKey ? 5 : KROK_MM
      const ruch: Record<string, [number, number]> = { ArrowLeft: [-krok, 0], ArrowRight: [krok, 0], ArrowUp: [0, -krok], ArrowDown: [0, krok] }
      if (ruch[e.key]) {
        e.preventDefault()
        const zrodlo = pole ?? { ...baza, xMm: baza.xMm + (sel.slot ? projekt.slotOffset.dxMm : 0), yMm: baza.yMm + (sel.slot ? projekt.slotOffset.dyMm : 0) }
        const p = przesun(zrodlo, ruch[e.key][0], ruch[e.key][1], projekt)
        zmienPole(sel.id, sel.slot, { xMm: p.xMm, yMm: p.yMm })
      } else if (e.key === 'Delete' && sel.slot === 0) {
        e.preventDefault(); usunPole(sel.id)
      } else if (e.key === 'Escape') {
        setSel(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, zapisz, historia, projekt, sel, zmienPole, usunPole])

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'new', label: 'Nowy szablon', icon: <FilePlus2 size={17} />, kbd: 'Ctrl+N', group: 1, run: () => setNowy(true) },
    { id: 'save', label: zajety ? 'Zapisuję…' : zmieniony ? 'Zapisz' : 'Zapisany', icon: <Save size={17} />, kbd: 'Ctrl+S', group: 1, primary: zmieniony,
      disabled: !projekt || zajety, run: () => { void zapisz() } },
    { id: 'test', label: 'Próbny druk', icon: <Printer size={17} />, group: 2, disabled: !projekt || zajety,
      tip: 'Etykieta z przykładowymi danymi — A4 przez okno druku, Zebra prosto na drukarkę', run: () => { void probnyDruk() } },
    { id: 'delete', label: 'Usuń szablon', icon: <Trash2 size={17} />, group: 3, disabled: !projekt, opt: true, run: () => { void usunSzablon() } },
  ], [zajety, zmieniony, projekt, zapisz, probnyDruk, usunSzablon])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => { if (active) setCtx(<span>{lista.length} szablonów</span>) }, [active, lista.length, setCtx])

  const wybranePole = projekt && sel ? (projekt.fields.find(f => f.id === sel.id) ?? null) : null

  return (
    <>
      <CommandBar title="Etykiety" count={projekt ? (projekt.name || 'nowy szablon') : `${lista.length} szablonów`} cmds={cmds} showKbd={false} />
      <div className={`et-uklad${projekt ? '' : ' bez-panelu'}`}>
        <ListaSzablonow lista={lista} wybranyId={projekt?.id ?? null} szukaj={szukaj} onSzukaj={setSzukaj} onWybierz={id => void otworz(id)} onNowy={() => setNowy(true)} />
        <section className="et-srodek" aria-label="Etykieta">
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
          {zmieniony && <div className="et-pasek"><span className="tag warn">niezapisane zmiany</span><span className="muted">Ctrl+S — zapisz · Ctrl+Z — cofnij</span></div>}
          {projekt
            ? <Plotno projekt={projekt} sel={sel} onSel={setSel} onZmien={zmienPole} onPrzeciaganie={setPrzeciaga} />
            : <Pusto ikona={<Tags size={22} />} tytul="Wybierz szablon albo załóż nowy"
                akcja={<button className="btn primary" onClick={() => setNowy(true)}><FilePlus2 size={15} />Nowy szablon</button>}>
                Szablon to Twoja etykieta z PDF albo z ZebraDesigner. Na niej ustawiasz pola, które system wypełni przy druku: wagę, partię, daty i kod QR.
              </Pusto>}
        </section>
        {projekt && <PanelPola projekt={projekt} pole={wybranePole} slot={sel?.slot ?? 0} zakladka={zakladka} onZakladka={setZakladka}
          klienci={klienci} rodzaje={rodzaje} receptury={receptury}
          onProjekt={ustaw} onPole={zm => sel && zmienPole(sel.id, sel.slot, zm)} onUsunPole={() => sel && usunPole(sel.id)}
          onDodane={f => { ustaw({ fields: [...projekt.fields, f] }); setSel({ id: f.id, slot: 0 }); setZakladka('pole') }} />}
      </div>
      {nowy && <NowySzablon onClose={() => setNowy(false)} onGotowy={d => { setProjekt(d); setZapisany(''); setSel(null); setZakladka('pole'); setNowy(false) }} />}
    </>
  )
}
