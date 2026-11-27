import React, { useState } from 'react'
import { FilePlus2, FileText, Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { labelDesignsApi, type LabelDesign } from '@/lib/api'
import { pdfFirstPageToPng } from '@/lib/pdfToImage'
import { nowySzablon } from './model'

type Rodzaj = 'a4-pdf' | 'zebra-prn' | 'zebra-pdf'
const ROLKI = [{ w: 100, h: 150, opis: 'kebaby' }, { w: 80, h: 100, opis: 'ćwiartka, surowiec' }]

const doDataUrl = (f: File) => new Promise<string>((ok, zle) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result))
  r.onerror = () => zle(new Error('Nie udało się odczytać pliku'))
  r.readAsDataURL(f)
})

/**
 * Nowy szablon: A4 z PDF (jak w starym MES), Zebra z pliku .prn z ZebraDesigner
 * albo Zebra z PDF. Tło Zebry przycinane do wybranej rolki wokół treści.
 */
export function NowySzablon({ onClose, onGotowy }: { onClose: () => void; onGotowy: (d: LabelDesign) => void }) {
  const [rodzaj, setRodzaj] = useState<Rodzaj>('a4-pdf')
  const [rolka, setRolka] = useState(ROLKI[0])
  const [plik, setPlik] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const zebra = rodzaj !== 'a4-pdf'
  const akceptuje = rodzaj === 'zebra-prn' ? '.prn,.txt,.zpl,.epl' : '.pdf,application/pdf'

  const utworz = async () => {
    if (!plik || busy) return
    setBusy(true); setBlad(null)
    try {
      if (rodzaj === 'a4-pdf') {
        const [pdf, png] = await Promise.all([doDataUrl(plik), pdfFirstPageToPng(plik, 1240)])
        onGotowy({ ...nowySzablon('a4'), backgroundPdf: pdf, backgroundPng: png, sourceName: plik.name })
      } else if (rodzaj === 'zebra-prn') {
        const imp = await labelDesignsApi.importPrn(plik, { widthMm: rolka.w, heightMm: rolka.h })
        onGotowy({ ...nowySzablon('zebra'), widthMm: rolka.w, heightMm: rolka.h, backgroundPng: imp.backgroundPng, backgroundZpl: imp.backgroundZpl, sourceName: plik.name })
      } else {
        const { pdfDoTlaZebry } = await import('./raster')
        const t = await pdfDoTlaZebry(plik, rolka.w, rolka.h)
        onGotowy({ ...nowySzablon('zebra'), widthMm: rolka.w, heightMm: rolka.h, backgroundPng: t.png, backgroundZpl: t.gfa, sourceName: plik.name })
      }
    } catch (e) {
      setBlad(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <Dialog title="Nowy szablon etykiety" icon={<FilePlus2 size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
        <button className="btn primary" disabled={!plik || busy} onClick={() => void utworz()}>{busy ? 'Wczytuję…' : 'Utwórz szablon'}</button>
      </>}>
      <div className="et-nowy">
        <div className="et-rodzaje" role="radiogroup" aria-label="Rodzaj etykiety">
          {([['a4-pdf', 'A4 z PDF', 'Arkusz A4 na zwykłej drukarce, 1 albo 2 etykiety (ZAGROS, TRUVA…)', <FileText key="i" size={18} />],
             ['zebra-prn', 'Zebra z ZebraDesigner', 'Plik .prn — „drukuj do pliku” w ZebraDesigner (YALCIN, FUDI…)', <Printer key="i" size={18} />],
             ['zebra-pdf', 'Zebra z PDF', 'Etykieta z PDF drukowana na rolce Zebry', <Printer key="i" size={18} />]] as const).map(([k, t, o, ik]) => (
            <button key={k} type="button" role="radio" aria-checked={rodzaj === k} className={`et-rodzaj${rodzaj === k ? ' sel' : ''}`}
              onClick={() => { setRodzaj(k); setPlik(null); setBlad(null) }}>
              {ik}<span><b>{t}</b><span className="muted">{o}</span></span>
            </button>
          ))}
        </div>
        {zebra && <div className="seg" role="group" aria-label="Rolka">
          {ROLKI.map(r => <button key={r.w} type="button" aria-pressed={rolka.w === r.w} onClick={() => setRolka(r)}>{r.w} × {r.h} mm · {r.opis}</button>)}
        </div>}
        <label className="et-plik">
          <span>{plik ? plik.name : rodzaj === 'zebra-prn' ? 'Wybierz plik .prn z ZebraDesigner' : 'Wybierz plik PDF z etykietą'}</span>
          <input type="file" accept={akceptuje} aria-label="Plik etykiety" onChange={e => { setPlik(e.target.files?.[0] ?? null); setBlad(null) }} />
        </label>
        {rodzaj === 'zebra-prn' && <p className="muted">Usuń w ZebraDesigner wagę, partię i daty — wstawi je system. Tekst eksportuj jako grafikę.</p>}
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie wczytano:</b> {blad}</div></div>}
      </div>
    </Dialog>
  )
}
