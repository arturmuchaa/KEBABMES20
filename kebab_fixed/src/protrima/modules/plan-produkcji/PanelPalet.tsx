import React, { useMemo, useState } from 'react'
import { Boxes, Wand2 } from 'lucide-react'
import { Pusto } from '../../ui/Pusto'
import { kolejnoscPalet, lezyGodzin, sumaKoncowek, sztukZPalety, type Paleta, type Pozycja, type Skladnik } from './model'

const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)
const dataPl = (iso?: string | null) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

/**
 * Palety w chłodni — z czego układa się plan. Końcówki na górze, potem palety
 * leżące najdłużej (licznik „leży N h” od zważenia po masowaniu — tylko
 * informacja). Przy zaznaczonej pozycji: palety jej receptury, a przy kebabie
 * mix — osobno dla każdego składnika z potrzebnymi kg.
 */
export function PanelPalet({ palety, wybrana, sklad, nazwyPlanow, biezacyPlanId, tylkoPodglad, onPrzelacz, onPodpowiedz, onZKoncowek }: {
  palety: Paleta[]
  wybrana: Pozycja | null
  sklad: Skladnik[]
  nazwyPlanow: Map<string, string>
  biezacyPlanId: string | null
  tylkoPodglad: boolean
  onPrzelacz: (paletaId: string) => void
  onPodpowiedz: () => void
  onZKoncowek: (ids: string[]) => void
}) {
  const [koncowki, setKoncowki] = useState<string[]>([])
  const teraz = useMemo(() => new Date(), [palety])
  const wChlodni = useMemo(() => palety.filter(p => p.status === 'in_cold').sort(kolejnoscPalet), [palety])
  const widoczne = wybrana ? wChlodni.filter(p => p.recipeId === wybrana.recipeId) : wChlodni
  const zaznaczone = wChlodni.filter(p => koncowki.includes(p.id))
  const jednaReceptura = new Set(zaznaczone.map(p => p.recipeId)).size === 1
  const suma = sumaKoncowek(zaznaczone)

  const wiersz = (p: Paleta) => {
    const w = !!wybrana?.palety.includes(p.id)
    const inne = (p.planIds ?? []).filter(id => id !== biezacyPlanId)
    return (
      <div key={p.id} className={`pp-pal${w ? ' sel' : ''}`}>
        {p.isRemainder && !tylkoPodglad && <input type="checkbox" className="cbx" aria-label={`Końcówka ${p.palletNo}`} checked={koncowki.includes(p.id)}
          onChange={e => setKoncowki(k => e.target.checked ? [...k, p.id] : k.filter(x => x !== p.id))} />}
        <button type="button" className="pp-pal-b" disabled={tylkoPodglad || !wybrana} aria-pressed={w}
          aria-label={`Paleta ${p.palletNo} · partia ${p.batchNo} · ${fmt(p.kgWeighed)} kg${p.isRemainder ? ' · końcówka' : ''}`}
          data-tip={!wybrana ? 'Zaznacz pozycję planu, żeby dobierać do niej palety' : w ? 'Kliknij, żeby zdjąć paletę z pozycji' : 'Kliknij, żeby dodać paletę do pozycji'}
          onClick={() => onPrzelacz(p.id)}>
          <span className="l1"><b className="code">P{p.palletNo}</b> partia <b>{p.batchNo}</b>{p.isRemainder && <span className="tag warn">końcówka</span>}
            <span className="grow" /><b className="tnum">{fmt(p.kgWeighed)} kg</b></span>
          <span className="l2 muted">{[p.recipeName, p.materialName].filter(Boolean).join(' · ')}
            {wybrana && wybrana.kgPerUnit > 0 && !sklad.length && <> · {sztukZPalety(p.kgWeighed, wybrana.kgPerUnit)} szt.</>}
            <span className="grow" /><span className="tnum">leży {lezyGodzin(p, teraz)} h</span>{p.expiryDate && <> · do {dataPl(p.expiryDate)}</>}</span>
          {inne.length > 0 && <span className="l3">{inne.map(id => <span key={id} className="tag outline" data-tip="Ta paleta jest już w innym planie — jedna paleta może obsłużyć kilka pozycji">w planie {nazwyPlanow.get(id) ?? '…'}</span>)}</span>}
        </button>
      </div>
    )
  }

  return (
    <div className="pp-panel" data-testid="panel-palet">
      <div className="pp-panel-akcje">
        <button className="btn sm" disabled={tylkoPodglad || !wybrana} onClick={onPodpowiedz}
          data-tip="Końcówki najpierw, potem palety leżące najdłużej — aż starczy na całą pozycję"><Wand2 size={14} />Podpowiedz palety</button>
        <button className="btn sm" disabled={tylkoPodglad || !zaznaczone.length || !jednaReceptura}
          data-tip={zaznaczone.length && !jednaReceptura ? 'Końcówki różnych receptur nie idą do jednej sztuki' : 'Zaznacz końcówki ptaszkiem — powstanie pozycja z ich sumy (sztuki PM)'}
          onClick={() => { onZKoncowek(zaznaczone.map(p => p.id)); setKoncowki([]) }}>
          <Boxes size={14} />Pozycja z końcówek{zaznaczone.length ? ` (${fmt(suma.kg)} kg)` : ''}</button>
      </div>
      {!wChlodni.length && <Pusto ikona={<Boxes size={20} />} tytul="W chłodni nie ma palet">Palety pojawiają się po odbiorze z masownicy.</Pusto>}
      {wybrana && sklad.length > 0 ? sklad.map(s => (
        <section key={s.materialTypeId} className="pp-grupa">
          <h4>{s.nazwa} {s.pct}% — potrzeba {fmt(wybrana.qty * wybrana.kgPerUnit * s.pct / 100)} kg</h4>
          {widoczne.filter(p => (p.materialTypeId ?? '') === s.materialTypeId).map(wiersz)}
        </section>
      )) : widoczne.map(wiersz)}
      {wybrana && !widoczne.length && wChlodni.length > 0 && <p className="muted pp-pad">Brak palet tej receptury w chłodni.</p>}
    </div>
  )
}
