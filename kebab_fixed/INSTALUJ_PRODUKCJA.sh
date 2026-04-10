#!/bin/bash
# ================================================================
#  KEBAB MES v3.0 — Czysta instalacja produkcyjna na VPS
#
#  Struktura docelowa:
#    /opt/kebab/app       → kod aplikacji (backend + frontend dist)
#    /opt/kebab/venv      → Python virtual environment
#    /opt/kebab/config    → .env (poza repozytorium)
#    /opt/kebab/logs      → logi aplikacji
#
#  Uruchom jako root:  bash INSTALUJ_PRODUKCJA.sh
# ================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${BLUE}  → $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════${NC}"; \
         echo -e "${BOLD}${CYAN}  $1${NC}"; \
         echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${NC}"; }
err()  { echo -e "${RED}  ✗ BŁĄD: $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && err "Uruchom jako root: sudo bash INSTALUJ_PRODUKCJA.sh"

clear
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   KEBAB MES v3.0 — Instalacja produkcyjna    ║${NC}"
echo -e "${BOLD}${CYAN}║   gunicorn + uvicorn + nginx + PostgreSQL     ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Katalog źródłowy — tam gdzie leży ten skrypt
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Docelowe katalogi
APP_DIR="/opt/kebab/app"
VENV_DIR="/opt/kebab/venv"
CONF_DIR="/opt/kebab/config"
LOG_DIR="/opt/kebab/logs"

echo -e "  ${BOLD}Źródło:${NC}          $SRC_DIR"
echo -e "  ${BOLD}Docelowo:${NC}"
echo -e "    Aplikacja:     ${BOLD}$APP_DIR${NC}"
echo -e "    Venv:          ${BOLD}$VENV_DIR${NC}"
echo -e "    Konfiguracja:  ${BOLD}$CONF_DIR${NC}"
echo -e "    Logi:          ${BOLD}$LOG_DIR${NC}"
echo ""

# DB Config
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="kebab_mes"
DB_USER="kebabmes"
DB_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)

echo -e "  ${BOLD}Baza danych:${NC}"
echo -e "    Baza:          ${BOLD}$DB_NAME${NC}"
echo -e "    Użytkownik:    ${BOLD}$DB_USER${NC}"
echo ""
read -p "  Kontynuować? [T/n]: " CONFIRM
[[ "$CONFIRM" =~ ^[Nn] ]] && echo "Anulowano." && exit 0


# ═══════════════════════════════════════════════════════════════════
# 1. PAKIETY SYSTEMOWE
# ═══════════════════════════════════════════════════════════════════
step "1/9 — PAKIETY SYSTEMOWE"
info "apt update..."
apt-get update -qq

info "Instaluję postgresql, python3, nginx..."
apt-get install -y -qq \
  postgresql postgresql-contrib \
  python3 python3-pip python3-venv \
  nginx curl wget git 2>/dev/null
ok "Pakiety zainstalowane"


# ═══════════════════════════════════════════════════════════════════
# 2. NODE.JS
# ═══════════════════════════════════════════════════════════════════
step "2/9 — NODE.JS"
if command -v node &>/dev/null; then
    ok "Node.js $(node -v) już zainstalowany"
else
    info "Instaluję Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    ok "Node.js $(node -v)"
fi
NPM_BIN=$(which npm)
NODE_BIN=$(which node)
ok "npm $($NPM_BIN -v)"


# ═══════════════════════════════════════════════════════════════════
# 3. POSTGRESQL
# ═══════════════════════════════════════════════════════════════════
step "3/9 — POSTGRESQL"
systemctl enable postgresql -q
systemctl start postgresql
ok "PostgreSQL uruchomiony"

info "Tworzę użytkownika i bazę..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  || sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null \
  || warn "Baza $DB_NAME już istnieje"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
ok "Baza '$DB_NAME' gotowa"


# ═══════════════════════════════════════════════════════════════════
# 4. STRUKTURA KATALOGÓW
# ═══════════════════════════════════════════════════════════════════
step "4/9 — STRUKTURA KATALOGÓW"

# Zatrzymaj stary serwis jeśli istnieje
systemctl stop kebab-mes 2>/dev/null || true

mkdir -p "$APP_DIR" "$VENV_DIR" "$CONF_DIR" "$LOG_DIR"

# Kopiuj backend (cały app/ + init_db.py + requirements)
info "Kopiuję backend..."
rm -rf "$APP_DIR/backend"
mkdir -p "$APP_DIR/backend"
cp -r "$SRC_DIR/backend/app" "$APP_DIR/backend/app"
cp "$SRC_DIR/backend/init_db.py" "$APP_DIR/backend/"
cp "$SRC_DIR/backend/requirements_pg.txt" "$APP_DIR/backend/"
ok "Backend skopiowany do $APP_DIR/backend"

# Kopiuj źródła frontendu (package.json, src/, etc.)
info "Kopiuję źródła frontendu..."
for item in package.json package-lock.json vite.config.ts tsconfig.json \
            tailwind.config.js postcss.config.js index.html; do
    [[ -f "$SRC_DIR/$item" ]] && cp "$SRC_DIR/$item" "$APP_DIR/"
done
[[ -d "$SRC_DIR/src" ]] && cp -r "$SRC_DIR/src" "$APP_DIR/"
[[ -d "$SRC_DIR/src-tauri" ]] && cp -r "$SRC_DIR/src-tauri" "$APP_DIR/"
ok "Źródła frontendu skopiowane"

ok "Struktura /opt/kebab/ utworzona"


# ═══════════════════════════════════════════════════════════════════
# 5. KONFIGURACJA (.env)
# ═══════════════════════════════════════════════════════════════════
step "5/9 — KONFIGURACJA"
DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

cat > "$CONF_DIR/.env" << EOF
# Kebab MES — konfiguracja produkcyjna
# Wygenerowano: $(date '+%Y-%m-%d %H:%M')

DATABASE_URL=${DB_URL}
CORS_ORIGINS=*
LOG_LEVEL=INFO
LOG_JSON=false
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT_MS=30000
EOF
chmod 600 "$CONF_DIR/.env"
ok "Plik $CONF_DIR/.env zapisany (chmod 600)"


# ═══════════════════════════════════════════════════════════════════
# 6. PYTHON VENV + ZALEŻNOŚCI
# ═══════════════════════════════════════════════════════════════════
step "6/9 — PYTHON VENV"

info "Tworzę wirtualne środowisko..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

info "Instaluję zależności..."
pip install -q --upgrade pip
pip install -q fastapi uvicorn gunicorn psycopg2-binary python-dotenv pydantic
ok "Python venv gotowy"
ok "gunicorn: $(gunicorn --version 2>&1)"


# ═══════════════════════════════════════════════════════════════════
# 7. INICJALIZACJA BAZY + MIGRACJE
# ═══════════════════════════════════════════════════════════════════
step "7/9 — BAZA DANYCH — SCHEMAT + MIGRACJE"

cd "$APP_DIR/backend"

# Punkt 1: init_db.py tworzy tabele (musi czytać z nowego .env)
info "Tworzę schemat bazy danych..."
DATABASE_URL="$DB_URL" "$VENV_DIR/bin/python3" init_db.py
ok "Schemat tabel utworzony"

# Punkt 2: app/migrations.py dodaje brakujące kolumny + seeds
info "Uruchamiam migracje..."
DATABASE_URL="$DB_URL" PYTHONPATH="$APP_DIR/backend" "$VENV_DIR/bin/python3" -c "
import sys
sys.path.insert(0, '.')
import os
os.environ['DATABASE_URL'] = '$DB_URL'
from app.db import init_pool, close_pool
from app.migrations import run_migrations
init_pool()
run_migrations()
close_pool()
print('  Migracje OK')
"
ok "Migracje zakończone"


# ═══════════════════════════════════════════════════════════════════
# 8. FRONTEND BUILD
# ═══════════════════════════════════════════════════════════════════
step "8/9 — FRONTEND BUILD"
cd "$APP_DIR"

cat > "$APP_DIR/.env.local" << EOF
VITE_API_URL=
EOF

info "npm install..."
$NPM_BIN install --legacy-peer-deps 2>&1 | tail -3
ok "Zależności npm zainstalowane"

info "npm run build..."
$NPM_BIN run build 2>&1 | tail -5

if [[ -d "$APP_DIR/dist" ]]; then
    ok "Frontend zbudowany: $APP_DIR/dist"
else
    err "npm run build nie utworzył katalogu dist!"
fi

# Sprzątanie — node_modules nie potrzebne na produkcji
rm -rf "$APP_DIR/node_modules"
ok "node_modules usunięte (nie potrzebne runtime)"


# ═══════════════════════════════════════════════════════════════════
# 9. SYSTEMD + NGINX
# ═══════════════════════════════════════════════════════════════════
step "9/9 — SERWISY (systemd + nginx)"

# ── systemd: kebab-mes.service ──────────────────────────────────
info "Konfiguruję serwis systemd..."

cat > /etc/systemd/system/kebab-mes.service << SVCEOF
[Unit]
Description=Kebab MES v3.0 — Backend API (gunicorn + uvicorn workers)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=root
Group=root
WorkingDirectory=$APP_DIR/backend
ExecStart=$VENV_DIR/bin/gunicorn app.main:app -c app/gunicorn_conf.py
ExecReload=/bin/kill -s HUP \$MAINPID
KillMode=mixed
TimeoutStopSec=30
Restart=always
RestartSec=5

# Środowisko
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=$CONF_DIR/.env

# Bezpieczeństwo
ProtectSystem=full
NoNewPrivileges=true

# Logi
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebab-mes

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable kebab-mes -q
ok "Serwis systemd skonfigurowany"

# ── nginx ────────────────────────────────────────────────────────
info "Konfiguruję nginx..."

cat > /etc/nginx/sites-available/kebab-mes << NGXEOF
server {
    listen 80;
    server_name _;

    root $APP_DIR/dist;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend SPA — React/Vite
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Backend API — proxy to gunicorn
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;

        # Buforowanie ciała requestu
        proxy_request_buffering on;
        proxy_buffering on;
    }

    # Health check bez /api prefix
    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
    }

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Logi
    access_log /var/log/nginx/kebab-mes.access.log;
    error_log  /var/log/nginx/kebab-mes.error.log;
}
NGXEOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kebab-mes /etc/nginx/sites-enabled/kebab-mes
nginx -t && systemctl reload nginx
ok "Nginx skonfigurowany"


# ── START ────────────────────────────────────────────────────────
info "Uruchamiam serwis kebab-mes..."
systemctl restart kebab-mes
sleep 4

if systemctl is-active --quiet kebab-mes; then
    ok "Serwis kebab-mes DZIAŁA!"
else
    warn "Serwis nie wystartował — sprawdź:"
    echo "    journalctl -u kebab-mes -n 50 --no-pager"
fi

# Weryfikacja
info "Sprawdzam health endpoint..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    ok "Health check: HTTP 200 OK"
else
    warn "Health check zwrócił: HTTP $HTTP_CODE"
fi


# ═══════════════════════════════════════════════════════════════════
# DANE INSTALACJI
# ═══════════════════════════════════════════════════════════════════
IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

cat > "$CONF_DIR/DANE_INSTALACJI.txt" << DATAEOF
========================================
KEBAB MES v3.0 — Dane instalacji
Data: $(date '+%Y-%m-%d %H:%M')
========================================

URL aplikacji:   http://${IP}
Health check:    http://${IP}/api/health

Baza danych:
  Host:          $DB_HOST:$DB_PORT
  Baza:          $DB_NAME
  Użytkownik:    $DB_USER
  Hasło:         $DB_PASS
  DATABASE_URL:  $DB_URL

Struktura:
  Aplikacja:     $APP_DIR
  Backend:       $APP_DIR/backend
  Frontend:      $APP_DIR/dist
  Venv:          $VENV_DIR
  Konfiguracja:  $CONF_DIR/.env
  Logi:          journalctl -u kebab-mes -f

Komendy:
  systemctl status kebab-mes       — status
  systemctl restart kebab-mes      — restart
  systemctl stop kebab-mes         — stop
  journalctl -u kebab-mes -f       — logi na żywo
  journalctl -u kebab-mes -n 100   — ostatnie 100 linii
========================================
DATAEOF
chmod 600 "$CONF_DIR/DANE_INSTALACJI.txt"


# ═══════════════════════════════════════════════════════════════════
# PODSUMOWANIE
# ═══════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║    INSTALACJA ZAKOŃCZONA SUKCESEM!            ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Otwórz w przeglądarce:${NC}"
echo -e "  ${BOLD}${CYAN}http://${IP}${NC}"
echo ""
echo -e "  ${BOLD}Struktura:${NC}"
echo -e "    /opt/kebab/app/backend   — kod backendu (app/)"
echo -e "    /opt/kebab/app/dist      — frontend (nginx)"
echo -e "    /opt/kebab/venv          — Python venv"
echo -e "    /opt/kebab/config/.env   — konfiguracja (chmod 600)"
echo -e "    /opt/kebab/logs          — logi"
echo ""
echo -e "  ${BOLD}Dane logowania do bazy:${NC}"
echo -e "    ${YELLOW}$CONF_DIR/DANE_INSTALACJI.txt${NC}"
echo ""
echo -e "  ${BOLD}Komendy serwisowe:${NC}"
echo -e "    ${BLUE}systemctl status kebab-mes${NC}       — status"
echo -e "    ${BLUE}journalctl -u kebab-mes -f${NC}       — logi na żywo"
echo -e "    ${BLUE}systemctl restart kebab-mes${NC}      — restart"
echo ""
echo -e "  ${BOLD}Weryfikacja:${NC}"
echo -e "    ${BLUE}curl http://127.0.0.1:8000/api/health${NC}"
echo -e "    ${BLUE}curl http://${IP}/api/health${NC}"
echo ""
