// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React, { useRef, useState } from 'react'
import { AppCtx } from './context'
import { TabStrip, type WTab } from './Chrome'
import { MenuKarty, OknoZamykania } from './MenuKarty'

afterEach(cleanup)
const t = (id: string, title: string, kind: WTab['kind'] = 'module'): WTab => ({ id, kind, key: id, title })

function Stol({ onWybierz }: { onWybierz: (tryb: string, id: string) => void }) {
  const appRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ id: string; el: Element } | null>(null)
  return (
    <AppCtx.Provider value={{ appRef, scale: 1 } as never}>
      <div ref={appRef}>
        <TabStrip tabs={[t('pulpit', 'Pulpit'), t('rozbior', 'Rozbiór')]} active="pulpit" onActivate={vi.fn()} onClose={vi.fn()}
          onMenu={(id, el) => setMenu({ id, el })} />
        {menu && <MenuKarty anchor={menu.el} kartaId={menu.id} onWybierz={tryb => onWybierz(tryb, menu.id)} onClose={() => setMenu(null)} />}
      </div>
    </AppCtx.Provider>
  )
}

describe('menu karty', () => {
  it('prawy klik na karcie: Zamknij, Zamknij pozostałe, Zamknij wszystkie', () => {
    const wyb = vi.fn()
    render(<Stol onWybierz={wyb} />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Rozbiór/ }))
    const pozycje = screen.getAllByRole('menuitem').map(b => b.textContent)
    expect(pozycje).toEqual(['Zamknij', 'Zamknij pozostałe', 'Zamknij wszystkieCtrl+Shift+W'])
    fireEvent.click(screen.getByRole('menuitem', { name: /Zamknij wszystkie/ }))
    expect(wyb).toHaveBeenCalledWith('wszystkie', 'rozbior')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('na Pulpicie tylko „Zamknij wszystkie”', () => {
    render(<Stol onWybierz={vi.fn()} />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Pulpit/ }))
    expect(screen.getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Zamknij wszystkieCtrl+Shift+W'])
  })
  it('Esc zamyka menu', () => {
    render(<Stol onWybierz={vi.fn()} />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /Rozbiór/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('okno zamykania okien edycji', () => {
  it('lista tytułów i trzy decyzje', () => {
    const wyb = vi.fn(), close = vi.fn()
    render(<OknoZamykania edycja={[t('new:1', 'Nowe zamówienie', 'new-order'), t('edit-rec:2', 'Przyjęcie 12', 'edit-reception')]} onWybierz={wyb} onClose={close} />)
    expect(screen.getByRole('heading', { name: 'Zamknąć też okna edycji?' })).toBeTruthy()
    expect(screen.getByText('Nowe zamówienie')).toBeTruthy()
    expect(screen.getByText('Przyjęcie 12')).toBeTruthy()
    // Enter z rozpędu nie może skasować niezapisanych zmian — fokus na bezpiecznym wyborze
    expect(document.activeElement?.textContent).toBe('Zostaw okna edycji')
    fireEvent.click(screen.getByRole('button', { name: 'Zostaw okna edycji' }))
    expect(wyb).toHaveBeenCalledWith('zostaw')
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij wszystkie' }))
    expect(wyb).toHaveBeenCalledWith('wszystkie')
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(close).toHaveBeenCalled()
  })
})
