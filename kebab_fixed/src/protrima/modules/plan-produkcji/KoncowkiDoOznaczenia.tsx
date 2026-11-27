import React, { useState } from 'react'
import { Printer, Tags } from 'lucide-react'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { seasonedPalletsApi } from '@/lib/api'
import { ROLKA_ETYKIET, drukujEtykiety, opisBledu } from '../../drukarka/drukarka'
import { etykietaPaletyZpl } from './etykiety'
import { kolejnoscPalet, type Paleta } from './model'

const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)

/**
 * Palety w chłodni bez etykiety z QR: końcówki zwrócone z hali i palety
 * wpisane w dniu wdrożenia. W chłodni nie ma drukarki (założenie 26.11.2026),
 * więc etykiety drukuje biuro przed wieczornym planem. Hala skanuje QR przy
 * wywozie — bez etykiety palety nie wywiezie.
 */
export function KoncowkiDoOznaczenia({ palety, onWydrukowano }: { palety: Paleta[]; onWydrukowano: () => void }) {
  const [blad, setBlad] = useState<string | null>(null)
  const [drukuje, setDrukuje] = useState(false)
  const lista = palety.filter(p => p.status === 'in_cold' && !p.labelPrintedAt).sort(kolejnoscPalet)
  const drukuj = async (wybrane: Paleta[]) => {
    if (!wybrane.length || drukuje) return
    setDrukuje(true); setBlad(null)
    try {
      await drukujEtykiety(wybrane.map(p => etykietaPaletyZpl(p)), ROLKA_ETYKIET)
      await seasonedPalletsApi.markLabelsPrinted(wybrane.map(p => p.id))
      onWydrukowano()
    } catch (e) { setBlad(await opisBledu(e)) } finally { setDrukuje(false) }
  }
  return (
    <div className="pp-panel">
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Etykiety nie zostały wydrukowane:</b> {blad}</div></div>}
      {!lista.length ? <Pusto ikona={<Tags size={20} />} tytul="Wszystkie palety w chłodni mają etykiety">Końcówka zwrócona z hali pojawi się tutaj do wydruku etykiety z kodem QR.</Pusto> : <>
        <div className="pp-panel-akcje">
          <button className="btn sm primary" disabled={drukuje} onClick={() => void drukuj(lista)}><Printer size={14} />{drukuje ? 'Drukuję…' : `Drukuj etykiety (${lista.length})`}</button>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>rolka 100 × 150 mm</span>
        </div>
        {lista.map(p => (
          <div key={p.id} className="pp-pal"><div className="pp-pal-b" style={{ cursor: 'default' }}>
            <span className="l1"><b className="code">P{p.palletNo}</b> partia <b>{p.batchNo}</b>{p.isRemainder && <span className="tag warn">końcówka{p.parentPalletNo ? ` z P${p.parentPalletNo}` : ''}</span>}<span className="grow" /><b className="tnum">{fmt(p.kgWeighed)} kg</b></span>
            <span className="l2 muted">{p.recipeName}<span className="grow" /><button className="btn sm ghost" disabled={drukuje} onClick={() => void drukuj([p])}><Printer size={13} />Tylko ta</button></span>
          </div></div>
        ))}
      </>}
    </div>
  )
}
