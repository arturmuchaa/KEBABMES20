import React from 'react'
import { ChevronRight } from 'lucide-react'
import type { EtapSzyny, Krok } from '../../../data/krok'
import type { EtapZamowienia } from '../../../data/model'
import { StageNode } from '../../../ui/Glyphs'

/**
 * Wariant B listy: kolumna „Dalej” — jeden następny krok zamówienia tym samym słowem co na Pulpicie.
 * Czynność biura = pogrubiony czasownik (klik otwiera właściwą zakładkę panelu); czekanie = spokojny szary tekst.
 */
export function KrokCell({ k, onGo }: { k: Krok; onGo: () => void }) {
  const lvl = k.pilne && k.kod !== 'czeka-zaladunek' && k.kod !== 'w-zaladunku' ? (k.kod === 'brak-wyrobu' ? 'crit' : 'warn') : null
  const dopisekWidoczny = k.kod === 'palety' || k.kod === 'papiery' || k.kod === 'w-zaladunku'
  const tip = `${k.akcja ? 'Do zrobienia w biurze' : 'Czekamy'}: ${k.tekst}${k.dopisek ? ` — ${k.dopisek}` : ''}${k.pilne ? '\nWyjazd dziś, jutro albo po terminie' : ''}`
  const tresc = <>
    {lvl && <StageNode level={lvl} size={10} />}
    <span className="kt">{k.tekst}</span>
    {dopisekWidoczny && k.dopisek && <span className="kd">{k.dopisek}</span>}
  </>
  return k.akcja
    ? <button className={`krok akcja${lvl ? ` ${lvl}` : ''}`} data-tip={tip} onClick={e => { e.stopPropagation(); onGo() }}>{tresc}<ChevronRight className="kc" size={14} aria-hidden="true" /></button>
    : <span className={`krok czeka${lvl ? ` ${lvl}` : ''}`} data-tip={tip}>{tresc}</span>
}

/**
 * Wariant C listy: „szyna w wierszu” — siedem koralików etapów zamówienia (te same co szyna w panelu)
 * i słowo bieżącego etapu. Kształt mówi, gdzie zamówienie utknęło: ● zrobione · ▲ uwaga · ◆ krytyczne · ○ przed nami.
 */
export function MikroSzyna({ etapy, e }: { etapy: EtapSzyny[]; e: EtapZamowienia }) {
  const tip = etapy.map(x => `${x.name}: ${x.value} — ${x.sub}`).join('\n')
  return (
    <span className={`mszyna status etap ${e.etap}`} data-tip={tip}>
      <span className="ms-rail" role="img" aria-label={etapy.map(x => `${x.name} ${x.level === 'ok' ? 'zrobione' : x.level === 'warn' ? 'uwaga' : x.level === 'crit' ? 'krytyczne' : 'przed nami'}`).join(', ')}>
        {etapy.map((x, i) => <i key={i} className={x.level} />)}
      </span>
      <span className="ms-t">{e.tekst}{e.szczegol && <span className="etap-sub">{e.szczegol}</span>}</span>
    </span>
  )
}
