import { useCallback, useEffect, useRef, useState } from 'react'
import { ClipboardCheck, PenLine, Save, ThermometerSnowflake, Ban } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { receptionChecksApi, signaturesApi } from '@/lib/api'
import { checkIssues, checkStatus, needsCorrectiveAction, tempExceeded, type ReceptionCheck } from '@/features/raw-batches/receptionCheck'
import { progPrzyjecia } from '@/features/raw-batches/storageState'
import { SzkieletBloku } from '../../ui/Szkielet'

const PUSTY: ReceptionCheck = {
  receptionId: '', visual: null, tempChamber: null, tempMeat: null, kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null,
}
type CheckZeStanem = ReceptionCheck & { required?: boolean }
type Rola = 'wykonal' | 'sprawdzil'
interface Podpis { role: string; signerName: string; workerId?: string; signedAt?: string | null; png?: string; active?: boolean }

/** „2,5” → 2.5; pusty napis = BRAK pomiaru (null), nie zero — zero jest odczytem. */
export function parsujTemp(v: string): number | null {
  const s = v.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const tempDoPola = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','))
export const etykietaRoli = (r: string) => (r === 'wykonal' ? 'Wykonał (l)' : 'Sprawdził (m)')

function Ocena({ label, value, onChange, opcje }: { label: string; value: string | null; onChange: (v: string) => void; opcje: Array<{ v: string; t: string }> }) {
  return (
    <div className="fld"><span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {opcje.map(o => <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.t}</button>)}
      </div>
    </div>
  )
}

/**
 * Kontrola HACCP dostawy — kolumny f–m karty 1.1.1, port ReceptionCheckCard.
 * Osobny wpis (PUT /receptions/{id}/check), nie część dokumentu dostawy —
 * zapis dostawy przepisuje cały dokument i wyzerowałby temperatury.
 * Temperatury żyją jako TEKST pola (incydent 02.09.2026: „2,” zjadało przecinek
 * i z 2,3 °C robiło się 23 °C). Niezapisana zmiana BLOKUJE podpis — podpisuje
 * się treść z bazy, nie to, co widać w polu.
 */
export function KontrolaHaccp({ receptionId, category, storageState, cancelled, onSaved, onCancelReception }: {
  receptionId: string; category?: string; storageState?: string; cancelled?: boolean
  onSaved?: () => void; onCancelReception?: () => void
}) {
  const app = useApp()
  const [check, setCheck] = useState<CheckZeStanem | null>(null)
  const [tekst, setTekst] = useState({ chamber: '', meat: '' })
  const [brudny, setBrudny] = useState(false)
  const [zapisuje, setZapisuje] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [podpisy, setPodpisy] = useState<Podpis[]>([])
  const [podpisuje, setPodpisuje] = useState<Rola | null>(null)
  const [pytajZapis, setPytajZapis] = useState<Podpis[] | null>(null)

  const wczytajPodpisy = useCallback(() => {
    signaturesApi.forDoc('reception_check', receptionId).then(d => setPodpisy((d ?? []) as Podpis[])).catch(() => setPodpisy([]))
  }, [receptionId])
  useEffect(() => {
    let zywe = true
    setCheck(null); setBlad(null); setBrudny(false)
    receptionChecksApi.get(receptionId)
      .then(d => { if (!zywe) return; setCheck({ ...PUSTY, ...d, receptionId }); setTekst({ chamber: tempDoPola(d?.tempChamber), meat: tempDoPola(d?.tempMeat) }) })
      .catch(e => { if (zywe) setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać kontroli') })
    wczytajPodpisy()
    return () => { zywe = false }
  }, [receptionId, wczytajPodpisy])

  const lock = useRef(false)
  const zapisz = async (potwierdzone = false) => {
    if (!check || lock.current) return
    // Zapis zmieniający treść ZDEJMUJE ważne podpisy — nie po cichu.
    const wazne = podpisy.filter(x => x.active !== false)
    if (brudny && wazne.length && !potwierdzone) { setPytajZapis(wazne); return }
    setPytajZapis(null)
    lock.current = true; setZapisuje(true); setBlad(null)
    try {
      const d = await receptionChecksApi.save(receptionId, {
        visual: check.visual, tempChamber: check.tempChamber, tempMeat: check.tempMeat, kgMatch: check.kgMatch,
        notes: check.notes, verdict: check.verdict, ncDescription: check.ncDescription, ncAction: check.ncAction, ncAt: check.ncAt,
      })
      setCheck({ ...PUSTY, ...d, receptionId })
      // Po zapisie pole pokazuje to, co NAPRAWDĘ stoi w bazie: „2,” staje się „2”.
      setTekst({ chamber: tempDoPola(d?.tempChamber), meat: tempDoPola(d?.tempMeat) })
      setBrudny(false)
      wczytajPodpisy()
      app.toast({ kind: 'ok', title: 'Zapisano kontrolę HACCP', detail: checkStatus({ ...PUSTY, ...d }) === 'komplet' ? 'Karta 1.1.1 — komplet danych.' : 'Kontrola niepełna — uzupełnij brakujące pola.' })
      onSaved?.()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać kontroli')
    } finally { lock.current = false; setZapisuje(false) }
  }

  if (!check) return blad ? <div className="note crit">{blad}</div> : <SzkieletBloku linie={5} opis="Wczytywanie kontroli HACCP…" />

  const status = checkStatus(check)
  const uwagi = checkIssues(check, category, storageState)
  const prog = progPrzyjecia(category, storageState)
  const wymagana = check.required !== false
  const ustaw = <K extends keyof ReceptionCheck>(k: K, v: ReceptionCheck[K]) => { setCheck(c => (c ? { ...c, [k]: v } : c)); setBrudny(true) }
  const ustawTemp = (pole: 'tempChamber' | 'tempMeat', klucz: 'chamber' | 'meat', t: string) => { setTekst(x => ({ ...x, [klucz]: t })); ustaw(pole, parsujTemp(t)) }

  return (
    <div className="haccp">
      <div className="sect-h"><h3><ClipboardCheck size={16} style={{ verticalAlign: -3 }} /> Kontrola HACCP — karta 1.1.1</h3>
        <span className="sub">{status === 'komplet' ? 'komplet danych kontroli dostawy' : wymagana ? 'uzupełnij — bez tego wiersz karty ma dziurę' : 'dostawa sprzed wdrożenia — kontrola na papierze, uzupełnić można'}</span>
        {status !== 'komplet' && wymagana && <span className="tag warn">{status === 'brak' ? 'brak danych' : 'niepełne'}</span>}
      </div>
      <div className="box ov-card">
        <div className="haccp-grid">
          <Ocena label="Ocena wizualna, książka mycia pojazdu (f)" value={check.visual} onChange={v => ustaw('visual', v as ReceptionCheck['visual'])} opcje={[{ v: 'bz', t: 'b/z' }, { v: 'N', t: 'N' }]} />
          <Ocena label="Zgodność kg z zamówieniem i dokumentami (i)" value={check.kgMatch} onChange={v => ustaw('kgMatch', v as ReceptionCheck['kgMatch'])} opcje={[{ v: 'bz', t: 'b/z' }, { v: 'N', t: 'N' }]} />
          <label className="fld"><span className="label">Temperatura komory [°C] (g)</span>
            <input className={`field num${tempExceeded(check.tempChamber, category, storageState) ? ' invalid' : ''}`} inputMode="decimal" placeholder={prog.opis} value={tekst.chamber} onChange={e => ustawTemp('tempChamber', 'chamber', e.target.value)} /></label>
          <label className="fld"><span className="label">Temperatura mięsa [°C] (h)</span>
            <input className={`field num${tempExceeded(check.tempMeat, category, storageState) ? ' invalid' : ''}`} inputMode="decimal" placeholder={prog.opis} value={tekst.meat} onChange={e => ustawTemp('tempMeat', 'meat', e.target.value)} /></label>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}><ThermometerSnowflake size={13} style={{ verticalAlign: -2 }} /> Wpisuje się NAJWYŻSZY zmierzony odczyt (instrukcja 1.1), próg {prog.opis}.</p>
        <label className="fld"><span className="label">Uwagi (j)</span><input className="field" value={check.notes} onChange={e => ustaw('notes', e.target.value)} /></label>
        <Ocena label="Ocena całej dostawy (k)" value={check.verdict} onChange={v => ustaw('verdict', v as ReceptionCheck['verdict'])} opcje={[{ v: 'K', t: 'K — przyjęta' }, { v: 'N', t: 'N — odmowa przyjęcia' }]} />
        {check.verdict === 'N' && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Dostawa odrzucona — czy anulować przyjęcie i zdjąć surowiec ze stanu? Ten wpis zostaje niezależnie od decyzji (karta rejestruje też dostawy odrzucone).
          {onCancelReception && !cancelled && <div style={{ marginTop: 6 }}><button className="btn sm danger" onClick={onCancelReception}><Ban size={14} />Anuluj przyjęcie…</button></div>}</div></div>}
        {needsCorrectiveAction(check) && <div className="haccp-grid">
          <label className="fld"><span className="label">Opis niezgodności</span><input className="field" value={check.ncDescription} onChange={e => ustaw('ncDescription', e.target.value)} /></label>
          <label className="fld"><span className="label">Podjęte działanie korygujące</span><input className="field" value={check.ncAction} onChange={e => ustaw('ncAction', e.target.value)} /></label>
        </div>}
        {uwagi.map(u => <div key={u} className="note crit"><FlagIcon level="crit" size={15} /><div>{u}</div></div>)}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
        <div className="row-wrap">
          {/* Przekroczony próg NIE blokuje zapisu — dostawę odrzuconą trzeba zapisać z tym, co ją zdyskwalifikowało. */}
          <button className="btn primary" disabled={zapisuje} onClick={() => void zapisz()}><Save size={15} />{zapisuje ? 'Zapisywanie…' : 'Zapisz kontrolę'}</button>
          {brudny ? <span className="warn-ink" style={{ fontSize: 'var(--fs-sm)' }}>niezapisane zmiany</span> : <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>zapisane</span>}
        </div>
      </div>

      <div className="sect-h"><h3>Podpisy</h3><span className="sub">podpisuje pracownik swoim PIN-em; zmiana danych po podpisie unieważnia podpis</span></div>
      <div className="haccp-grid">
        {(['wykonal', 'sprawdzil'] as const).map(rola => {
          const p = podpisy.find(x => x.role === rola)
          const wazny = !!p && p.active !== false
          const kiedy = p?.signedAt ? new Date(p.signedAt).toLocaleString('pl-PL') : ''
          return (
            <div key={rola} className="box ov-card haccp-sign">
              <span className="label">{etykietaRoli(rola)}</span>
              {wazny && <>{p.png && <img src={p.png} alt="" />}<b>{p.signerName}</b><span className="muted">{kiedy}</span></>}
              {!wazny && p && <><s className="muted">{p.signerName}</s><span className="muted">{kiedy}</span><span className="warn-ink" style={{ fontSize: 'var(--fs-sm)' }}>Podpis unieważniony — dane zmieniono po podpisaniu.</span></>}
              {!wazny && <button className="btn sm" disabled={brudny} data-tip={brudny ? 'Najpierw zapisz zmiany — podpisuje się treść z bazy' : undefined} onClick={() => setPodpisuje(rola)}><PenLine size={14} />{p ? 'Podpisz ponownie' : 'Podpisz'}</button>}
            </div>
          )
        })}
      </div>
      {brudny && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Zapisz zmiany przed podpisaniem — podpisuje się treść z bazy, nie to, co widać w polu.</div></div>}

      {podpisuje && <PodpisDialog docId={receptionId} role={podpisuje}
        juzPodpisal={podpisy.find(x => x.role !== podpisuje && x.active !== false)?.workerId}
        onSigned={() => { wczytajPodpisy(); app.toast({ kind: 'ok', title: `Podpisano: ${etykietaRoli(podpisuje)}` }) }} onClose={() => setPodpisuje(null)} />}
      {pytajZapis && <Dialog title="Zapis unieważni podpisy" onClose={() => setPytajZapis(null)}
        footer={<><button className="btn" onClick={() => setPytajZapis(null)} data-autofocus>Wróć</button><button className="btn primary" onClick={() => void zapisz(true)}>Zapisz mimo to</button></>}>
        <p>Podpis dotyczy treści sprzed zmiany, więc straci ważność i trzeba będzie podpisać ponownie:</p>
        <ul>{pytajZapis.map(x => <li key={x.role}>{etykietaRoli(x.role)}: <b>{x.signerName}</b></li>)}</ul>
      </Dialog>}
    </div>
  )
}

const ROLA_OPIS: Record<Rola, string> = { wykonal: 'Wykonał — kto przyjął dostawę', sprawdzil: 'Sprawdził — kierownik albo technolog' }

/** Podpis z biura: osoba z listy uprawnionych + JEJ PIN (sam wybór z listy = cudzy podpis). */
export function PodpisDialog({ docId, role, juzPodpisal, onSigned, onClose }: {
  docId: string; role: Rola; juzPodpisal?: string; onSigned: () => void; onClose: () => void
}) {
  const [osoby, setOsoby] = useState<Array<{ id: string; name: string; png: string }> | null>(null)
  const [wybrany, setWybrany] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [blad, setBlad] = useState<string | null>(null)
  const [wysyla, setWysyla] = useState(false)
  const pinRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let zywe = true
    signaturesApi.eligible(role).then(d => { if (zywe) setOsoby((d ?? []) as Array<{ id: string; name: string; png: string }>) })
      .catch(e => { if (zywe) { setOsoby([]); setBlad(e instanceof Error ? e.message : 'Nie udało się wczytać listy') } })
    return () => { zywe = false }
  }, [role])
  const podpisz = () => {
    if (!wybrany || !pin || wysyla) return
    setWysyla(true); setBlad(null)
    signaturesApi.sign({ docType: 'reception_check', docId, role, workerId: wybrany, pin })
      .then(() => { onSigned(); onClose() })
      .catch(e => setBlad(e instanceof Error ? e.message : 'Nie udało się złożyć podpisu'))
      .finally(() => setWysyla(false))
  }
  return (
    <Dialog title="Podpis elektroniczny" icon={<PenLine size={20} />} onClose={() => { if (!wysyla) onClose() }}
      footer={<><button className="btn" onClick={onClose} disabled={wysyla}>Anuluj</button><button className="btn primary" disabled={!wybrany || !pin || wysyla} onClick={podpisz}>{wysyla ? 'Podpisuję…' : 'Podpisz'}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>{ROLA_OPIS[role]}</p>
      {osoby === null && <div className="note">Wczytywanie…</div>}
      {osoby !== null && osoby.length === 0 && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Brak osób z wzorem podpisu i uprawnieniem do tej roli. Wzór rysuje się na HMI rozbioru: przytrzymaj tytuł ekranu 3 s, kod <b>0099</b>, „Wzory podpisów”. Uprawnienie nadaje się w kartotece pracowników.</div></div>}
      {osoby && osoby.length > 0 && <>
        <div className="sign-list" role="listbox" aria-label="Kto podpisuje">
          {osoby.map(o => <button key={o.id} type="button" role="option" aria-selected={wybrany === o.id} className={`sign-opt${wybrany === o.id ? ' on' : ''}`} onClick={() => { setWybrany(o.id); setBlad(null); requestAnimationFrame(() => pinRef.current?.focus()) }}>
            <b>{o.name}</b>{o.png && <img src={o.png} alt="" />}</button>)}
        </div>
        {wybrany && juzPodpisal && wybrany === juzPodpisal && <div className="note warn"><FlagIcon level="warn" size={15} /><div>Uwaga: ta sama osoba podpisze wykonanie i sprawdzenie.</div></div>}
        <label className="fld"><span className="label">PIN podpisującego</span>
          <input ref={pinRef} className="field" type="password" inputMode="numeric" autoComplete="off" aria-label="PIN podpisującego" value={pin} placeholder="••••" onChange={e => { setPin(e.target.value); setBlad(null) }} onKeyDown={e => { if (e.key === 'Enter') podpisz() }} />
          <span className="sub">PIN wpisuje osoba podpisująca, nie biuro.</span></label>
      </>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
    </Dialog>
  )
}
