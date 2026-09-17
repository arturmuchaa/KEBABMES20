import { test, expect } from '@playwright/test'

/**
 * Panel masowania — bramka partii wskazanych przez biuro.
 *
 * Kontrakt do ochrony: jeśli biuro zaplanowało masowanie NA KONKRETNYCH
 * partiach, operator może dotknąć tylko tych kafelków; jeśli nie wskazało
 * nic, wolno wziąć wszystko, co leży. Oba przypadki są na produkcji częste,
 * a pomyłka jest po zamknięciu pokrywy masownicy nie do odkręcenia.
 *
 * Wymaga: backend (:8000) + baza zasiana przez `e2e/seed_e2e.py`
 * (operator masowni z PIN-em 1234, dwie partie z paletami, dwa zlecenia).
 */

/** Splash kiosku trzyma logo 5 s, potem dopiero jest ekran PIN-u. */
async function zalogujOperatora(page: import('@playwright/test').Page) {
  await page.goto('/masowanie.html')
  await expect(page.getByRole('button', { name: /OPERATOR MASOWNI/ })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /OPERATOR MASOWNI/ }).click()
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Zaloguj' }).click()
  await expect(page.getByText('Masownica 1')).toBeVisible({ timeout: 15_000 })
}

async function wejdzWMieso(page: import('@playwright/test').Page, zlecenie: string) {
  await page.getByRole('button', { name: /Załaduj masownicę/ }).click()
  await expect(page.getByText('Wsad i masownica')).toBeVisible()
  // `exact` — w szynie u góry stoi kafel o tej samej nazwie z dopiskiem stanu.
  await page.getByRole('button', { name: 'Masownica 1', exact: true }).click()
  await page.getByRole('button', { name: `Wsad ${zlecenie}`, exact: true }).click()
  await page.getByRole('button', { name: /Dalej — mięso/ }).click()
  await expect(page.getByText('Mięso do wsadu')).toBeVisible()
}

test.describe('panel masowania — bramka partii', () => {
  test('zlecenie z partią biura puszcza tylko tę partię', async ({ page }) => {
    await zalogujOperatora(page)
    await wejdzWMieso(page, 'MAS/E2E/1')

    await expect(page.getByRole('button', { name: /PAL\/E2E\/511/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /PAL\/E2E\/513/ })).toBeDisabled()
    await expect(page.getByText(/Biuro wskazało partię: E2E-511/)).toBeVisible()
  })

  test('zlecenie bez partii puszcza całe mięso na stanie', async ({ page }) => {
    await zalogujOperatora(page)
    await wejdzWMieso(page, 'MAS/E2E/2')

    await expect(page.getByRole('button', { name: /PAL\/E2E\/511/ })).toBeEnabled()
    await expect(page.getByRole('button', { name: /PAL\/E2E\/513/ })).toBeEnabled()
  })
})
