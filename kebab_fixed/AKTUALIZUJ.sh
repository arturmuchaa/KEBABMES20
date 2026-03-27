#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  System działa w: /opt/kebab/
#  Uruchom: bash /opt/kebab/kebab_fixed/AKTUALIZUJ.sh
# ================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }

BRANCH="claude/add-traceability-system-UxumS"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"

# Katalog gdzie leży ten skrypt = /opt/kebab/kebab_fixed
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Katalog systemu = /opt/kebab
APP_DIR="$(dirname "$SCRIPT_DIR")"
# Po git pull repo KEBABMES20 ma podkatalog kebab_fixed/ — tam jest właściwy kod
SRC_DIR="$SCRIPT_DIR/kebab_fixed"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja${NC}"
echo -e "  Katalog systemu: $APP_DIR"
echo ""

# ── 1. Git pull do kebab_fixed ────────────────────────────────────
cd "$SCRIPT_DIR"
[ ! -d .git ] && git init -q && git remote add origin "$REPO" 2>/dev/null
git remote set-url origin "$REPO" 2>/dev/null || true
echo "  Pobieram kod z GitHub..."
git fetch origin "$BRANCH" -q
git reset --hard "origin/$BRANCH" -q
ok "Kod pobrany"

# ── 2. Nadpisz pliki w /opt/kebab ────────────────────────────────
echo "  Nadpisuję pliki źródłowe w $APP_DIR (z $SRC_DIR)..."

if [ ! -d "$SRC_DIR/src" ]; then
    echo "BŁĄD: Nie znaleziono $SRC_DIR/src — sprawdź strukturę repo"
    exit 1
fi

# src/ — kod frontendu
rm -rf "$APP_DIR/src"
cp -r "$SRC_DIR/src" "$APP_DIR/src"

# Pliki konfiguracyjne
for f in package.json vite.config.ts tailwind.config.js postcss.config.js tsconfig.json index.html; do
    [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR/$f"
done

# backend/ — zachowaj .env
if [ -f "$APP_DIR/backend/.env" ]; then
    cp "$APP_DIR/backend/.env" /tmp/_kebab_env_bkp
fi
rm -rf "$APP_DIR/backend"
cp -r "$SRC_DIR/backend" "$APP_DIR/backend"
[ -f /tmp/_kebab_env_bkp ] && cp /tmp/_kebab_env_bkp "$APP_DIR/backend/.env"

ok "Pliki nadpisane"

# ── 3. Zachowaj .env.local jeśli istnieje ────────────────────────
if [ ! -f "$APP_DIR/.env.local" ]; then
    echo "VITE_API_URL=" > "$APP_DIR/.env.local"
fi

# ── 4. Build frontendu ───────────────────────────────────────────
echo "  Buduję frontend..."
cd "$APP_DIR"
npm install --legacy-peer-deps -q 2>/dev/null || npm install -q
npm run build -q
ok "Frontend przebudowany (dist w $APP_DIR/dist)"

# ── 5. Restart backendu ──────────────────────────────────────────
echo "  Restartuję backend..."
for svc in kebab.service kebab-mes.service kebabmes.service; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc" && ok "Serwis $svc zrestartowany" && break
    fi
done

# ── 6. Nginx reload ──────────────────────────────────────────────
systemctl reload nginx 2>/dev/null && ok "Nginx przeładowany" || true

echo ""
echo -e "${GREEN}${BOLD}  ✓ Gotowe! Odśwież przeglądarkę (tryb incognito).${NC}"
echo ""
