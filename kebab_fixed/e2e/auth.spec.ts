import { test, expect } from '@playwright/test'

// Wymaga działającego backendu + bazy (CI). Lokalnie OOM — uruchamiać w CI.
test.describe('auth', () => {
  test('niezalogowany na /office wraca na /login', async ({ page }) => {
    await page.goto('/office/dashboard')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('logowanie biura wpuszcza do dashboardu', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[placeholder="Login"]', process.env.E2E_ADMIN_LOGIN || 'admin')
    await page.fill('input[placeholder="Hasło"]', process.env.E2E_ADMIN_PASSWORD || 'admin12345')
    await page.click('button:has-text("Zaloguj")')
    await expect(page).toHaveURL(/\/office\//)
  })

  test('panel hali pokazuje wybór działu lub listę', async ({ page }) => {
    await page.goto('/panel')
    await expect(page.locator('text=dział').or(page.locator('text=zaloguj'))).toBeVisible()
  })
})
