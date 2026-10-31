import { useMemo } from 'react'
import { Printer, Package } from 'lucide-react'
import { Dialog } from '../../../shell/context'
import { kg } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'
import { BEZ_DRUKU_ETYKIET } from '../../../proba'
import type { StockCarton } from '@/lib/api'
import { useClientNames, useClientRecipeNames } from '@/lib/clientNames'
import { KOPII_NA_PALETE } from '@/features/labels/CartonLabel'
import { Strona, TRYBY_NAZWY, useDrukKartek, useRodzajNaDokumentach, useTrescKartki } from '../../orders/druk/KartkiPalet'
import { kartkaKartonu, nrKartonu, skladKartonu } from './model'

const SKALA_PODGLADU = 0.3

/**
 * Kartka kartonu magazynowego — ten sam wydruk A4 co kartka palety (dwie kopie,
 * kod do pakowania `SCARTON|…`), w stopce „MAGAZYN”. Treść (nazwa klienta,
 * receptura / rodzaj) wybierana przy druku, pamiętana dla klienta jak przy paletach.
 * W próbie bez kodu i bez druku: kopia ma prawdziwe numery kartonów.
 */
export function KartkaKartonuDialog({ karton, onClose, proba = import.meta.env.MODE === 'proba' }: { karton: StockCarton; onClose: () => void; proba?: boolean }) {
  const klientNa = useClientNames()
  const recepturaNa = useClientRecipeNames()
  const rodzajNa = useRodzajNaDokumentach()
  const [tresc, ustawTresc] = useTrescKartki(karton.clientId || 'magazyn')
  const kartki = useMemo(() => [kartkaKartonu(karton, klientNa, recepturaNa, { nazwa: tresc.nazwa, tryb: tresc.tryb, rodzajNa })],
    [karton, klientNa, recepturaNa, tresc.nazwa, tresc.tryb, rodzajNa])
  const { qr, ustawPt, gotowe, druk, drukuj, arkusz } = useDrukKartek(kartki, proba, `Kartka kartonu ${nrKartonu(karton)}`)
  const k = kartki[0]
  return (
    <Dialog title={`Kartka kartonu ${nrKartonu(karton)}`} icon={<Package size={20} />} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose} data-autofocus>Zamknij</button>
        <button className="btn primary" disabled={proba || !gotowe || druk} onClick={drukuj} data-tip={proba ? BEZ_DRUKU_ETYKIET : undefined}>
          <Printer size={15} />{proba ? 'Druk wyłączony w próbie' : `Drukuj ${KOPII_NA_PALETE} kartki`}</button>
      </>}>
      {proba && <div className="note warn"><FlagIcon level="warn" size={15} /><div>{BEZ_DRUKU_ETYKIET} Podgląd pokazuje układ kartki — bez kodu QR.</div></div>}
      <div className="kp-layout">
        <div className="kp-list">
          <p className="muted" style={{ margin: 0 }}>{karton.clientName ? klientNa(karton.clientName) : 'Na magazyn — bez klienta'} · {skladKartonu(karton)} · {kg(k.totalKg)}</p>
          <div className="kp-tresc" role="group" aria-label="Treść kartki">
            <span className="label">Treść kartki</span>
            <label className="fld"><span className="sub">Nazwa na kartce</span>
              <input className="field" value={tresc.nazwa} placeholder={karton.clientName ? klientNa(karton.clientName) : 'bez nazwy klienta'} onChange={e => ustawTresc({ nazwa: e.target.value })} aria-label="Nazwa klienta na kartce" /></label>
            <div className="fld"><span className="sub">Pokaż</span>
              <div className="seg kp-seg" role="group" aria-label="Co pokazać na kartce">
                {TRYBY_NAZWY.map(t => <button key={t.v} type="button" aria-pressed={tresc.tryb === t.v} onClick={() => ustawTresc({ tryb: t.v })}>{t.t}</button>)}
              </div></div>
            {(tresc.nazwa || tresc.tryb !== 'recipe') && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => ustawTresc({ nazwa: '', tryb: 'recipe' })}>Przywróć domyślne</button>}
          </div>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 0' }}>{KOPII_NA_PALETE} kopie A4 (poziomo) — kod na kartce służy do skanowania sztuk do kartonu i wydania.</p>
        </div>
        <div className="kp-preview" aria-label="Podgląd kartki">
          <div className="kp-thumb" style={{ ['--kp-s' as string]: SKALA_PODGLADU }} data-testid={`kartka-kartonu-${karton.id}`}>
            <Strona k={k} qr={qr[k.qr] ?? ''} proba={proba} onPt={ustawPt(k)} />
          </div>
        </div>
      </div>
      {arkusz}
    </Dialog>
  )
}
