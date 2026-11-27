// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/lib/apiClient', () => ({
  labelTemplatesApi: { get: vi.fn(async () => ({ exists: false, template: null })), save: vi.fn() },
  clientsApi: { list: vi.fn(async () => []) }, recipesApi: { list: vi.fn(async () => []) },
}))
vi.mock('@/lib/pdfToImage', () => ({ pdfFirstPageToPng: vi.fn() }))
import { LabelTemplateSetupPage } from '@/pages/office/LabelTemplateSetupPage'

afterEach(cleanup)

describe('stare okno etykiet MES', () => {
  it('odsyła do projektora etykiet w PROTRIMA', async () => {
    render(<MemoryRouter><LabelTemplateSetupPage /></MemoryRouter>)
    expect(await screen.findByRole('note')).toHaveProperty('textContent', expect.stringContaining('PROTRIMA (moduł Etykiety)'))
  })
})
