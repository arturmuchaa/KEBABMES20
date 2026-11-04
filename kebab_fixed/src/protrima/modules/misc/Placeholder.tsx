import React from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { useApp, CommandBar } from '../../shell/context'
import { areaOf, moduleDef, JUZ_W_PROTRIMA, type ModuleDef } from '../../shell/modules'

/** Moduły spoza próby — uczciwie oznaczone, z opisem tego, co robią dziś w starym MES. */
export function Placeholder({ def }: { def: ModuleDef }) {
  const app = useApp()
  const Icon = def.icon
  const area = areaOf(def.key)
  const juz = JUZ_W_PROTRIMA[def.key] ?? []
  const idz = (x: { modul: string; widok?: string }) => x.modul === 'zamowienia' ? app.gotoOrders({ view: (x.widok ?? 'active') as never }) : app.openModule(x.modul)
  return (
    <>
      <CommandBar title={def.label} count={area?.label} cmds={[]} />
      <div className="placeholder">
        <div className="ph-card">
          <Icon size={30} />
          <h2>{def.label} — na razie w starym MES</h2>
          <p className="muted">PROTRIMA ma już Pulpit, Zamówienia, Przyjęcia surowca i Wyrób gotowy. {def.label} działa na razie w starym MES — tam zrób tę pracę dziś. Później moduł dostanie ten sam układ co reszta PROTRIMA.</p>
          {juz.length > 0 && <div className="ph-juz">
            <div className="label">W PROTRIMA już zrobisz</div>
            {juz.map(j => (
              <button key={j.co} className="ph-go" onClick={() => idz(j.idz)}>
                <span><b>{j.co}</b><small>{j.gdzie}</small></span><ArrowRight size={15} />
              </button>
            ))}
          </div>}
          {def.info && <>
            <div className="label">W starym MES ten moduł obsługuje</div>
            <ul>{def.info.map(i => <li key={i}>{i}</li>)}</ul>
          </>}
          <div className="row-wrap" style={{ marginTop: 6 }}>
            {juz.length === 0 && <button className="btn" onClick={() => app.openModule('zamowienia')}>Zamówienia<ArrowRight size={15} /></button>}
            <button className="btn ghost" onClick={() => app.openModule('pulpit')}>Pulpit zakładu</button>
            <span className="muted ph-ext"><ExternalLink size={13} /> {moduleDef(def.key)?.label} otwórz w starym MES</span>
          </div>
        </div>
      </div>
    </>
  )
}
