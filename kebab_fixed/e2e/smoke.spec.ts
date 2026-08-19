import { test, expect } from '@playwright/test'

/**
 * Smoke na PRAWDZIWYM stosie: obraz produkcyjny + świeża baza + zasiane dane.
 *
 * POWÓD ISTNIENIA: do 19.08.2026 e2e w CI nie działało wcale (brak backendu
 * i konta testowego), więc jedyne, co sprawdzało, to czy Playwright się
 * uruchomi. Tego samego dnia trzy błędy trafiły do biura mimo kompletu
 * zielonych testów — bo żyły w miejscach, których testy jednostkowe nie
 * dotykają: kolejności efektów i mapowaniu pól.
 *
 * Zakres jest CELOWO wąski: logowanie, lista dostaw, edycja dostawy. To trzy
 * rzeczy, bez których biuro o szóstej rano nie ruszy. Reszta (wydajności,
 * bilanse, alokacje) jest tańsza i pewniejsza do sprawdzenia w testach
 * jednostkowych — tam ma zostać.
 *
 * Dane sieje `e2e/seed_e2e.py`: konto `e2e`, dostawca TESTOWY, dostawa E2E/1
 * na dwa numery porządkowe.
 */

const LOGIN = process.env.E2E_LOGIN || 'e2e'
const HASLO = process.env.E2E_PASSWORD || 'e2e-haslo-testowe'

async function zaloguj(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[placeholder="Login"]', LOGIN)
  await page.fill('input[placeholder="Hasło"]', HASLO)
  await page.click('button:has-text("Zaloguj")')
  await expect(page).toHaveURL(/\/office/, { timeout: 15_000 })
}

test.describe('smoke — poranek biura', () => {
  test('bez logowania MES nie wpuszcza do biura', async ({ page }) => {
    await page.goto('/office/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('logowanie wpuszcza do biura', async ({ page }) => {
    await zaloguj(page)
  })

  test('lista dostaw pokazuje zasianą dostawę', async ({ page }) => {
    await zaloguj(page)
    await page.goto('/office/raw-batches')
    // Numery porządkowe zasianej dostawy — pierwsze dwa w świeżej bazie.
    await expect(page.getByText('TESTOWY').first()).toBeVisible({ timeout: 15_000 })
  })

  test('edycja dostawy otwiera się z JEJ danymi, nie pusta', async ({ page }) => {
    // To jest ta regresja, która 19.08 trafiła do biura dwa razy pod rząd:
    // formularz edycji wstawał pusty, a numery porządkowe pokazywał jako #1.
    await zaloguj(page)
    await page.goto('/office/raw-batches')
    await page.getByTitle('Edytuj').first().click()
    await expect(page).toHaveURL(/\/edycja$/, { timeout: 15_000 })
    await expect(page.getByText(/Edycja dostawy/)).toBeVisible()
    // Waga z HDI musi być w polu — pusty formularz znaczy, że dane nie doszły.
    await expect(page.locator('input[value="4800"]').first()).toBeVisible({ timeout: 15_000 })
  })
})
