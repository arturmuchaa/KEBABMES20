import { test, expect, type Page, type Route } from '@playwright/test'
import fs from 'node:fs'

/**
 * Ekran produkcji HMI — układ „plan po lewej + panel po prawej" na
 * prawdziwym entry `produkcja.html` (React.StrictMode, SplashGate, auth).
 *
 * IZOLOWANE: całe `/api` jest zaślepione w przeglądarce (page.route),
 * a każde żądanie poza serwer Vite jest przerywane — test nie może dotknąć
 * prawdziwych danych ani backendu.
 *
 * Uruchomienie (sam Vite, bez backendu):
 *   E2E_BASE_URL=http://localhost:5199 npx playwright test e2e/production-hmi-layout.spec.ts
 * (z `npx vite --port 5199 --strictPort` w tle) albo bez E2E_BASE_URL —
 * wtedy playwright.config.ts sam postawi `npm run dev` na :5173.
 */

const RECEPTURY = ['WROCŁAW', 'KIRMIZI', 'DÖNER CLASSIC', 'BULLI', 'CHICKEN MIX', 'KEBAB XXL']
const KLIENCI = ['Bulli sp. z o.o.', 'Kebab Express Wrocław', '', 'Gastro-Hurt Poznań', 'Bar Orient']
const IMIONA = [
  'DAWID NOWAK', 'DENYS KOVAL', 'ANAR KAZIMOV', 'ANAR MAMMADOV', 'OLEH BONDAR', 'IGOR SZEWCZENKO',
  'PIOTR WIŚNIEWSKI', 'VLAD MELNYK', 'SERHII TKACHENKO', 'TOMASZ KOWALSKI', 'ARTUR LEWANDOWSKI',
  'MYKOLA SHEVCHUK', 'ROMAN BOIKO', 'JAKUB ZIELIŃSKI', 'YURII KRAVCHENKO',
]

interface Stan {
  plan: any; skany: Record<string, number>; patch: any[]; skanyWolania: any[]
  /** 20 hex z etykiety sztuki → pozycja planu (etykieta wskazuje pozycję, nie ekran). */
  sztuki: Record<string, string>
}

const linia = (i: number) => {
  const qty = [15, 20, 10, 30, 8, 25][i % 6]
  const kg = [50, 35, 40, 25, 60, 45][i % 6]
  return {
    id: `l${i + 1}`, plan_id: 'p1', qty, kg_per_unit: kg, total_kg: qty * kg,
    recipe_id: `r${i % 6}`, recipe_name: RECEPTURY[i % 6], product_type_name: 'KEBAB',
    packaging_id: 'pk1', packaging_name: i % 2 ? 'METAL 65' : 'KARTON 65',
    client_name: KLIENCI[i % 5], qty_done: i % 4 === 0 ? Math.floor(qty / 2) : 0,
    worker_entries: i % 4 === 0
      ? [{ workerId: 'w1', workerName: IMIONA[0], pieces: Math.floor(qty / 2), addedAt: '08:10' }] : [],
    line_status: i % 4 === 0 ? 'IN_PROGRESS' : 'PLANNED',
    seasoned_batch_nos: ['PP13', 'PP14'], packaging_used: 0,
  }
}

const nowyStan = (n: number): Stan => ({
  plan: {
    id: 'p1', plan_no: 'PP/1', plan_date: '2026-10-01', status: 'active',
    tablet_finished_at: null, office_confirmed_at: null,
    lines: Array.from({ length: n }, (_, i) => linia(i)),
  },
  skany: {}, patch: [], skanyWolania: [], sztuki: {},
})

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function postaw(page: Page, stan: Stan) {
  const baza = new URL(test.info().project.use.baseURL ?? 'http://localhost:5173')
  await page.addInitScript(() => localStorage.setItem('kebab.token', 'e2e-token'))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    const metoda = route.request().method()
    const p = url.pathname
    if (p.includes('/api/')) {
      if (p.endsWith('/auth/me')) return json(route, { id: 'k1', name: 'KIEROWNIK E2E', role: 'ADMIN', departments: ['produkcja'] })
      if (p.endsWith('/production-plans') && metoda === 'GET') return json(route, [stan.plan])
      if (p.endsWith('/production-plans/p1') && metoda === 'GET') return json(route, stan.plan)
      if (/\/production-plans\/p1\/lines\/[^/]+\/progress$/.test(p) && metoda === 'PATCH') {
        const body = route.request().postDataJSON()
        const id = p.split('/lines/')[1].split('/')[0]
        const l = stan.plan.lines.find((x: any) => x.id === id)
        l.qty_done = Math.min(body.qty_done, l.qty); l.worker_entries = body.worker_entries; l.line_status = body.line_status
        stan.patch.push({ id, body })
        return json(route, { ok: true, line_id: id, qty_done: l.qty_done, line_status: l.line_status })
      }
      if (p.endsWith('/production-plans/p1/breaks')) return json(route, [])
      if (p.endsWith('/finished-units/plan-progress')) {
        return json(route, stan.plan.lines.map((l: any) => ({ planLineId: l.id, total: l.qty, scanned: stan.skany[l.id] ?? 0 })))
      }
      if (p.endsWith('/finished-units/scan-produced')) {
        const body = route.request().postDataJSON()
        stan.skanyWolania.push(body)
        const hex = String(body.code ?? '').match(/([0-9a-f]{20})$/i)?.[1]?.toLowerCase() ?? ''
        const id = stan.sztuki[hex] ?? body.plan_line_id ?? 'l1'
        if (body.expected_plan_id && body.expected_plan_id !== 'p1') return json(route, { detail: 'Sztuka z innego planu' }, 409)
        const l = stan.plan.lines.find((x: any) => x.id === id)
        stan.skany[id] = (stan.skany[id] ?? 0) + 1
        return json(route, { ok: true, unitId: hex, status: 'produced', clientName: 'Bulli sp. z o.o.',
          batchNo: '250826 344', weightKg: l.kg_per_unit, done: stan.skany[id], total: l.qty, onStock: true,
          planId: 'p1', planLineId: id, recipeName: l.recipe_name, productTypeName: l.product_type_name })
      }
      if (p.endsWith('/workers')) {
        return json(route, IMIONA.map((name, i) => ({ id: `w${i + 1}`, name, role: 'WORKER_PRODUCTION', active: true })))
      }
      if (p.endsWith('/production-rates')) return json(route, { seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} })
      if (p.endsWith('/production-day-materials')) return json(route, [])
      if (p.endsWith('/production-wrapping')) return json(route, [])
      if (p.endsWith('/packaging/all')) return json(route, [{ id: 'pk1', name: 'KARTON 65', type: 'tuleja', kg_available: 100 }])
      // Wszystko inne z API: puste, ale NIGDY nie do prawdziwego serwera.
      return json(route, metoda === 'GET' ? [] : { ok: true })
    }
    if (url.host !== baza.host) return route.abort()
    return route.continue()
  })
}

async function wejdz(page: Page, stan: Stan) {
  await postaw(page, stan)
  await page.goto('/produkcja.html')
  // SplashGate trzyma logo 5 s — czekamy na prawdziwy ekran.
  await expect(page.getByTestId('hmi-produkcja-glowny')).toBeVisible({ timeout: 20_000 })
  if (stan.plan.lines.length) await expect(page.getByTestId('pozycja-planu-l1')).toBeVisible()
}

/** Nic nie przewija się ani nie wystaje: dokument, rama ekranu, lista planu. */
async function bezPrzewijania(page: Page) {
  const m = await page.evaluate(() => {
    const el = (s: string) => document.querySelector(s) as HTMLElement | null
    const pomiar = (e: HTMLElement | null) => e && ({
      sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth,
    })
    return {
      doc: pomiar(document.scrollingElement as HTMLElement),
      root: pomiar(el('.phmi-root')),
      lista: pomiar(el('[data-testid="plan-przewijanie"]')),
      scroll: el('[data-testid="plan-lista"]')?.dataset.scroll,
    }
  })
  for (const [k, v] of Object.entries({ doc: m.doc, root: m.root, lista: m.lista })) {
    if (!v) continue
    expect(v.sh, `${k}: scrollHeight ≤ clientHeight`).toBeLessThanOrEqual(v.ch + 1)
    expect(v.sw, `${k}: scrollWidth ≤ clientWidth`).toBeLessThanOrEqual(v.cw + 1)
  }
  if (m.scroll !== undefined) expect(m.scroll).toBe('0')
}

/** Każdy wiersz w ekranie, a w nim widać „15 × 50 kg", rodzaj, zrobione/plan i skan. */
async function wierszeWidoczne(page: Page, n: number) {
  const vp = page.viewportSize()!
  const wyniki = await page.evaluate((ile) => {
    const out: any[] = []
    for (let i = 1; i <= ile; i++) {
      const w = document.querySelector(`[data-testid="pozycja-planu-l${i}"]`) as HTMLElement | null
      if (!w) { out.push({ i, brak: true }); continue }
      const r = w.getBoundingClientRect()
      const spany = Array.from(w.querySelectorAll('span'))
      const glowny = spany.find(s => /×/.test(s.textContent ?? '') && s.children.length === 0) as HTMLElement | undefined
      const rodzaj = glowny?.nextElementSibling as HTMLElement | null
      const postep = w.querySelector(`[data-testid="postep-l${i}"]`) as HTMLElement
      const skan = w.querySelector(`[data-testid="skan-l${i}"]`) as HTMLElement
      const box = (e: HTMLElement | null | undefined) => {
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { x: b.x, y: b.y, w: b.width, h: b.height, fs: parseFloat(getComputedStyle(e).fontSize) }
      }
      out.push({ i, row: { x: r.x, y: r.y, w: r.width, h: r.height },
        glowny: box(glowny), glownyPelny: glowny ? glowny.scrollWidth <= glowny.clientWidth + 1 : false,
        rodzaj: box(rodzaj), rodzajTekst: rodzaj?.textContent,
        rodzajPelny: rodzaj ? rodzaj.scrollWidth <= rodzaj.clientWidth + 1 : false,
        postep: box(postep), skan: box(skan) })
    }
    return out
  }, n)
  for (const w of wyniki) {
    expect(w.brak, `wiersz ${w.i} istnieje`).toBeFalsy()
    expect(w.row.y, `wiersz ${w.i} od góry`).toBeGreaterThanOrEqual(0)
    expect(w.row.y + w.row.h, `wiersz ${w.i} mieści się w pionie`).toBeLessThanOrEqual(vp.height)
    expect(w.row.x + w.row.w, `wiersz ${w.i} mieści się w poziomie`).toBeLessThanOrEqual(vp.width)
    expect(w.row.h, `wiersz ${w.i} jest celem dotykowym`).toBeGreaterThanOrEqual(30)
    for (const k of ['glowny', 'rodzaj', 'postep', 'skan'] as const) {
      const b = w[k]
      expect(b, `wiersz ${w.i}: ${k}`).toBeTruthy()
      expect(b.w, `wiersz ${w.i}: ${k} ma szerokość`).toBeGreaterThan(k === 'rodzaj' ? 40 : 10)
      expect(b.x + b.w, `wiersz ${w.i}: ${k} w wierszu`).toBeLessThanOrEqual(w.row.x + w.row.w + 1)
      expect(b.fs, `wiersz ${w.i}: ${k} czytelna czcionka`).toBeGreaterThanOrEqual(13)
    }
    expect(w.glownyPelny, `wiersz ${w.i}: „ilość × waga" nieucięte`).toBe(true)
    // Zwykłe nazwy rodzaju mieszczą się w całości — klient ustępuje pierwszy.
    if (ZWYKLE_RODZAJE.includes(w.rodzajTekst)) {
      expect(w.rodzajPelny, `wiersz ${w.i}: rodzaj „${w.rodzajTekst}" nieucięty`).toBe(true)
    }
  }
}

const ZWYKLE_RODZAJE = ['WROCŁAW', 'KIRMIZI', 'CHICKEN MIX', 'BULLI', 'KEBAB XXL']

/** Wskazówka gestu stoi na ekranie cały czas, czytelna i nad planem. */
async function wskazowkaWidoczna(page: Page) {
  const h = page.getByTestId('plan-wskazowka-widoczna')
  await expect(h).toBeVisible()
  await expect(h).toContainText('Przytrzymaj → szczegóły')
  const m = await h.evaluate(e => ({ fs: parseFloat(getComputedStyle(e).fontSize), pelny: e.scrollWidth <= e.clientWidth + 1 }))
  expect(m.fs).toBeGreaterThanOrEqual(13)
  expect(m.pelny, 'wskazówka nieucięta').toBe(true)
}

/**
 * Panel pozycji: teksty (nagłówek, „wykonano", licznik) i cele dotykowe
 * (ilości, ±, zapis, korekta, szczegóły, kafle załogi) sprawdzane
 * OSOBNO — tekst ma być czytelny, a nie wysoki jak przycisk.
 *
 * Każdy element musi leżeć w SWOIM kontenerze, nie tylko w oknie: kafel
 * schowany pod rzędem ilości ma bounding box w viewport, ale nie da się go
 * dotknąć. Kafle — wewnątrz siatki załogi, reszta — wewnątrz panelu.
 */
async function panelWidoczny(page: Page) {
  const m = await page.evaluate((ileOsob) => {
    const q = (s: string, root: ParentNode = document) => root.querySelector(s) as HTMLElement | null
    const panel = q('[data-testid="panel-pozycji"]')!
    const siatka = q('[role="group"][aria-label="Kto teraz liczy"]')!
    const box = (e: HTMLElement) => {
      const b = e.getBoundingClientRect()
      return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }
    }
    const opis = (e: HTMLElement | null) => e && ({
      ...box(e), fs: parseFloat(getComputedStyle(e).fontSize),
      pelny: e.scrollWidth <= e.clientWidth + 1, tekst: (e.textContent ?? '').trim(),
    })
    const teksty = Object.fromEntries(['pozycja-naglowek', 'wykonano', 'licznik', 'skan-pozycji', 'wynik-zapisu']
      .map(id => [id, opis(q(`[data-testid="${id}"]`, panel))]))
    const przyciski = Object.fromEntries([
      ...['ile-1', 'ile-3', 'ile-5', 'zapisz', 'korekta', 'szczegoly']
        .map(id => [id, q(`[data-testid="${id}"]`, panel)] as const),
      ['mniej', q('button[aria-label="mniej"]', panel)] as const,
      ['więcej', q('button[aria-label="więcej"]', panel)] as const,
    ].map(([id, e]) => [id, opis(e)]))
    const kafle = Array.from({ length: ileOsob }, (_, i) => {
      const e = q(`[data-testid="pracownik-w${i + 1}"]`, siatka)
      const imie = e?.querySelector('span') as HTMLElement | null
      return { id: `pracownik-w${i + 1}`, ...(opis(e) ?? { brak: true }), imie: imie ? opis(imie) : null }
    })
    const ile = q('[data-testid="ile-1"]', panel)!.parentElement!
    return {
      panel: box(panel), siatka: { ...box(siatka), sh: siatka.scrollHeight, ch: siatka.clientHeight },
      rzadIlosci: box(ile), teksty, przyciski, kafle,
    }
  }, IMIONA.length)

  const wewnatrz = (id: string, b: any, k: any, nazwa: string) => {
    expect(b.x, `${id}: lewa krawędź w ${nazwa}`).toBeGreaterThanOrEqual(k.x - 1)
    expect(b.y, `${id}: góra w ${nazwa}`).toBeGreaterThanOrEqual(k.y - 1)
    expect(b.r, `${id}: prawa krawędź w ${nazwa}`).toBeLessThanOrEqual(k.r + 1)
    expect(b.b, `${id}: dół w ${nazwa}`).toBeLessThanOrEqual(k.b + 1)
  }
  const vp = page.viewportSize()!
  wewnatrz('panel-pozycji', m.panel, { x: 0, y: 0, r: vp.width, b: vp.height }, 'oknie')

  // Teksty: są, czytelne, w panelu. „wykonano"/licznik/nagłówek nie ucięte.
  for (const [id, t] of Object.entries(m.teksty) as [string, any][]) {
    expect(t, id).toBeTruthy()
    wewnatrz(id, t, m.panel, 'panelu')
    expect(t.fs, `${id}: czytelna czcionka`).toBeGreaterThanOrEqual(13)
    if (id !== 'wynik-zapisu') expect(t.pelny, `${id}: tekst nieucięty`).toBe(true)
  }

  // Przyciski: cel dotykowy ≥ 36 px (główne ścieżki ≥ 44 px), w panelu.
  for (const [id, p] of Object.entries(m.przyciski) as [string, any][]) {
    expect(p, id).toBeTruthy()
    wewnatrz(id, p, m.panel, 'panelu')
    expect(p.h, `${id}: cel dotykowy`).toBeGreaterThanOrEqual(36)
    expect(p.w, `${id}: cel dotykowy (szerokość)`).toBeGreaterThanOrEqual(36)
  }
  expect(m.przyciski.zapisz.h, 'zapisz: główna ścieżka ≥ 44 px').toBeGreaterThanOrEqual(44)
  // Starej drogi „Skanuj tę pozycję" nie ma — skan idzie z głównego ekranu.
  expect(await page.getByTestId('skanuj-pozycje').count()).toBe(0)

  // Załoga mieści się bez przewijania siatki kafli.
  expect(m.siatka.sh, 'siatka załogi: scrollHeight ≤ clientHeight').toBeLessThanOrEqual(m.siatka.ch + 1)
  // Siatka nie wchodzi pod rząd ilości.
  expect(m.siatka.b, 'siatka załogi nad rzędem ilości').toBeLessThanOrEqual(m.rzadIlosci.y + 1)
  for (const k of m.kafle as any[]) {
    expect(k.brak, `${k.id} istnieje`).toBeFalsy()
    wewnatrz(k.id, k, m.siatka, 'siatce załogi')
    expect(k.h, `${k.id}: cel dotykowy`).toBeGreaterThanOrEqual(36)
    // Imię na kafelku widać (nie ucięte do zera) i ma 16 px.
    expect(k.imie?.w, `imię ${k.id}`).toBeGreaterThan(30)
    expect(k.imie?.fs, `imię ${k.id}: 16 px`).toBeGreaterThanOrEqual(16)
  }
  // Kafle i przyciski nie nachodzą na siebie.
  const cele = [...(m.kafle as any[]), ...Object.entries(m.przyciski).map(([id, p]: [string, any]) => ({ id, ...p }))]
  for (let i = 0; i < cele.length; i++) {
    for (let j = i + 1; j < cele.length; j++) {
      const a = cele[i], b = cele[j]
      const nachodza = a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1
      expect(nachodza, `${a.id} nachodzi na ${b.id}`).toBe(false)
    }
  }
}

const EKRANY = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]

// Przypadki są NIEZALEŻNE (każdy stawia własny stan) — bez `serial`, żeby
// pierwszy fail nie pomijał reszty. Jeden worker: `--workers=1` w komendzie.
test.describe('Produkcja HMI — układ plan + panel', () => {
  test.setTimeout(90_000)

  for (const vp of EKRANY) {
    test(`${vp.width}×${vp.height}: 30 pozycji i 15 osób bez przewijania, z panelem i paskiem zmian`, async ({ page }) => {
      await page.setViewportSize(vp)
      const stan = nowyStan(30)
      await wejdz(page, stan)

      await bezPrzewijania(page)
      await wierszeWidoczne(page, 30)
      await expect(page.getByTestId('plan-lista')).toHaveAttribute('data-cols', '2')
      // Stały pasek skanera: cały w oknie, gotowy bez klikania.
      await expect(page.getByTestId('pasek-skanera')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('skaner-stan')).toHaveAttribute('data-gotowy', 'true')

      // Wybór pozycji — lista zostaje, panel obok.
      await page.getByTestId('pozycja-planu-l1').click()
      await expect(page.getByTestId('panel-pozycji')).toBeVisible()
      await page.getByTestId('pracownik-w2').click()
      await bezPrzewijania(page)
      await wierszeWidoczne(page, 30)
      await panelWidoczny(page)
      await wskazowkaWidoczna(page)   // nie znika po zaznaczeniu
      // Partie NIE stoją na pierwszym ekranie.
      await expect(page.getByText('PP13')).toHaveCount(0)

      fs.mkdirSync('/tmp/opencode', { recursive: true })
      await page.screenshot({ path: `/tmp/opencode/production-hmi-${vp.width}x${vp.height}.png` })

      // Biuro zmienia plan → pasek zmian. Dalej wszystko na ekranie.
      stan.plan.lines[1].qty = 32
      await expect(page.getByTestId('pasek-zmian')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('pasek-skanera')).toBeInViewport({ ratio: 1 })
      await bezPrzewijania(page)
      await wierszeWidoczne(page, 30)
      await panelWidoczny(page)
      await wskazowkaWidoczna(page)
      await page.getByTestId('zmiany-rozwin').click()
      await expect(page.getByTestId('zmiany-lista')).toContainText('32')
      await page.screenshot({ path: `/tmp/opencode/production-hmi-${vp.width}x${vp.height}-pasek.png` })
    })
  }

  for (const n of [1, 10, 15, 20]) {
    test(`1280×720: ${n} pozycji mieści się bez przewijania`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await wejdz(page, nowyStan(n))
      await bezPrzewijania(page)
      await wierszeWidoczne(page, n)
      await page.getByTestId('pozycja-planu-l1').click()
      await page.getByTestId('pracownik-w1').click()
      await bezPrzewijania(page)
      await panelWidoczny(page)
    })
  }

  for (const vp of [{ width: 390, height: 844 }, { width: 1024, height: 600 }, { width: 1280, height: 560 }]) {
    test(`mały ekran ${vp.width}×${vp.height}: układ jeden pod drugim, wszystko osiągalne przewijaniem`, async ({ page }) => {
      await page.setViewportSize(vp)
      await wejdz(page, nowyStan(30))
      await page.getByTestId('pozycja-planu-l1').click()
      await page.getByTestId('pracownik-w1').click()
      // Bez poziomego wystawania.
      const poziomo = await page.evaluate(() => {
        const r = document.querySelector('.phmi-root') as HTMLElement
        return { sw: r.scrollWidth, cw: r.clientWidth, oy: getComputedStyle(r).overflowY }
      })
      expect(poziomo.sw).toBeLessThanOrEqual(poziomo.cw + 1)
      expect(poziomo.oy).toBe('auto')
      // Kontrolki panelu da się przewinąć do widoku i trafić.
      for (const id of ['zapisz', 'pole-skanu-glowne', 'skaner-bledy', 'korekta', 'pracownik-w15']) {
        const el = page.getByTestId(id)
        await el.scrollIntoViewIfNeeded()
        await expect(el).toBeInViewport()
      }
      await page.getByTestId('pozycja-planu-l30').scrollIntoViewIfNeeded()
      await expect(page.getByTestId('pozycja-planu-l30')).toBeInViewport()
      await page.screenshot({ path: `/tmp/opencode/production-hmi-${vp.width}x${vp.height}-maly.png`, fullPage: false })
    })
  }

  test('StrictMode: zapis sztuk, potem seria skanów PROSTO z głównego ekranu', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const stan = nowyStan(30)
    const A = 'a'.repeat(20), B = 'b'.repeat(20), C = 'c'.repeat(20), D = 'd'.repeat(20)
    stan.sztuki = { [A]: 'l5', [B]: 'l2', [C]: 'l5', [D]: 'l9' }
    await wejdz(page, stan)

    await page.getByTestId('pozycja-planu-l2').click()
    await page.getByTestId('pracownik-w3').click()
    await page.getByTestId('ile-3').click()
    await page.getByTestId('zapisz').click()
    await expect(page.getByTestId('wynik-zapisu')).toContainText('Dodano 3 szt.')
    await expect(page.getByTestId('wykonano')).toHaveText('3/20')
    expect(stan.patch).toHaveLength(1)

    // Skaner gotowy bez klikania; fokus stoi na „Zakończ dzień". Skaner
    // wystukuje kody jednym ciągiem, bez opóźnień i bez Entera (kod sztuki
    // ma stałą długość), na końcu sufiks Enter — nie może kliknąć przycisku.
    await expect(page.getByTestId('skaner-stan')).toHaveAttribute('data-gotowy', 'true')
    await page.getByRole('button', { name: 'Zakończ dzień' }).focus()
    await page.keyboard.type(`U|${A}U|${B}U|${C}`)
    await page.keyboard.press('Enter')

    await expect(page.getByTestId('skaner-zapisane-liczba')).toHaveText('3')
    await expect(page.getByTestId('skaner-oczekujace-liczba')).toHaveText('0')
    expect(stan.skanyWolania.map(s => [s.code, s.plan_line_id, s.expected_plan_id])).toEqual([
      [`U|${A}`, null, 'p1'], [`U|${B}`, null, 'p1'], [`U|${C}`, null, 'p1'],
    ])
    // Liczniki z odpowiedzi serwera, per pozycja z etykiety.
    await expect(page.getByTestId('skan-l5')).toContainText('2/8')
    await expect(page.getByTestId('skan-l2')).toContainText('1/20')
    await expect(page.getByTestId('skaner-ostatni')).toContainText(RECEPTURY[4])
    // Nic nie kliknięte, nic nie przestawione: bez podsumowania, ten sam wybór i osoba, zero PATCH.
    await expect(page.getByTestId('zakoncz')).toHaveCount(0)
    await expect(page.getByTestId('pozycja-planu-l2')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('pracownik-w3')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('wykonano')).toHaveText('3/20')
    expect(stan.patch).toHaveLength(1)

    // Sufiks Tab przy fokusie na „Wyloguj" — sesja zostaje.
    await page.getByRole('button', { name: 'Wyloguj' }).focus()
    await page.keyboard.type(`U|${D}`)
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('skaner-zapisane-liczba')).toHaveText('4')
    await expect(page.getByTestId('hmi-produkcja-glowny')).toBeVisible()
    await expect(page.getByTestId('skan-l9')).toContainText('1/')

    await bezPrzewijania(page)
    await expect(page.getByTestId('pasek-skanera')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: '/tmp/opencode/production-hmi-strictmode-skan.png' })
  })
})
