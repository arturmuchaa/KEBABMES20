import { test, expect, Page } from '@playwright/test'

/**
 * KARTKI NA PALETY — czy naprawdę mieszczą się na jednej stronie.
 *
 * Właściciel (2026-09-09): „dostosuj tak, aby wszystko było maksymalnie jak
 * największą czcionką, ale dopasowywało się do 1 strony, jak np. 3 pozycje".
 *
 * Testy jednostkowe tego NIE złapią: jsdom nie liczy layoutu, więc
 * `scrollWidth`/`scrollHeight` są tam zerami i auto-fit zawsze „mieści się"
 * na 90pt. Dopasowanie da się sprawdzić tylko w silniku, który naprawdę
 * składa tekst — a desktop biura to Tauri WebView2, czyli Chromium.
 *
 * Bez backendu: dane wchodzą przez przechwycone odpowiedzi API.
 */

const ZAMOWIENIE = {
  id: 'o1',
  order_no: 'YALCIN/Z/4/09/26',
  client_id: 'c1',
  client_name: 'YALCIN',
  order_date: '2026-09-09',
  status: 'confirmed',
  lines: [
    { id: 'l1', qty: 10, kg_per_unit: 80, total_kg: 800,
      product_type_id: 'pt1', product_type_name: 'KEBAB UDO 100%',
      recipe_id: 'r1', recipe_name: 'BEYAZ AFIYET', packaging_name: 'METAL 60CM' },
    { id: 'l2', qty: 5, kg_per_unit: 40, total_kg: 200,
      product_type_id: 'pt1', product_type_name: 'KEBAB UDO 100%',
      recipe_id: 'r2', recipe_name: 'KIRMIZI', packaging_name: 'METAL 80CM' },
    { id: 'l3', qty: 8, kg_per_unit: 30, total_kg: 240,
      product_type_id: 'pt1', product_type_name: 'KEBAB UDO 100%',
      recipe_id: 'r3', recipe_name: 'SHORMA TRUVA + AROMAT', packaging_name: 'METAL 75CM' },
  ],
}

/** Paleta o zadanym składzie pozycji. */
const paleta = (palletNo: number, cartonNo: string, items: [string, number][]) => ({
  id: `p${palletNo}`, pallet_no: palletNo, carton_no: cartonNo, notes: '',
  items: items.map(([order_line_id, qty]) => ({ order_line_id, qty })),
})

async function zamockuj(page: Page, palety: unknown[]) {
  await page.route('**/api/client-orders/o1/pallets', route =>
    route.fulfill({ json: palety }))
  await page.route('**/api/client-orders/o1', route =>
    route.fulfill({ json: ZAMOWIENIE }))
  // Strona druku nie wisi na sesji, ale reszta powłoki aplikacji pyta o „ja".
  await page.route('**/api/auth/me', route =>
    route.fulfill({ json: { id: 'u1', login: 'e2e', role: 'admin', fullName: 'E2E' } }))
}

/** Pomiar jednej kartki: stopień pisma i czy treść wychodzi poza stronę. */
async function zmierz(page: Page) {
  return page.evaluate(() => {
    const strony = [...document.querySelectorAll('[data-testid="label-page"]')]
    return strony.map(strona => {
      const tresc = strona.querySelector('[data-testid="label-page"] div div div') as HTMLElement | null
      // Treść główna to jedyny element z Arial Black na stronie.
      const glowna = [...strona.querySelectorAll<HTMLElement>('div')]
        .find(el => getComputedStyle(el).fontFamily.includes('Arial Black'))
      const pudlo = glowna?.parentElement as HTMLElement | undefined
      return {
        fontPx: glowna ? parseFloat(getComputedStyle(glowna).fontSize) : 0,
        // Czy treść zmieściła się w swoim pudle (a więc i na stronie A4).
        miesciSieW: !!pudlo && !!glowna
          && glowna.scrollWidth <= pudlo.clientWidth
          && glowna.scrollHeight <= pudlo.clientHeight,
        wysStrony: (strona as HTMLElement).scrollHeight,
        wysWidoczna: (strona as HTMLElement).clientHeight,
        widoczna: !!glowna && getComputedStyle(glowna).visibility === 'visible',
        _t: tresc ? 1 : 0,
      }
    })
  })
}

async function otworz(page: Page, palety: unknown[], query = '') {
  await zamockuj(page, palety)
  // Auto-druk otwarłby natywne okno drukowania i zablokował test.
  await page.addInitScript(() => { window.print = () => {} })
  await page.goto(`/office/zamowienia/o1/palety/druk${query}`)
  await page.waitForSelector('[data-testid="label-page"]')
  // Auto-fit biegnie w requestAnimationFrame — czekamy, aż treść się odsłoni.
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-testid="label-page"] div')]
      .find(e => getComputedStyle(e).fontFamily.includes('Arial Black'))
    return !!el && getComputedStyle(el).visibility === 'visible'
  })
}

test.describe('kartki palet — dopasowanie do jednej strony', () => {
  test('jedna pozycja: duża czcionka, treść w granicach strony', async ({ page }) => {
    await otworz(page, [paleta(1, '000001', [['l1', 10]])], '?palety=1')
    const kartki = await zmierz(page)
    expect(kartki).toHaveLength(2)                      // dwie kopie
    for (const k of kartki) {
      expect(k.miesciSieW).toBe(true)
      expect(k.wysStrony).toBeLessThanOrEqual(k.wysWidoczna + 1)
      expect(k.fontPx).toBeGreaterThan(40)              // ma być NAPRAWDĘ duża
    }
  })

  test('trzy pozycje z recepturami mieszczą się na jednej stronie', async ({ page }) => {
    // Przypadek wprost z prośby właściciela („jak np. 3 pozycje"), w dodatku
    // z najdłuższą realną nazwą receptury i dwiema tulejami niestandardowymi.
    await otworz(page, [paleta(1, '000001',
      [['l1', 10], ['l2', 5], ['l3', 8]])], '?palety=1')
    const kartki = await zmierz(page)
    for (const k of kartki) {
      expect(k.miesciSieW).toBe(true)
      expect(k.wysStrony).toBeLessThanOrEqual(k.wysWidoczna + 1)
      expect(k.fontPx).toBeGreaterThan(20)
    }
  })

  test('mniej pozycji = większa czcionka', async ({ page }) => {
    await otworz(page, [paleta(1, '000001', [['l1', 10]])], '?palety=1')
    const jedna = (await zmierz(page))[0].fontPx
    await otworz(page, [paleta(1, '000001',
      [['l1', 10], ['l2', 5], ['l3', 8]])], '?palety=1')
    const trzy = (await zmierz(page))[0].fontPx
    expect(jedna).toBeGreaterThan(trzy)
  })

  test('kartka niesie klienta, receptury i tuleje niestandardowe', async ({ page }) => {
    await otworz(page, [paleta(1, '000001',
      [['l1', 10], ['l2', 5]])], '?palety=1')
    await expect(page.getByText('10 X 80KG (BEYAZ AFIYET)').first()).toBeVisible()
    await expect(page.getByText('5 X 40KG (KIRMIZI · 80CM)').first()).toBeVisible()
    await expect(page.getByText('YALCIN').first()).toBeVisible()
  })

  test('wiele palet: każda po dwie kartki, każda mieści się na stronie', async ({ page }) => {
    await otworz(page, [
      paleta(1, '000001', [['l1', 10]]),
      paleta(2, '000002', [['l2', 5]]),
      paleta(3, '000003', [['l1', 4], ['l2', 2], ['l3', 8]]),
    ])
    const kartki = await zmierz(page)
    expect(kartki).toHaveLength(6)
    for (const k of kartki) expect(k.miesciSieW).toBe(true)
    const numery = await page.locator('[data-testid="label-corner-no"]').allTextContents()
    expect(numery).toEqual(['000001', '000001', '000002', '000002', '000003', '000003'])
  })

  test('stary adres pojedynczej palety dalej działa', async ({ page }) => {
    await zamockuj(page, [paleta(2, '000002', [['l1', 10]])])
    await page.addInitScript(() => { window.print = () => {} })
    await page.goto('/office/zamowienia/o1/palety/2/druk')
    await page.waitForSelector('[data-testid="label-page"]')
    expect(page.url()).toContain('/palety/druk?palety=2')
    expect(await page.locator('[data-testid="label-page"]').count()).toBe(2)
  })
})
