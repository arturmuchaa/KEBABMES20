# 🏭 KEBAB MES — CLAUDE.md

Production MES for meat processing. Backend = FastAPI + PostgreSQL (psycopg2).
Frontend = React + TypeScript + Vite + Tailwind (font Fira). Desktop = Tauri.

---

## 📍 Workspace & stack

- **Canonical sources:** `/opt/kebab/kebab_new/kebab_fixed/` — NOT `/root/kebab_fixed_work/`.
- **Backend:** `backend/app/` — layers **API (`routes/`) → SERVICE (`services/`) → DB (`db.py`)**. Keep this flow; routes stay thin, logic in services.
- **Frontend:** `src/` (features in `src/features/`, pages in `src/pages/`). Design system: tokens `surface-*`/`ink-*`, semantics amber/emerald/red, canonical `StatusBadge` (don't duplicate status pills).

## ▶️ Run / test / build

- Backend tests: `cd backend && python3 -m pytest -q`
- Frontend: `npm run dev` · build `npm run build` · types `npx tsc --noEmit` · unit `npx vitest run`
- DB: PostgreSQL via `DATABASE_URL` (env / `/opt/kebab/config/.env`).

---

## 🔴 DOMAIN INVARIANTS (non-negotiable)

1. **Backend is the ONLY source of truth.**
2. **Stock is traceable:** every stock change creates a `stock_movement`. **No direct stock mutation** without a movement.
3. **Production = transformation:** input batches → output batch + movements.
4. **Reservation ≠ consumption:** track `kg_available` and `kg_reserved` separately.
5. **Traceability both ways:** raw → finished AND finished → raw. `batch_allocation` is the source of truth per piece.
6. **No data loss:** no silent updates, no deletes.
7. **Use DB transactions** — stock writes use `SELECT … FOR UPDATE` row locks.

> 🚨 If stock changes without a movement, **the system is broken.**

---

## 🚀 DEPLOY (VPS) — READ BEFORE DEPLOYING

- Prod runs from `/opt/kebab/app` (**copied files, NOT git**). Backend systemd `kebab-mes` on **127.0.0.1:8010**; nginx serves `dist` on **:8080**. DB on **:5433**.
- **MANDATORY pre-deploy diff** (prod is sometimes AHEAD of git with server-only hotfixes):
  ```
  diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app | grep -i differ
  ```
  If prod has content not in the repo → **commit it to git FIRST.** A full deploy silently overwrites prod-only changes (this broke label resolution on 2026-06-21).
- Deploy with `deploy/deploy.sh [all|frontend|backend]` — it backs up, swaps `dist` atomically, health-checks (8010), and rolls back on failure. `frontend` does not restart the backend.
- **After deploy, smoke-test critical flows** (label print, WZ/HDI) before calling it done.

---

## 🧠 WORKING STYLE

- **Root cause before fixes** — diagnose from logs/tests/diffs; never patch a symptom.
- **Verify before claiming done** — actually run the tests/commands and report real output; no "should work".
- **Smallest change that fixes the root cause** — don't bundle drive-by refactors; but for non-trivial changes, pause and pick the sound design, not the quick hack.
- **Solve bugs autonomously** from available diagnostics; don't bounce trivial questions back to the user.
- **Encode lessons** — after a correction, add a rule (here or in memory) so it can't recur.

## ⚠️ AI GUARDRAILS

**DO NOT:** change stock/traceability logic without movements · break two-way traceability · deploy when prod is ahead of git.
**YOU MAY:** add the movement/validation layer · improve UI · add tests · extend services following the API→SERVICE→DB flow.

## 🧪 TEST INTENT

- Stock math: 1000 kg, use 200 → expect 800, and a movement logged.
- Pure logic (yields, allocations, requirements) is unit-tested without DB; API logic via monkeypatched loaders (auth middleware blocks raw TestClient).
