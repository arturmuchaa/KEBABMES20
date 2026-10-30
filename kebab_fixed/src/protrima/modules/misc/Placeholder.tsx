import React from 'react'
import { ArrowRight } from 'lucide-react'
import { useApp, CommandBar } from '../../shell/context'
import { areaOf, type ModuleDef } from '../../shell/modules'

/** Moduły spoza próby — uczciwie oznaczone, z opisem tego, co robią dziś w starym MES. */
export function Placeholder({ def }: { def: ModuleDef }) {
  const app = useApp()
  const Icon = def.icon
  const area = areaOf(def.key)
  return (
    <>
      <CommandBar title={def.label} count={area?.label} cmds={[]} />
      <div className="placeholder">
        <div className="ph-card">
          <Icon size={30} />
          <h2>Ten moduł jest w starym MES</h2>
          <p className="muted">Próba PROTRIMA obejmuje Pulpit, Zamówienia i Wyrób gotowy. {def.label} działa dalej w starym MES; później dostanie ten sam układ: lista z widokami i filtrami, dolny panel szczegółów, karty robocze i ten sam pasek stanu.</p>
          {def.info && <>
            <div className="label">Co ten moduł robi dziś w KEBABMES20</div>
            <ul>{def.info.map(i => <li key={i}>{i}</li>)}</ul>
          </>}
          <div className="row-wrap" style={{ marginTop: 6 }}>
            <button className="btn primary" onClick={() => app.openModule('zamowienia')}>Przejdź do Zamówień<ArrowRight size={15} /></button>
            <button className="btn" onClick={() => app.openModule('pulpit')}>Pulpit</button>
          </div>
        </div>
      </div>
    </>
  )
}
