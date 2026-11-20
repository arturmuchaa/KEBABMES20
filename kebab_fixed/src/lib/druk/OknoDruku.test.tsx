// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import type { Mozliwosci } from './typy'

const PSK = '{http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords}'
const KM = '{http://www.konicaminolta.com/printing/schema}'
const plik = vi.hoisted(() => ({ tresc: '{}' }))
const n = vi.hoisted(() => ({
  drukarki: vi.fn(), mozliwosci: vi.fn(), ustawOpcje: vi.fn(), ustawieniaSterownika: vi.fn(),
  stronaPdf: vi.fn(), drukujPdf: vi.fn(), czytajPlik: vi.fn(), zapiszPlik: vi.fn(), komputer: vi.fn(), dostepny: vi.fn(),
}))
vi.mock('./natywny', () => ({ natywny: n }))
// pdfjs nie działa w jsdom — podgląd udaje 3 strony A4 (trzecia pozioma).
const podglad = vi.hoisted(() => ({ stronyPodgladu: vi.fn() }))
vi.mock('./podglad', () => ({ MAKS_STRON_PODGLADU: 40, stronyPodgladu: podglad.stronyPodgladu }))

function mozliwosci(wybrane: Record<string, string> = {}): Mozliwosci {
  const f = (id: string, nazwa: string, opcje: [string, string][]) =>
    ({ id, nazwa, opcje: opcje.map(([i, nm]) => ({ id: i, nazwa: nm })), wybrana: wybrane[id] ?? null })
  return {
    ticket: 'T0', kopieMax: 999, zasobnikDomyslny: [PSK + 'PageInputBin', KM + 'Tray1'],
    funkcje: [
      f(PSK + 'PageInputBin', 'Zasobnik papieru', [[PSK + 'AutoSelect', 'Automatyczny'], [KM + 'Tray1', 'Zasobnik 1'], [KM + 'Tray3', 'Zasobnik 3']]),
      f(PSK + 'PageOutputColor', 'Kolor', [[PSK + 'Color', 'Kolor'], [PSK + 'Monochrome', 'Czarno-biały']]),
      f(PSK + 'JobDuplexAllDocumentsContiguously', 'Druk dwustronny', [[PSK + 'OneSided', 'Jednostronnie'], [PSK + 'TwoSidedLongEdge', 'Dwustronnie']]),
      f(KM + 'Staple', 'Zszywanie', [[KM + 'Off', 'Wyłączone'], [KM + 'Corner', 'Róg']]),
    ],
  }
}

beforeEach(() => {
  plik.tresc = '{}'
  n.czytajPlik.mockImplementation(async () => plik.tresc)
  n.zapiszPlik.mockImplementation(async (j: string) => { plik.tresc = j })
  n.drukarki.mockResolvedValue([{ nazwa: 'bizhub', domyslna: true }, { nazwa: 'HP biuro', domyslna: false }])
  n.mozliwosci.mockImplementation(async (_d: string, t?: string | null) => ({ ...mozliwosci(), ticket: t ?? 'T0' }))
  n.ustawOpcje.mockImplementation(async (t: string, f: string, o: string) => `${t}|${f}=${o}`)
  n.stronaPdf.mockResolvedValue('PDF64')
  n.drukujPdf.mockResolvedValue(2)
  podglad.stronyPodgladu.mockImplementation(async (_pdf: string, naStrone: (i: number, s: object, n: number) => void) => {
    ;[[595, 842], [595, 842], [842, 595]].forEach(([szer, wys], i) => naStrone(i, { src: `data:image/png;base64,S${i}`, szer, wys }, 3))
    return 3
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function otworz(props: Partial<React.ComponentProps<typeof import('./OknoDruku').OknoDruku>> = {}) {
  const { OknoDruku } = await import('./OknoDruku')
  const onZamknij = vi.fn()
  render(<OknoDruku rodzaj="kartki-palet" tytul="Kartki palet TRUVA" zrodlo={{ typ: 'strona' }} onZamknij={onZamknij} {...props} />)
  await screen.findByRole('button', { name: 'Drukuj' })
  await waitFor(() => expect(screen.getByLabelText('Zasobnik papieru')).toBeTruthy())
  return onZamknij
}
const sel = (label: string) => screen.getByLabelText(label) as HTMLSelectElement

describe('okno druku', () => {
  it('pierwszy raz: domyślna drukarka, zasobnik 1 i czarno-biały', async () => {
    await otworz()
    expect(sel('Drukarka').value).toBe('bizhub')
    await waitFor(() => expect(sel('Zasobnik papieru').value).toBe(KM + 'Tray1'))
    expect(sel('Kolor').value).toBe(PSK + 'Monochrome')
  })

  it('startuje z zapisanych ustawień rodzaju', async () => {
    plik.tresc = JSON.stringify({ dokumenty: { 'kartki-palet': { drukarka: 'HP biuro', ticket: 'T-zapis', kopie: 3 } } })
    n.mozliwosci.mockImplementation(async (_d: string, t?: string | null) => ({ ...mozliwosci({ [PSK + 'PageInputBin']: KM + 'Tray3' }), ticket: t ?? 'T0' }))
    await otworz()
    expect(sel('Drukarka').value).toBe('HP biuro')
    expect(n.mozliwosci).toHaveBeenCalledWith('HP biuro', 'T-zapis')
    expect(sel('Zasobnik papieru').value).toBe(KM + 'Tray3')
    expect((screen.getByLabelText('Kopie') as HTMLInputElement).value).toBe('3')
    expect(n.ustawOpcje).not.toHaveBeenCalled()
  })

  it('brak zapisanej drukarki wybiera domyślną z komunikatem', async () => {
    plik.tresc = JSON.stringify({ dokumenty: { 'kartki-palet': { drukarka: 'Stara', ticket: 'T-s', kopie: 1 } } })
    await otworz()
    expect(sel('Drukarka').value).toBe('bizhub')
    expect(screen.getByText('Zapisana drukarka „Stara” jest niedostępna — wybrano domyślną')).toBeTruthy()
  })

  it('pola bez koloru i dwustronnego są ukryte', async () => {
    n.mozliwosci.mockImplementation(async () => ({ ...mozliwosci(), funkcje: mozliwosci().funkcje.slice(0, 1) }))
    await otworz()
    expect(screen.queryByLabelText('Kolor')).toBeNull()
    expect(screen.queryByLabelText('Druk dwustronny')).toBeNull()
  })

  it('więcej ustawień zwinięte', async () => {
    await otworz()
    const wiecej = screen.getByText('Więcej ustawień drukarki').closest('details')!
    expect(wiecej.open).toBe(false)
    expect(within(wiecej).getByLabelText('Zszywanie')).toBeTruthy()
  })

  it('Enter drukuje z wybranymi ustawieniami', async () => {
    const onZamknij = await otworz()
    await waitFor(() => expect(sel('Kolor').value).toBe(PSK + 'Monochrome'))
    fireEvent.submit(screen.getByRole('form', { name: 'Ustawienia wydruku' }))
    await waitFor(() => expect(onZamknij).toHaveBeenCalled())
    expect(n.drukujPdf).toHaveBeenCalledWith(expect.objectContaining({ drukarka: 'bizhub', pdfBase64: 'PDF64', kopie: 1, tytul: 'Kartki palet TRUVA' }))
    expect(n.drukujPdf.mock.calls[0][0].ticket).toContain(`${KM}Tray1`)
    expect(onZamknij).toHaveBeenCalledWith({ wydrukowano: true, drukarka: 'bizhub', zasobnik: 'Zasobnik 1', kopie: 1, stron: 2 })
  })

  it('PDF z serwera nie zamienia strony', async () => {
    const onZamknij = await otworz({ zrodlo: { typ: 'pdf', pdfBase64: 'SERWER64' } })
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    await waitFor(() => expect(onZamknij).toHaveBeenCalled())
    expect(n.stronaPdf).not.toHaveBeenCalled()
    expect(n.drukujPdf.mock.calls[0][0].pdfBase64).toBe('SERWER64')
  })

  it('zapamiętaj zapisuje ustawienia rodzaju', async () => {
    await otworz()
    fireEvent.change(screen.getByLabelText('Kopie'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    await waitFor(() => expect(JSON.parse(plik.tresc).dokumenty?.['kartki-palet']?.kopie).toBe(2))
    expect(JSON.parse(plik.tresc).dokumenty['kartki-palet'].drukarka).toBe('bizhub')
  })

  it('bez zapamiętania nic nie zapisuje', async () => {
    const onZamknij = await otworz()
    fireEvent.click(screen.getByLabelText('Zapamiętaj dla „Kartki palet”'))
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    await waitFor(() => expect(onZamknij).toHaveBeenCalled())
    expect(JSON.parse(plik.tresc).dokumenty?.['kartki-palet']).toBeUndefined()
  })

  it('błąd druku pokazuje komunikat i przycisk systemowy', async () => {
    n.drukujPdf.mockRejectedValue('Drukarka „bizhub” odrzuciła zadanie')
    const onZamknij = await otworz()
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    expect(await screen.findByText(/Nie udało się wydrukować: Drukarka „bizhub” odrzuciła zadanie/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj oknem systemowym' }))
    expect(onZamknij).toHaveBeenCalledWith({ systemowe: true })
  })

  it('kolor zasobnika zapisany per drukarka i widoczny na liście', async () => {
    await otworz()
    fireEvent.change(sel('Zasobnik papieru'), { target: { value: KM + 'Tray3' } })
    const pole = await screen.findByLabelText('Kolor papieru w zasobniku „Zasobnik 3”')
    fireEvent.change(pole, { target: { value: 'zielone' } })
    fireEvent.blur(pole)
    await waitFor(() => expect(JSON.parse(plik.tresc).koloryZasobnikow?.bizhub?.[KM + 'Tray3']).toBe('zielone'))
    expect(within(sel('Zasobnik papieru')).getByText('Zasobnik 3 – zielone')).toBeTruthy()
  })

  it('ustawienia drukarki z okna sterownika wracają do okna', async () => {
    n.ustawieniaSterownika.mockResolvedValue('T-konica')
    await otworz()
    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia drukarki…' }))
    await waitFor(() => expect(n.mozliwosci).toHaveBeenLastCalledWith('bizhub', 'T-konica'))
  })

  it('anuluj zamyka bez druku', async () => {
    const onZamknij = await otworz()
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(onZamknij).toHaveBeenCalledWith({ wydrukowano: false })
    expect(n.drukujPdf).not.toHaveBeenCalled()
  })

  it('kartki palet bez zakresu stron (rejestr oznacza całe palety), inne dokumenty z zakresem', async () => {
    await otworz()
    expect(screen.queryByLabelText('Od strony')).toBeNull()
    cleanup()
    await otworz({ rodzaj: 'wz' })
    expect(screen.getByLabelText('Od strony')).toBeTruthy()
  })

  it('podgląd: strony tego samego PDF, który idzie do drukarki (PDF robiony raz)', async () => {
    const onZamknij = await otworz({ rodzaj: 'wz' })
    const pg = screen.getByRole('region', { name: 'Podgląd wydruku' })
    await waitFor(() => expect(within(pg).getAllByRole('img')).toHaveLength(3))
    expect(podglad.stronyPodgladu.mock.calls[0][0]).toBe('PDF64')
    expect(within(pg).getByText(/3 strony × 1 kopia/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    await waitFor(() => expect(onZamknij).toHaveBeenCalled())
    expect(n.stronaPdf).toHaveBeenCalledTimes(1)
    expect(n.drukujPdf.mock.calls[0][0].pdfBase64).toBe('PDF64')
  })

  it('podgląd: zakres stron przyciemnia resztę, kopie i zasobnik w pasku, czarno-biało w szarości', async () => {
    await otworz({ rodzaj: 'wz' })
    const pg = screen.getByRole('region', { name: 'Podgląd wydruku' })
    await waitFor(() => expect(within(pg).getAllByRole('img')).toHaveLength(3))
    fireEvent.click(screen.getByLabelText('od'))
    fireEvent.change(screen.getByLabelText('Do strony'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Kopie'), { target: { value: '2' } })
    expect(within(pg).getByText(/2 strony × 2 kopie/)).toBeTruthy()
    expect(within(pg).getByAltText('Strona 3').closest('figure')!.className).toContain('od-poza')
    expect(within(pg).getByAltText('Strona 1').closest('figure')!.className).not.toContain('od-poza')
    await waitFor(() => expect(within(pg).getByText(/Zasobnik 1/)).toBeTruthy())
    expect(pg.querySelector('.od-cb')).toBeTruthy()
    fireEvent.change(sel('Kolor'), { target: { value: PSK + 'Color' } })
    await waitFor(() => expect(pg.querySelector('.od-cb')).toBeNull())
  })

  it('opcje po polsku, także gdy sterownik podaje je po angielsku', async () => {
    n.mozliwosci.mockImplementation(async () => ({
      ...mozliwosci(), funkcje: mozliwosci().funkcje.map(f => (f.id === PSK + 'PageInputBin'
        ? { ...f, nazwa: 'Paper Source', opcje: [{ id: PSK + 'AutoSelect', nazwa: 'Auto Select' }, { id: KM + 'Tray1', nazwa: 'Tray 1' }, { id: KM + 'Tray3', nazwa: 'Tray 3' }] }
        : f.id === KM + 'Staple' ? { ...f, nazwa: 'Staple', opcje: [{ id: KM + 'Off', nazwa: 'Off' }, { id: KM + 'Corner', nazwa: 'Corner' }] } : f)),
    }))
    await otworz()
    expect(within(sel('Zasobnik papieru')).getByText('Wybór automatyczny')).toBeTruthy()
    expect(within(sel('Zasobnik papieru')).getByText('Zasobnik 3')).toBeTruthy()
    expect(within(sel('Zszywanie')).getByText('Wyłączone')).toBeTruthy()
    expect(within(sel('Zszywanie')).getByText('W rogu')).toBeTruthy()
  })

  it('błąd podglądu nie blokuje druku', async () => {
    podglad.stronyPodgladu.mockRejectedValue(new Error('zły PDF'))
    const onZamknij = await otworz()
    expect(await screen.findByText('Podgląd niedostępny: zły PDF')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj' }))
    await waitFor(() => expect(onZamknij).toHaveBeenCalledWith(expect.objectContaining({ wydrukowano: true })))
  })
})
