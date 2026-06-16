import { test, expect } from '@playwright/test'

/**
 * SZKIELET — HMI v2 masowania (maszyny w trakcie + zmiana partii).
 * Wymaga: backend (:8010) + zaseedowana baza + zalogowany operator produkcji.
 * `skip` dopóki nie ustawisz seeda i selektorów. Kontrakt do ochrony:
 *  1. Stan pusty (brak zaplanowanych) pokazuje aktywne masownice z timerem.
 *  2. Karta zlecenia pokazuje rozbicie kg-z-partii.
 *  3. „Zmień partię" otwiera listę FEFO, blokuje partie z za małą ilością kg,
 *     a po wyborze podmienia partię na ekranie mięsa.
 */
test.describe('masownia HMI v2', () => {
  test.skip(true, 'TODO: seed bazy + selektory + tryb HMI v2 (localStorage mieszanie_hmi_mode=v2)')

  test('stan pusty pokazuje masownice w pracy z timerem', async ({ page }) => {
    await page.goto('/tablet/mieszanie')
    // TODO: ustaw mieszanie_hmi_mode=v2, zasiej lock; expect tekst "Masownice w pracy"
    expect(true).toBe(true)
  })

  test('zmiana partii pokazuje listę FEFO i podmienia wiersz', async ({ page }) => {
    await page.goto('/tablet/mieszanie')
    // TODO: wejdź w zlecenie → maszyna → ekran mięsa → "Zmień partię"; expect lista FEFO
    expect(true).toBe(true)
  })
})
