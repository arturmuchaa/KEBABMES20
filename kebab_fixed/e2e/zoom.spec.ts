import { test, expect, Page } from '@playwright/test'

/**
 * REGRESJA ZOOM — bug "opcje rozjeżdżają się przy 125/150%".
 *
 * Mechanizm (src/features/ui/useZoom.ts):
 *  - zoom aplikowany jako document.documentElement.style.zoom
 *  - Radix popper (Select/Dropdown) pozycjonowany przez getBoundingClientRect,
 *    który w trybie "visual" (nowy Chromium/WebView2) skaluje współrzędne →
 *    trzeba kompensować zoom na wrapperze. Stała kompensacja PSUŁA tryb "layout".
 *
 * Część A działa bez backendu (czysta logika zoomu na <html>).
 * Część B (wyrównanie popper↔trigger) wymaga widocznego Radix Select →
 *   uzupełnić selektory dla konkretnej strony (TODO) i odpalić z backendem.
 */

const KEY = 'kebab.zoom'

async function htmlZoom(page: Page): Promise<string> {
  return page.evaluate(() => (document.documentElement.style as any).zoom || '')
}

test.describe('zoom — rdzeń (bez backendu)', () => {
  test('Ctrl+= zwiększa, Ctrl+- zmniejsza, Ctrl+0 resetuje', async ({ page }) => {
    await page.goto('/')
    // reset do 100%
    await page.keyboard.press('Control+0')
    expect(await htmlZoom(page)).toBe('') // 100% => brak inline zoom

    await page.keyboard.press('Control+=')
    expect(await htmlZoom(page)).toBe('110%') // następny krok po 100

    await page.keyboard.press('Control+=')
    expect(await htmlZoom(page)).toBe('125%')

    await page.keyboard.press('Control+-')
    expect(await htmlZoom(page)).toBe('110%')

    await page.keyboard.press('Control+0')
    expect(await htmlZoom(page)).toBe('')
  })

  test('wartość zoomu jest trwała w localStorage (per stanowisko)', async ({ page }) => {
    await page.goto('/')
    await page.evaluate((k) => localStorage.setItem(k, '150'), KEY)
    await page.reload()
    expect(await htmlZoom(page)).toBe('150%')
  })

  test('wartość spoza listy jest clampowana do najbliższego kroku', async ({ page }) => {
    await page.goto('/')
    await page.evaluate((k) => localStorage.setItem(k, '137'), KEY) // → 125 lub 150
    await page.reload()
    const z = await htmlZoom(page)
    expect(['125%', '150%']).toContain(z)
  })
})

/**
 * Część B — REALNY bug: pozycja listy rozwijanej przy 125/150%.
 * Wymaga strony z widocznym <Select> (Radix). Uzupełnij selektory i zdejmij skip.
 */
test.describe('zoom — wyrównanie popper Radix do triggera', () => {
  test.skip(true, 'TODO: ustaw route + selektory triggera Select dla realnej strony')

  for (const zoom of ['125', '150'] as const) {
    test(`opcje wyrównane do triggera przy ${zoom}%`, async ({ page }) => {
      await page.evaluate((args) => localStorage.setItem(args.k, args.z), { k: KEY, z: zoom })
      await page.goto('/') // TODO: route ze stroną zawierającą Select

      // TODO: zamień na realny selektor triggera (np. data-testid)
      const trigger = page.locator('[data-radix-select-trigger]').first()
      await trigger.click()

      const wrapper = page.locator('[data-radix-popper-content-wrapper]').first()
      await expect(wrapper).toBeVisible()

      const t = await trigger.boundingBox()
      const w = await wrapper.boundingBox()
      expect(t && w).toBeTruthy()
      // lewa krawędź listy powinna trzymać się triggera (bug = ucieczka w bok)
      expect(Math.abs((w!.x) - (t!.x))).toBeLessThan(8)
    })
  }
})
