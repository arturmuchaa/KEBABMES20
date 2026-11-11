import React, { useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { downloadDocPdf, openDocument, rozliczeniaPdf } from '@/lib/api'
import { dataPl } from '@/features/rozliczenia/druk'
import { dzisIso, poprzedniMiesiac, zakresOkresu, type Karta } from './model'
import { OdmowaSerwera, Segment, naEnter, useZapis } from './wspolne'

type Rodzaj = 'zestawienie' | 'historia'
type OkresDruku = 'miesiac' | 'poprzedni' | 'zakres'
const RODZAJE = [['zestawienie', 'Zestawienie należności na dzień'], ['historia', 'Historia rozliczeń za okres']] as const
const OKRESY_DRUKU = [['miesiac', 'Ten miesiąc'], ['poprzedni', 'Poprzedni miesiąc'], ['zakres', 'Od–do']] as const

/**
 * Drukuj saldo: „Zestawienie należności” na dzień (do wysłania klientowi)
 * albo „Historia rozliczeń” za okres (jak wyciąg — do wyjaśniania „już
 * zapłaciłem”). PDF renderuje serwer; podgląd otwiera go w czytniku.
 */
export function DrukSaldaDialog({ karta, onClose }: { karta: Karta; onClose: () => void; onZapisano?: () => void }) {
  const app = useApp()
  const dzis = dzisIso()
  const [rodzaj, setRodzaj] = useState<Rodzaj>('zestawienie')
  const [naDzien, setNaDzien] = useState(dzis)
  const [okres, setOkres] = useState<OkresDruku>('miesiac')
  const [od, setOd] = useState('')
  const [do_, setDo] = useState('')
  const [ktory, setKtory] = useState<'podglad' | 'pdf' | null>(null)
  const zapis = useZapis('Nie udało się przygotować PDF')
  const k = karta.klient

  const zakres = okres === 'miesiac' ? zakresOkresu('miesiac', dzis) : okres === 'poprzedni' ? poprzedniMiesiac(dzis) : od && do_ && od <= do_ ? { od, do: do_ } : null
  const tip = rodzaj === 'zestawienie' ? (naDzien ? undefined : 'Wpisz datę zestawienia')
    : zakres ? undefined : od && do_ ? 'Data „od” jest po dacie „do”' : 'Wpisz obie daty okresu'
  const ok = !tip
  const wydruk = rodzaj === 'zestawienie'
    ? { url: rozliczeniaPdf.zestawienie(k.id, naDzien), nazwa: `Saldo ${k.nazwa} ${naDzien}.pdf`, tytul: 'Zestawienie należności', opis: `na dzień ${dataPl(naDzien)}` }
    : zakres && { url: rozliczeniaPdf.historia(k.id, zakres.od, zakres.do), nazwa: `Rozliczenia ${k.nazwa} ${zakres.od}_${zakres.do}.pdf`,
      tytul: 'Historia rozliczeń', opis: `${dataPl(zakres.od)} – ${dataPl(zakres.do)}` }

  const pobierz = (jak: 'podglad' | 'pdf') => {
    if (!ok || !wydruk) return
    setKtory(jak)
    void zapis.zapisz(async () => {
      await (jak === 'podglad' ? openDocument : downloadDocPdf)(wydruk.url, wydruk.nazwa)
      app.toast({ kind: 'ok', title: `${wydruk.tytul} — PDF gotowy`, detail: `${k.nazwa} · ${wydruk.opis}` })
      onClose()
    })
  }

  return (
    <Dialog icon={<Printer size={20} />} onClose={onClose}
      title={<>Drukuj saldo <span className="rr-dlg-klient">{k.nazwa}</span></>}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn" disabled={!ok || zapis.busy} data-tip={tip} onClick={() => pobierz('pdf')}>
          <Download size={15} />{zapis.busy && ktory === 'pdf' ? 'Przygotowuję PDF…' : 'Zapisz PDF'}
        </button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={tip} onClick={() => pobierz('podglad')}>
          <Printer size={15} />{zapis.busy && ktory === 'podglad' ? 'Przygotowuję PDF…' : 'Podgląd / drukuj'}
        </button>
      </>}>
      <div className="fld"><span className="label">Co drukować</span>
        <Segment label="Rodzaj wydruku" value={rodzaj} opcje={RODZAJE} onChange={setRodzaj} />
      </div>
      {rodzaj === 'zestawienie'
        ? (
          <>
            <label className="fld"><span className="label">Na dzień</span>
              <input type="date" className="field rr-data" value={naDzien} aria-label="Na dzień"
                onChange={e => setNaDzien(e.target.value)} onKeyDown={naEnter(() => pobierz('podglad'))} /></label>
            <p className="muted rr-dlg-p">Dokumenty niezapłacone na ten dzień — osobno WZ i faktury, z kwotą po terminie. Do wysłania klientowi mailem albo do teczki.</p>
          </>
        )
        : (
          <>
            <div className="fld"><span className="label">Okres</span>
              <Segment label="Okres" value={okres} opcje={OKRESY_DRUKU} onChange={setOkres} />
            </div>
            {okres === 'zakres' && (
              <span className="rr-zakres">
                <input type="date" className="field" value={od} max={do_ || undefined} aria-label="Od dnia" onChange={e => setOd(e.target.value)}
                  onKeyDown={naEnter(() => pobierz('podglad'))} />
                <span className="muted">–</span>
                <input type="date" className="field" value={do_} min={od || undefined} aria-label="Do dnia" onChange={e => setDo(e.target.value)}
                  onKeyDown={naEnter(() => pobierz('podglad'))} />
              </span>
            )}
            {zakres && <div className="rr-okres-druku">{`${dataPl(zakres.od)} – ${dataPl(zakres.do)}`}</div>}
            <p className="muted rr-dlg-p">Saldo na początek okresu, potem wszystkie dokumenty i wpłaty po kolei z saldem narastającym, na końcu saldo na koniec — jak wyciąg bankowy.</p>
          </>
        )}
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}
