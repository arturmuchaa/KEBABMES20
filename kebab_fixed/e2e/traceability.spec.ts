import { test, expect } from '@playwright/test'

/**
 * SZKIELET — traceability raw↔finished (kontrakt z ../CLAUDE.md).
 *
 * Wymaga: backend (:8000) + ZASEEDOWANA baza testowa. Dlatego cały blok jest
 * `skip` dopóki nie ustawisz selektorów i danych startowych.
 *
 * UWAGA: logika rozbicia per partia jest już pokryta unit-testami w
 * backend/tests/ (test_finished_units, test_component_allocation, ...).
 * Te E2E mają chronić PEŁNY przepływ przez UI — to czego unit nie złapie.
 *
 * Plan przepływu do zaimplementowania:
 *  1. Przyjęcie partii surowca 1000 kg (raw_batch).
 *  2. Produkcja: zużycie 200 kg → finished batch + stock_movement.
 *  3. Asercja: dostępny surowiec = 800 kg (kontrakt 1000→use 200→expect 800).
 *  4. Trace W PRZÓD:  raw → finished (lista wyrobów z tej partii).
 *  5. Trace WSTECZ:   finished → raw (z wyrobu wskaż partię surowca).
 *  6. Asercja: każda zmiana stocku ma odpowiadający stock_movement (brak cichych mutacji).
 */
test.describe('traceability raw↔finished (E2E przez UI)', () => {
  test.skip(true, 'TODO: backend + seed bazy testowej + selektory ekranów')

  test('1000 kg → zużyj 200 → zostaje 800 (z movementem)', async ({ page }) => {
    await page.goto('/') // TODO: ekran magazynu surowca
    // TODO: utwórz raw_batch 1000 kg, odpal produkcję 200 kg
    // TODO: const available = ...; expect(available).toBe(800)
    expect(true).toBe(true)
  })

  test('trace w przód i wstecz spina surowiec z wyrobem', async ({ page }) => {
    await page.goto('/') // TODO: ekran traceability
    // TODO: raw → finished, finished → raw, asercja spójności numerów partii
    expect(true).toBe(true)
  })
})
