#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  Uruchom: bash AKTUALIZUJ.sh
# ================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }

BRANCH="claude/add-traceability-system-UxumS"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$INSTALL_DIR/backend"
NGINX_DIST="$(dirname "$INSTALL_DIR")/dist"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja${NC}"
echo -e "  Źródło: $INSTALL_DIR"
echo -e "  Nginx:  $NGINX_DIST"
echo ""

# ── 1. Zachowaj .env ──────────────────────────────────────────────
[ -f "$BACKEND_DIR/.env" ]    && cp "$BACKEND_DIR/.env"    /tmp/_kebab_env_bkp
[ -f "$INSTALL_DIR/.env.local" ] && cp "$INSTALL_DIR/.env.local" /tmp/_kebab_envlocal_bkp

# ── 2. Git pull ───────────────────────────────────────────────────
cd "$INSTALL_DIR"
[ ! -d .git ] && git init -q && git remote add origin "$REPO" 2>/dev/null
git remote set-url origin "$REPO" 2>/dev/null || true
echo "  Pobieram kod z GitHub..."
git fetch origin "$BRANCH" -q
git reset --hard "origin/$BRANCH" -q
ok "Kod zaktualizowany"

# ── 3. Przywróć .env ──────────────────────────────────────────────
[ -f /tmp/_kebab_env_bkp ]      && cp /tmp/_kebab_env_bkp      "$BACKEND_DIR/.env"
[ -f /tmp/_kebab_envlocal_bkp ] && cp /tmp/_kebab_envlocal_bkp "$INSTALL_DIR/.env.local"

# ── 4. Build frontend ────────────────────────────────────────────
echo "  Buduję frontend..."
cd "$INSTALL_DIR"
npm install --legacy-peer-deps -q 2>/dev/null || npm install -q
npm run build -q
ok "Frontend przebudowany"

# ── 5. Kopiuj dist → nginx ────────────────────────────────────────
echo "  Kopiuję dist → $NGINX_DIST"
rm -rf "$NGINX_DIST"
cp -r "$INSTALL_DIR/dist" "$NGINX_DIST"
ok "Dist skopiowany"

# ── 6. Restart backendu ───────────────────────────────────────────
echo "  Restartuję backend..."
for svc in kebab.service kebab-mes.service kebabmes.service; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc" && ok "Serwis $svc zrestartowany" && break
    fi
done || systemctl restart kebab.service 2>/dev/null && ok "kebab.service zrestartowany" || warn "Restart serwisu nieudany — uruchom ręcznie: systemctl restart kebab.service"

# ── 7. Nginx reload ───────────────────────────────────────────────
systemctl reload nginx 2>/dev/null && ok "Nginx przeładowany" || true

echo ""
echo -e "${GREEN}${BOLD}  ✓ Gotowe! Odśwież przeglądarkę (tryb incognito).${NC}"
echo ""
