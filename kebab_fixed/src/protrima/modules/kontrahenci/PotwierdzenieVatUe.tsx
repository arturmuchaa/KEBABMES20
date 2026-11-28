import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, ShieldCheck } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { useApi } from '@/hooks/useApi'
import { settingsApi, vatUeApi, type VatUeHistoria, type VatUeWynik } from '@/lib/api'
import { drukuj } from '@/lib/print'

const KONTEKST: Record<string, string> = { reczne: 'ręcznie', kartoteka: 'kartoteka', wz: 'wystawienie WZ', kurs: 'papiery kursu' }
const czas = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }

/** Zapis sprawdzenia z historii: ten z numerem potwierdzenia wyniku, inaczej ostatni aktywny. */
function wpis(h: VatUeHistoria[] | null, w: VatUeWynik): VatUeHistoria | null {
  if (!h) return null
  return h.find(x => x.requestId && x.requestId === w.requestId) ?? h.find(x => x.status === 'aktywny') ?? null
}

/**
 * Potwierdzenie weryfikacji VAT UE w VIES (28.11.2026): na dokumentach widać tylko
 * „VAT UE aktywny”, a numer potwierdzenia i wydruk są tu — dowód przy WDT (0 %).
 */
export function PotwierdzenieVatUe({ wynik, onClose }: { wynik: VatUeWynik; onClose: () => void }) {
  const histRes = useApi(() => vatUeApi.historia(wynik.clientId), [wynik.clientId])
  const firmaRes = useApi(() => settingsApi.getCompany() as Promise<{ name?: string; nip?: string; address?: string; postalCode?: string; city?: string }>)
  const [druk, setDruk] = useState(false)
  const h = wpis(histRes.data, wynik)
  const vatNr = h?.vatNumber || wynik.vatNumber
  const nr = h?.requestId || wynik.requestId
  const kiedy = h?.checkedAt || wynik.checkedAt
  const tytul = `Potwierdzenie VAT UE ${vatNr}`
  useEffect(() => {
    if (!druk) return
    const prev = document.title
    document.title = tytul
    const t = window.setTimeout(() => { void drukuj({ rodzaj: 'inne', tytul }).finally(() => { setDruk(false); document.title = prev }) }, 60)
    return () => { window.clearTimeout(t); document.title = prev }
  }, [druk, tytul])

  const f = firmaRes.data
  const dok = (
    <article className="vat-potw">
      <h1>Potwierdzenie weryfikacji numeru VAT UE</h1>
      <p className="vp-sub">System VIES Komisji Europejskiej — sprawdzenie ważności numeru VAT nabywcy</p>
      <dl>
        <dt>Wynik</dt><dd><b>NUMER WAŻNY — VAT UE aktywny</b></dd>
        <dt>Numer VAT UE</dt><dd className="code">{vatNr}</dd>
        <dt>Kraj</dt><dd>{wynik.kraj || vatNr.slice(0, 2)}</dd>
        <dt>Nazwa wg VIES</dt><dd>{h?.viesName || '—'}</dd>
        <dt>Adres wg VIES</dt><dd style={{ whiteSpace: 'pre-line' }}>{h?.viesAddress || '—'}</dd>
        <dt>Data i godzina</dt><dd>{czas(kiedy)}</dd>
        <dt>Numer potwierdzenia</dt><dd className="code">{nr || '—'}</dd>
        {h && <><dt>Sprawdzenie</dt><dd>{KONTEKST[h.context] ?? h.context}{h.wzNumber ? ` · ${h.wzNumber}` : ''}{h.orderNo ? ` · ${h.orderNo}` : ''}{h.plate ? ` · kurs ${h.plate}` : ''}{h.operator ? ` · ${h.operator}` : ''}</dd></>}
        {f?.name && <><dt>Sprawdzający</dt><dd>{f.name}{f.nip ? ` · NIP ${f.nip}` : ''}</dd></>}
      </dl>
    </article>
  )
  return (
    <>
      <Dialog title="Potwierdzenie VAT UE" icon={<ShieldCheck size={20} />} onClose={onClose}
        footer={<><button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn primary" onClick={() => setDruk(true)} disabled={!nr} data-autofocus><Printer size={15} />Drukuj potwierdzenie</button></>}>
        {histRes.loading && !histRes.data ? <div className="note">Wczytuję zapis sprawdzenia…</div>
          : <div className="doc-preview"><div className="doc-paper">{dok}</div></div>}
      </Dialog>
      {druk && createPortal(<div className="print-sheet">{dok}</div>, document.body)}
    </>
  )
}
