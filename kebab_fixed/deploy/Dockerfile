# syntax=docker/dockerfile:1
# Kebab MES — obraz produkcyjny (jeden na klienta, stawiany przez deploy/nowy-klient.sh).
# Build context = katalog repo (patrz docker-compose.yml: context: ..).

# ── Stage 1: build frontendu (dist) ──────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: backend runtime ─────────────────────────────────────────
FROM python:3.12-slim AS backend
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# chromium — do renderowania PDF (WZ/HDI/CMR/etykiety; pdf_render.py szuka
# 'chromium' w /usr/bin) + czcionki (poprawne polskie znaki na dokumentach).
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium fonts-liberation fonts-dejavu ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements_pg.txt ./
RUN pip install -r requirements_pg.txt

COPY backend/ /app/backend/
# dist trafia do /app/dist → config._resolve_dist_dir() (ROOT_DIR.parent/dist) je znajdzie
COPY --from=frontend /app/dist /app/dist
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
