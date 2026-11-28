import { X, XSquare, Layers } from 'lucide-react'
import { Dialog, Menu, type MenuItem } from './context'
import type { WTab } from './Chrome'
import type { TrybZamykania } from './zamykanieKart'

/** Menu prawego przycisku na karcie. Na Pulpicie tylko „Zamknij wszystkie” (Pulpitu się nie zamyka). */
export function MenuKarty({ anchor, kartaId, onWybierz, onClose }: {
  anchor: Element; kartaId: string; onWybierz: (tryb: TrybZamykania) => void; onClose: () => void
}) {
  const wszystkie: MenuItem = { label: 'Zamknij wszystkie', icon: <Layers size={15} />, kbd: 'Ctrl+Shift+W', onSelect: () => onWybierz('wszystkie') }
  const items: MenuItem[] = kartaId === 'pulpit' ? [wszystkie] : [
    { label: 'Zamknij', icon: <X size={15} />, onSelect: () => onWybierz('jedna') },
    { label: 'Zamknij pozostałe', icon: <XSquare size={15} />, onSelect: () => onWybierz('pozostale') },
    wszystkie,
  ]
  return <Menu anchor={anchor} items={items} onClose={onClose} />
}

/** Pytanie przed zamknięciem kart edycji — niezapisane zmiany w nich przepadają. */
export function OknoZamykania({ edycja, onWybierz, onClose }: {
  edycja: WTab[]; onWybierz: (decyzja: 'wszystkie' | 'zostaw') => void; onClose: () => void
}) {
  return (
    <Dialog title="Zamknąć też okna edycji?" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Anuluj</button>
      <button className="btn" onClick={() => onWybierz('zostaw')}>Zostaw okna edycji</button>
      <button className="btn primary danger" onClick={() => onWybierz('wszystkie')}>Zamknij wszystkie</button>
    </>}>
      <p>Niezapisane zmiany w nich przepadną:</p>
      <ul className="lista-kart">{edycja.map(t => <li key={t.id}><b>{t.title}</b></li>)}</ul>
    </Dialog>
  )
}
