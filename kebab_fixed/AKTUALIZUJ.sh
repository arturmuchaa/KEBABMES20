#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  Uruchom: bash AKTUALIZUJ.sh
# ================================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
err()  { echo -e "${RED}  ✗ BŁĄD: $1${NC}"; exit 1; }

BRANCH="claude/add-traceability-system-UxumS"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"

# Katalog skryptu = katalog aplikacji
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$INSTALL_DIR/backend"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja systemu${NC}"
echo -e "  Katalog: $INSTALL_DIR"
echo ""

# ── 1. Zachowaj .env ──────────────────────────────────────────────
ENV_BACKUP=""
if [ -f "$BACKEND_DIR/.env" ]; then
    ENV_BACKUP=$(cat "$BACKEND_DIR/.env")
    ok "Zapisano backup backend/.env"
fi
ENV_LOCAL_BACKUP=""
if [ -f "$INSTALL_DIR/.env.local" ]; then
    ENV_LOCAL_BACKUP=$(cat "$INSTALL_DIR/.env.local")
fi

# ── 2. Git: init jeśli potrzeba ──────────────────────────────────
if [ ! -d "$INSTALL_DIR/.git" ]; then
    warn "Katalog nie jest git repo — inicjalizuję..."
    cd "$INSTALL_DIR"
    git init -q
    git remote add origin "$REPO"
    ok "Git zainicjalizowany"
else
    cd "$INSTALL_DIR"
    # Upewnij się że remote jest ustawiony
    git remote set-url origin "$REPO" 2>/dev/null || git remote add origin "$REPO"
fi

# ── 3. Pobierz najnowszy kod ─────────────────────────────────────
echo "  Pobieram aktualizacje z GitHub..."
git fetch origin "$BRANCH" -q
git reset --hard "origin/$BRANCH" -q
ok "Kod zaktualizowany"

# ── 4. Przywróć .env ─────────────────────────────────────────────
if [ -n "$ENV_BACKUP" ]; then
    echo "$ENV_BACKUP" > "$BACKEND_DIR/.env"
    ok "Przywrócono backend/.env"
fi
if [ -n "$ENV_LOCAL_BACKUP" ]; then
    echo "$ENV_LOCAL_BACKUP" > "$INSTALL_DIR/.env.local"
fi

# ── 5. Przebuduj frontend ─────────────────────────────────────────
echo "  Przebudowuję frontend..."
cd "$INSTALL_DIR"
npm install --legacy-peer-deps -q 2>/dev/null || npm install -q
npm run build -q
ok "Frontend przebudowany"

# ── 6. Skopiuj dist do katalogu nginx (jeśli inny) ───────────────
NGINX_ROOT=$(nginx -T 2>/dev/null | grep -E "^\s+root " | head -1 | awk '{print $2}' | tr -d ';')
if [ -n "$NGINX_ROOT" ] && [ "$NGINX_ROOT" != "$INSTALL_DIR/dist" ]; then
    echo "  Kopiuję dist: $INSTALL_DIR/dist → $NGINX_ROOT"
    rm -rf "$NGINX_ROOT"
    cp -r "$INSTALL_DIR/dist" "$NGINX_ROOT"
    ok "Dist skopiowany do $NGINX_ROOT"
fi

# ── 7. Restart backendu ──────────────────────────────────────────
echo "  Restartuję backend..."
# Znajdź działający serwis kebab
KEBAB_SVC=$(systemctl list-units --type=service --state=running 2>/dev/null | grep -i kebab | awk '{print $1}' | head -1)
if [ -n "$KEBAB_SVC" ]; then
    systemctl restart "$KEBAB_SVC"
    ok "Serwis $KEBAB_SVC zrestartowany"
else
    warn "Nie znalazłem serwisu systemd — zrestartuj ręcznie"
fi

# Nginx przeładuj (nowe pliki dist)
systemctl reload nginx 2>/dev/null && ok "Nginx przeładowany" || true

echo ""
echo -e "${GREEN}${BOLD}  ✓ Aktualizacja zakończona!${NC}"
echo ""
