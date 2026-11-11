import React, { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { rozliczeniaApi } from '@/lib/api'
import { FORMA_SLOWEM, type Forma, type Karta } from './model'
import { OdmowaSerwera, Segment, naEnter, useZapis } from './wspolne'

const WALUTY = [['PLN', 'PLN'], ['EUR', 'EUR']] as const
const FORMY = [['gotowka', 'Gotówka'], ['przelew', 'Przelew']] as const
const BLAD_TERMINU = 'Termin to liczba dni od 0 do 365'
const dni = (x: number) => (x === 1 ? '1 dzień' : `${x} dni`)
const termin = (t: string) => (/^\d{1,3}$/.test(t.trim()) && Number(t) <= 365 ? Number(t) : NaN)
const forma = (f: string, zast: Forma): Forma => (f === 'gotowka' || f === 'przelew' ? f : zast)

/**
 * Ustawienia rozliczeń kontrahenta: waluta salda, domyślne terminy i formy
 * płatności WZ i faktur. Nowe ustawienia dotyczą dokumentów dodanych później.
 */
export function UstawieniaKlientaDialog({ karta, onClose, onZapisano }: { karta: Karta; onClose: () => void; onZapisano: () => void }) {
  const app = useApp()
  const k = karta.klient
  const [waluta, setWaluta] = useState(k.waluta === 'EUR' ? 'EUR' : 'PLN')
  const [terminWz, setTerminWz] = useState(String(k.terminWz))
  const [terminFv, setTerminFv] = useState(String(k.terminFv))
  const [formaWz, setFormaWz] = useState<Forma>(forma(k.formaWz, 'gotowka'))
  const [formaFv, setFormaFv] = useState<Forma>(forma(k.formaFv, 'przelew'))
  const zapis = useZapis('Nie udało się zapisać ustawień')

  const tWz = termin(terminWz), tFv = termin(terminFv)
  const bledne = Number.isNaN(tWz) || Number.isNaN(tFv)
  const zmiany: Record<string, string | number> = {}
  if (waluta !== k.waluta) zmiany.waluta = waluta
  if (!Number.isNaN(tWz) && tWz !== k.terminWz) zmiany.termin_wz = tWz
  if (!Number.isNaN(tFv) && tFv !== k.terminFv) zmiany.termin_fv = tFv
  if (formaWz !== k.formaWz) zmiany.forma_wz = formaWz
  if (formaFv !== k.formaFv) zmiany.forma_fv = formaFv
  const ok = !bledne && Object.keys(zmiany).length > 0
  const tip = bledne ? BLAD_TERMINU : ok ? undefined : 'Nic nie zmieniono'
  const maDokumenty = karta.dokumenty.wz.some(d => !d.otwarcie) || karta.dokumenty.fv.some(d => !d.otwarcie)
    || karta.wplaty.length > 0 || !!karta.otwarcia.wz || !!karta.otwarcia.fv
  const podpowiedz = k.walutaPodpowiedz && k.walutaPodpowiedz !== waluta ? k.walutaPodpowiedz : null

  const zapisz = () => {
    if (!ok) return
    void zapis.zapisz(async () => {
      await rozliczeniaApi.ustawKlienta(k.id, zmiany)
      const co = [
        'waluta' in zmiany && `waluta ${zmiany.waluta}`,
        'termin_wz' in zmiany && `termin WZ ${dni(tWz)}`, 'termin_fv' in zmiany && `termin FV ${dni(tFv)}`,
        'forma_wz' in zmiany && `WZ: ${FORMA_SLOWEM[formaWz]}`, 'forma_fv' in zmiany && `FV: ${FORMA_SLOWEM[formaFv]}`,
      ].filter(Boolean).join(' · ')
      app.toast({ kind: 'ok', title: `Ustawienia ${k.nazwa} zapisane`, detail: co })
      onZapisano()
    })
  }

  const pole = (label: string, v: string, set: (t: string) => void) => {
    const zly = Number.isNaN(termin(v))
    return (
      <label className="fld"><span className="label">Termin płatności</span>
        <span className="rr-kwota-pole">
          <input className={`field num${zly ? ' invalid' : ''}`} inputMode="numeric" value={v} aria-label={label} aria-invalid={zly || undefined}
            onChange={e => set(e.target.value)} onFocus={e => e.currentTarget.select()} onKeyDown={naEnter(zapisz)} />
          <span className="rr-sfx" aria-hidden="true">dni</span>
        </span>
        {zly && <span className="rr-pole-blad">{BLAD_TERMINU}</span>}
      </label>
    )
  }

  return (
    <Dialog icon={<Settings2 size={20} />} onClose={onClose}
      title={<>Ustawienia <span className="rr-dlg-klient">{k.nazwa}</span></>}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={tip} onClick={zapisz}>
          {zapis.busy ? 'Zapisuję…' : 'Zapisz ustawienia'}
        </button>
      </>}>
      <div className="fld"><span className="label">Waluta rozliczeń</span>
        <Segment label="Waluta" value={waluta} opcje={WALUTY} onChange={setWaluta} autofocus />
        {podpowiedz && (
          <span className="rr-pole-pod">NIP wskazuje na {podpowiedz} · <button type="button" className="rr-link" onClick={() => setWaluta(podpowiedz)}>{`ustaw ${podpowiedz}`}</button></span>
        )}
      </div>
      {waluta !== k.waluta && maDokumenty && (
        <div className="note warn"><FlagIcon level="warn" size={15} />
          <div><b>Dokumenty w dotychczasowej walucie przestaną się liczyć do salda.</b> Zostaną pokazane jako „w innej walucie” — bez przeliczania kursów.</div>
        </div>
      )}
      <div className="rr-ust">
        <section className="rr-otw-k" aria-label="WZ">
          <h3>WZ</h3>
          {pole('Termin WZ (dni)', terminWz, setTerminWz)}
          <div className="fld"><span className="label">Forma płatności</span><Segment label="Forma WZ" value={formaWz} opcje={FORMY} onChange={setFormaWz} /></div>
        </section>
        <section className="rr-otw-k" aria-label="Faktury">
          <h3>Faktury</h3>
          {pole('Termin FV (dni)', terminFv, setTerminFv)}
          <div className="fld"><span className="label">Forma płatności</span><Segment label="Forma FV" value={formaFv} opcje={FORMY} onChange={setFormaFv} /></div>
        </section>
      </div>
      <p className="muted rr-dlg-p">Terminy i formy dotyczą dokumentów dodanych od teraz — istniejących nie zmieniają (te zmienisz w szczegółach dokumentu).</p>
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}
