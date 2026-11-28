import React, { useEffect, useState } from 'react'
import { PanelBottom, PanelRight, Maximize2, Minimize2, X, ShieldCheck } from 'lucide-react'
import { useApp } from '../../shell/context'
import { vatUeApi, type VatUeHistoria, type VatUeWynik } from '@/lib/api'
import type { Client } from '@/lib/mockApi'
import type { Supplier } from '@/types'
import { VatUeBadge } from './VatUeBadge'
import { JEZYKI_HDI, czyUe, dataKrotka, krajZVat } from './model'

type Zakladka = 'dane' | 'dokumenty' | 'vat'

const krajK = (k: { country?: string; nip?: string }) => (k.country || krajZVat(k.nip ?? '')).toUpperCase()
const adres = (k: { address?: string; postalCode?: string; city?: string }) =>
  [k.address?.trim(), [k.postalCode?.trim(), k.city?.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ')

/** Wynik do plakietki z zapisanego w kartotece statusu (bez pytania VIES). */
export function wynikZKarty(c: Client): VatUeWynik | null {
  if (c.vatUeStatus !== 'aktywny' && c.vatUeStatus !== 'nieaktywny') return null
  return { clientId: c.id, vatNumber: c.nip ?? '', kraj: krajK(c), status: c.vatUeStatus, requestId: c.vatUeRequestId ?? '',
    checkedAt: c.vatUeCheckedAt ?? '', komunikat: '', ostatniPewny: null }
}

const Wiersz = ({ k, v }: { k: string; v?: React.ReactNode }) => (
  <><dt>{k}</dt><dd>{v === undefined || v === null || v === '' ? <span className="faint">—</span> : v}</dd></>
)

function Glowka({ tytul, pelna, kraj, maxed, onMax, onClose, extra }: { tytul: string; pelna: string; kraj: string; maxed: boolean; onMax: () => void; onClose: () => void; extra?: React.ReactNode }) {
  const app = useApp()
  return (
    <div className="dock-head">
      <div className="dock-id">
        <div className="l1"><h2>{tytul}</h2><span className="tag outline">{kraj}</span>{extra}</div>
        <div className="l2">{pelna}</div>
      </div>
      <div className="dock-actions">
        <button className="btn ghost icon" onClick={() => app.setPanel(app.panel === 'bok' ? 'dol' : 'bok')} aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'}>{app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
        <button className="btn ghost icon" onClick={onMax} aria-label={maxed ? 'Przywróć panel' : 'Powiększ panel'}>{maxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button className="btn ghost icon" onClick={onClose} aria-label="Zamknij panel (Esc)"><X size={17} /></button>
      </div>
    </div>
  )
}

/** Karta odbiorcy: dane firmy, ustawienia dokumentów i — dla UE — VAT UE z historią sprawdzeń. */
export function KartaOdbiorcy({ c, grupa, maxed, onMax, onClose, onZmiana }: {
  c: Client; grupa?: string; maxed: boolean; onMax: () => void; onClose: () => void; onZmiana: () => void
}) {
  const kraj = krajK(c)
  const ue = czyUe(kraj)
  const [zak, setZak] = useState<Zakladka>('dane')
  useEffect(() => { if (zak === 'vat' && !ue) setZak('dane') }, [c.id, ue, zak])
  const zak2 = zak === 'vat' && !ue ? 'dane' : zak
  const ZAK: Array<{ key: Zakladka; label: string }> = [{ key: 'dane', label: 'Dane firmy' }, { key: 'dokumenty', label: 'Dokumenty' }, ...(ue ? [{ key: 'vat' as const, label: 'VAT UE' }] : [])]
  const jezyk = JEZYKI_HDI.find(j => j.v === c.language)?.l
  return (
    <div className="kh-karta" aria-label="Karta kontrahenta">
      <Glowka tytul={c.displayName || c.name} pelna={c.name} kraj={kraj} maxed={maxed} onMax={onMax} onClose={onClose}
        extra={ue ? <VatUeBadge wynik={wynikZKarty(c)} /> : undefined} />
      <div className="dock-tabs" role="tablist">
        {ZAK.map(t => <button key={t.key} role="tab" className="dock-tab" aria-selected={zak2 === t.key} onClick={() => setZak(t.key)}>{t.label}</button>)}
      </div>
      <div className="dock-body" role="tabpanel"><div className="dock-pad">
        {zak2 === 'dane' && <dl className="kh-dl">
          <Wiersz k={ue ? 'VAT UE' : 'NIP'} v={c.nip ? <code>{c.nip}</code> : ''} />
          <Wiersz k="REGON" v={c.regon} />
          <Wiersz k="Adres" v={adres(c)} />
          <Wiersz k="Kraj" v={kraj} />
          <Wiersz k="Kontakt" v={[c.contactName, c.phone, c.email].filter(Boolean).join(' · ')} />
          <Wiersz k="Grupa odbiorców" v={grupa} />
          <Wiersz k="Kod" v={c.code} />
        </dl>}
        {zak2 === 'dokumenty' && <dl className="kh-dl">
          <Wiersz k="Język HDI" v={jezyk && c.language ? jezyk : 'z kraju'} />
          <Wiersz k="Nazwa pozycji HDI" v={c.hdiNameMode === 'type' ? 'sam rodzaj' : c.hdiNameMode === 'recipe' ? 'sama receptura' : 'rodzaj i receptura'} />
          <Wiersz k="Te same nazwy na WZ" v={c.wzUsesHdiNames === false ? 'nie' : 'tak'} />
          <Wiersz k="Własne nazwy receptur" v={(c.hdiRecipeNames ?? []).map(n => n.name).join(', ')} />
          <Wiersz k="Nadzór HALAL" v={c.halalSupervision ? 'tak' : 'nie'} />
          <Wiersz k="Produkcja na usługę" v={c.uslugi ? 'tak' : 'nie'} />
          <Wiersz k="Miejsce przeznaczenia" v={[c.destName, c.destAddress, c.destCity].filter(Boolean).join(', ')} />
        </dl>}
        {zak2 === 'vat' && <VatUeZakladka key={c.id} c={c} onZmiana={onZmiana} />}
      </div></div>
    </div>
  )
}

const KONTEKST: Record<string, string> = { kurs: 'kurs', wz: 'WZ z zamówienia', reczne: 'ręcznie', kartoteka: 'kartoteka' }
function opisKontekstu(h: VatUeHistoria): string {
  if (h.context === 'kurs') return h.plate ? `kurs ${h.plate}` : 'kurs'
  if (h.context === 'wz') return [h.wzNumber, h.orderNo].filter(Boolean).join(' · ') || 'WZ z zamówienia'
  return KONTEKST[h.context] ?? h.context
}
const STATUS: Record<string, string> = { aktywny: 'aktywny', nieaktywny: 'NIEAKTYWNY', blad: 'nie sprawdzono' }

function VatUeZakladka({ c, onZmiana }: { c: Client; onZmiana: () => void }) {
  const app = useApp()
  const [wynik, setWynik] = useState<VatUeWynik | null>(wynikZKarty(c))
  const [lad, setLad] = useState(false)
  const [hist, setHist] = useState<VatUeHistoria[] | null>(null)
  const wczytajHist = () => { vatUeApi.historia(c.id).then(setHist).catch(() => setHist([])) }
  useEffect(wczytajHist, [c.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const sprawdz = () => {
    setLad(true)
    vatUeApi.sprawdzKlienta(c.id, { context: 'reczne' })
      .then(w => { setWynik(w); onZmiana(); wczytajHist() })
      .catch(e => app.toast({ kind: 'warn', title: 'Nie udało się sprawdzić VAT UE', detail: e instanceof Error ? e.message : undefined }))
      .finally(() => setLad(false))
  }
  return (
    <div className="kh-vat">
      <div className="row-wrap">
        {wynik ? <VatUeBadge wynik={wynik} ladowanie={lad} onPonow={sprawdz} /> : <span className="muted">{lad ? 'Sprawdzam…' : 'Jeszcze nie sprawdzano w VIES.'}</span>}
        <button className="btn sm" onClick={sprawdz} disabled={lad}><ShieldCheck size={14} />Sprawdź teraz</button>
      </div>
      <p className="muted kh-vat-opis">Sprawdzamy przy każdej wysyłce: w papierach kursu i przy WZ z zamówienia. Nieaktywny VAT UE = ostrzeżenie i faktura z VAT 5 %.
        Numer potwierdzenia VIES to dowód dla urzędu przy stawce 0 %.</p>
      <table className="tbl kh-hist" aria-label="Historia sprawdzeń VAT UE">
        <thead><tr><th>Kiedy</th><th>Wynik</th><th>Numer potwierdzenia</th><th>Wysyłka</th><th>Kto</th></tr></thead>
        <tbody>
          {hist === null && <tr><td colSpan={5} className="muted">Wczytywanie…</td></tr>}
          {hist?.length === 0 && <tr><td colSpan={5} className="muted">Brak sprawdzeń.</td></tr>}
          {hist?.map(h => (
            <tr key={h.id} className="row">
              <td className="tnum">{dataKrotka(h.checkedAt)} {h.checkedAt ? new Date(h.checkedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : ''}</td>
              <td className={h.status === 'nieaktywny' ? 'crit-ink strong' : undefined} data-tip={h.error || undefined}>{STATUS[h.status] ?? h.status}</td>
              <td><code>{h.requestId || '—'}</code></td>
              <td>{opisKontekstu(h)}</td>
              <td className="muted">{h.operator || '—'}</td>
            </tr>))}
        </tbody>
      </table>
    </div>
  )
}

/** Karta dostawcy: dane firmy, WNI i zakres dostaw do wykazów HACCP. */
export function KartaDostawcy({ d, maxed, onMax, onClose }: { d: Supplier; maxed: boolean; onMax: () => void; onClose: () => void }) {
  const kraj = krajK(d)
  return (
    <div className="kh-karta" aria-label="Karta kontrahenta">
      <Glowka tytul={d.displayName || d.name} pelna={d.name} kraj={kraj} maxed={maxed} onMax={onMax} onClose={onClose} />
      <div className="dock-body"><div className="dock-pad">
        <dl className="kh-dl">
          <Wiersz k="NIP" v={d.nip ? <code>{d.nip}</code> : ''} />
          <Wiersz k="REGON" v={d.regon} />
          <Wiersz k="Adres" v={adres(d)} />
          <Wiersz k="Kraj" v={kraj} />
          <Wiersz k="WNI (numer weterynaryjny)" v={d.vetNumber} />
          <Wiersz k="Zakres dostaw" v={d.supplyScope} />
          <Wiersz k="Kontakt" v={[d.contactName, d.phone, d.email].filter(Boolean).join(' · ')} />
          <Wiersz k="Kod" v={d.code} />
        </dl>
      </div></div>
    </div>
  )
}
