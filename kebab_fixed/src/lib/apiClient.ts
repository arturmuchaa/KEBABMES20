/**
 * apiClient.ts — Tryb API
 *
 * TRYB 1 (domyślny) — localStorage, brak backendu:
 *   export * from './mockApi'
 *
 * TRYB 2 — Backend PostgreSQL:
 *   Ustaw VITE_API_URL w pliku .env i zmień import na:
 *   export * from './api'
 */

// ── TRYB 2: Backend PostgreSQL ────────────────────────────────
export * from './api'

// ── TRYB 1: localStorage (demo bez serwera) ───────────────────
// export * from './mockApi'
