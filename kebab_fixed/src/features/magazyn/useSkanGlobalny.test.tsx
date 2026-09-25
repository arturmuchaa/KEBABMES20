// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useSkanGlobalny } from './useSkanGlobalny'

afterEach(cleanup)

function Proba({ onKod, aktywny = true }: { onKod: (k: string) => void; aktywny?: boolean }) {
  useSkanGlobalny(aktywny, onKod)
  return <div><input data-testid="pole" /></div>
}

const wystukaj = (tekst: string, cel: Element | Document = document.body) => {
  for (const ch of tekst) fireEvent.keyDown(cel, { key: ch })
}

describe('skaner słuchany bez pola skanu', () => {
  it('kod karty kartonu bez Entera trafia do obsługi', async () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} />)
    wystukaj('SCARTON|ac82b8f61e2545a4867b')
    await waitFor(() => expect(onKod).toHaveBeenCalledWith('SCARTON|ac82b8f61e2545a4867b'))
  })

  it('Enter kończy kod od razu', () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} />)
    wystukaj('PAL|o1|3')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onKod).toHaveBeenCalledWith('PAL|o1|3')
  })

  it('nie przejmuje pisania w polu tekstowym', async () => {
    const onKod = vi.fn()
    const { getByTestId } = render(<Proba onKod={onKod} />)
    wystukaj('SCARTON|ac82b8f61e2545a4867b', getByTestId('pole'))
    fireEvent.keyDown(getByTestId('pole'), { key: 'Enter' })
    await new Promise(r => setTimeout(r, 250))
    expect(onKod).not.toHaveBeenCalled()
  })

  it('wyłączony nic nie słyszy', () => {
    const onKod = vi.fn()
    render(<Proba onKod={onKod} aktywny={false} />)
    wystukaj('PAL|o1|3'); fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onKod).not.toHaveBeenCalled()
  })
})
