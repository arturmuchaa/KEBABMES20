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
set -eo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${BLUE}  → $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════${NC}"; \
         echo -e "${BOLD}${CYAN}  $1${NC}"; \
         echo -e "${BOLD}${CYAN}══════════════════════════════════════════════${NC}"; }
err()  { echo -e "${RED}  ✗ BLAD: $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && err "Uruchom jako root: sudo bash INSTALUJ_PRODUKCJA.sh"

# ── ZNAJDZ KATALOG ZRODLOWY (kebab_fixed/) ─────────────────────
# Skrypt lezy w kebab_fixed/ — potrzebujemy tego katalogu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Jesli jestesmy juz w kebab_fixed/ to SRC_DIR = SCRIPT_DIR
# Jesli nie, szukamy kebab_fixed/ obok skryptu
if [[ -d "$SCRIPT_DIR/backend/app" ]]; then
    SRC_DIR="$SCRIPT_DIR"
elif [[ -d "$SCRIPT_DIR/kebab_fixed/backend/app" ]]; then
    SRC_DIR="$SCRIPT_DIR/kebab_fixed"
else
    err "Nie znaleziono katalogu z kodem (backend/app). Uruchom z katalogu projektu."
fi

# Docelowe katalogi
APP_DIR="/opt/kebab/app"
VENV_DIR="/opt/kebab/venv"
CONF_DIR="/opt/kebab/config"
LOG_DIR="/opt/kebab/logs"
STAGING="/tmp/kebab-install-$$"

clear
echo ""
echo -e "${BOLD}${CYAN}+----------------------------------------------+${NC}"
echo -e "${BOLD}${CYAN}|   KEBAB MES v3.0 - Instalacja produkcyjna    |${NC}"
echo -e "${BOLD}${CYAN}|   gunicorn + uvicorn + nginx + PostgreSQL     |${NC}"
echo -e "${BOLD}${CYAN}+----------------------------------------------+${NC}"
echo ""
echo -e "  ${BOLD}Zrodlo:${NC}          $SRC_DIR"
echo -e "  ${BOLD}Docelowo:${NC}        $APP_DIR"
echo ""

# DB Config
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="kebab_mes"
DB_USER="kebabmes"
DB_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)

echo -e "  ${BOLD}Baza danych:${NC}     $DB_NAME / $DB_USER"
echo ""


# ===================================================================
# 1. PAKIETY SYSTEMOWE
# ===================================================================
step "1/9 - PAKIETY SYSTEMOWE"
info "apt update..."
apt-get update -qq

info "Instaluje postgresql, python3, nginx..."
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  postgresql postgresql-contrib \
  python3 python3-pip python3-venv \
  nginx curl wget git 2>/dev/null || true
ok "Pakiety zainstalowane"


# ===================================================================
# 2. NODE.JS
# ===================================================================
step "2/9 - NODE.JS"
if command -v node &>/dev/null; then
    ok "Node.js $(node -v) juz zainstalowany"
else
    info "Instaluje Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null
    ok "Node.js $(node -v)"
fi
NPM_BIN=$(which npm)
NODE_BIN=$(which node)
ok "npm $($NPM_BIN -v)"


# ===================================================================
# 3. POSTGRESQL
# ===================================================================
step "3/9 - POSTGRESQL"
systemctl enable postgresql -q 2>/dev/null || true
systemctl start postgresql 2>/dev/null || true
ok "PostgreSQL uruchomiony"

info "Tworze uzytkownika i baze..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  || sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  || warn "Nie mozna utworzyc usera (moze juz istnieje)"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null \
  || warn "Baza $DB_NAME juz istnieje"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
ok "Baza '$DB_NAME' gotowa"


# ===================================================================
# 4. KOPIOWANIE KODU (staging -> /opt/kebab/app)
# ===================================================================
step "4/9 - KOPIOWANIE KODU"

# Zatrzymaj stary serwis jesli istnieje
systemctl stop kebab-mes 2>/dev/null || true

# KLUCZOWE: kopiujemy najpierw do /tmp, potem do /opt/kebab/app
# Dzieki temu nie ma problemu gdy SRC_DIR jest podkatalogiem APP_DIR
info "Kopiuje do staging ($STAGING)..."
rm -rf "$STAGING"
mkdir -p "$STAGING/backend" "$STAGING/frontend-src"

# Backend: caly app/ + init_db.py + requirements
cp -r "$SRC_DIR/backend/app" "$STAGING/backend/app"
cp "$SRC_DIR/backend/init_db.py" "$STAGING/backend/"
cp "$SRC_DIR/backend/requirements_pg.txt" "$STAGING/backend/"
ok "Backend skopiowany do staging"

# Frontend: pliki konfiguracyjne + src/
for item in package.json package-lock.json vite.config.ts tsconfig.json \
            tailwind.config.js postcss.config.js index.html; do
    [[ -f "$SRC_DIR/$item" ]] && cp "$SRC_DIR/$item" "$STAGING/frontend-src/"
done
[[ -d "$SRC_DIR/src" ]] && cp -r "$SRC_DIR/src" "$STAGING/frontend-src/"
[[ -d "$SRC_DIR/src-tauri" ]] && cp -r "$SRC_DIR/src-tauri" "$STAGING/frontend-src/"
ok "Frontend skopiowany do staging"

# Teraz przenosimy z staging do docelowego /opt/kebab/app
info "Przenosze do $APP_DIR..."
mkdir -p "$APP_DIR" "$VENV_DIR" "$CONF_DIR" "$LOG_DIR"

# Usun stary backend, wstaw nowy
rm -rf "$APP_DIR/backend"
mv "$STAGING/backend" "$APP_DIR/backend"

# Frontend src — kopiuj do APP_DIR
for item in "$STAGING/frontend-src"/*; do
    [[ -e "$item" ]] && cp -r "$item" "$APP_DIR/"
done

# Wyczysc staging
rm -rf "$STAGING"

ok "Kod w $APP_DIR gotowy"
echo ""
echo -e "  ${BOLD}Zawartosc $APP_DIR/backend/app/:${NC}"
ls "$APP_DIR/backend/app/" 2>/dev/null || echo "  (pusty)"


# ===================================================================
# 5. KONFIGURACJA (.env)
# ===================================================================
step "5/9 - KONFIGURACJA"
DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Jesli .env juz istnieje (reinstalacja), zachowaj stare haslo
if [[ -f "$CONF_DIR/.env" ]]; then
    warn "Plik $CONF_DIR/.env juz istnieje — zachowuje istniejacy"
    info "Jesli chcesz nowy, usun go recznie: rm $CONF_DIR/.env"
    # Wczytaj istniejacy DB_URL do zmiennej
    source "$CONF_DIR/.env" 2>/dev/null || true
    DB_URL="${DATABASE_URL:-$DB_URL}"
else
    cat > "$CONF_DIR/.env" << ENVEOF
# Kebab MES - konfiguracja produkcyjna
# Wygenerowano: $(date '+%Y-%m-%d %H:%M')

DATABASE_URL=${DB_URL}
CORS_ORIGINS=*
LOG_LEVEL=INFO
LOG_JSON=false
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT_MS=30000
ENVEOF
    chmod 600 "$CONF_DIR/.env"
    ok "Plik $CONF_DIR/.env utworzony (chmod 600)"
fi


# ===================================================================
# 6. PYTHON VENV + ZALEZNOSCI
# ===================================================================
step "6/9 - PYTHON VENV"

if [[ ! -d "$VENV_DIR/bin" ]]; then
    info "Tworze wirtualne srodowisko..."
    python3 -m venv "$VENV_DIR"
else
    info "Venv juz istnieje, uzywam istniejacego"
fi

info "Instaluje zaleznosci..."
"$VENV_DIR/bin/pip" install -q --upgrade pip 2>&1 | tail -1
"$VENV_DIR/bin/pip" install -q fastapi uvicorn gunicorn psycopg2-binary python-dotenv pydantic 2>&1 | tail -1
ok "Python venv gotowy"
ok "gunicorn: $($VENV_DIR/bin/gunicorn --version 2>&1)"


# ===================================================================
# 7. INICJALIZACJA BAZY + MIGRACJE
# ===================================================================
step "7/9 - BAZA DANYCH - SCHEMAT + MIGRACJE"

cd "$APP_DIR/backend"

# init_db.py tworzy tabele
info "Tworze schemat bazy danych..."
DATABASE_URL="$DB_URL" "$VENV_DIR/bin/python3" init_db.py 2>&1 | tail -5
ok "Schemat tabel utworzony"

# app/migrations.py dodaje brakujace kolumny + seeds
info "Uruchamiam migracje..."
DATABASE_URL="$DB_URL" "$VENV_DIR/bin/python3" -c "
import sys, os
sys.path.insert(0, '.')
os.environ['DATABASE_URL'] = '$DB_URL'
from app.db import init_pool, close_pool
from app.migrations import run_migrations
init_pool()
run_migrations()
close_pool()
print('OK')
" 2>&1 | tail -5
ok "Migracje zakonczone"


# ===================================================================
# 8. FRONTEND BUILD
# ===================================================================
step "8/9 - FRONTEND BUILD"
cd "$APP_DIR"

# .env.local dla Vite
echo "VITE_API_URL=" > "$APP_DIR/.env.local"

info "npm install..."
$NPM_BIN install --legacy-peer-deps 2>&1 | tail -5
ok "Zaleznosci npm zainstalowane"

info "npm run build..."
$NPM_BIN run build 2>&1 | tail -5

if [[ -d "$APP_DIR/dist" ]]; then
    ok "Frontend zbudowany: $APP_DIR/dist"
else
    err "npm run build nie utworzyl katalogu dist!"
fi

# Sprzatanie — node_modules nie potrzebne na produkcji
info "Usuwam node_modules (niepotrzebne runtime)..."
rm -rf "$APP_DIR/node_modules"
# Usun tez pliki frontend-dev (niepotrzebne w /opt/kebab/app)
rm -rf "$APP_DIR/src" "$APP_DIR/src-tauri"
rm -f "$APP_DIR/package.json" "$APP_DIR/package-lock.json"
rm -f "$APP_DIR/vite.config.ts" "$APP_DIR/tsconfig.json"
rm -f "$APP_DIR/tailwind.config.js" "$APP_DIR/postcss.config.js"
rm -f "$APP_DIR/index.html" "$APP_DIR/.env.local"
ok "Posprzatano pliki deweloperskie"


# ===================================================================
# 9. SYSTEMD + NGINX
# ===================================================================
step "9/9 - SERWISY (systemd + nginx)"

# -- systemd: kebab-mes.service ----------------------------------------
info "Konfiguruje serwis systemd..."

cat > /etc/systemd/system/kebab-mes.service << 'SVCEOF'
[Unit]
Description=Kebab MES v3.0 - Backend API (gunicorn + uvicorn workers)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=root
Group=root
WorkingDirectory=/opt/kebab/app/backend
ExecStart=/opt/kebab/venv/bin/gunicorn app.main:app -c app/gunicorn_conf.py
ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
TimeoutStopSec=30
Restart=always
RestartSec=5

# Srodowisko
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/opt/kebab/config/.env

# Bezpieczenstwo
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

# -- nginx ----------------------------------------------------------
info "Konfiguruje nginx..."

cat > /etc/nginx/sites-available/kebab-mes << 'NGXEOF'
server {
    listen 80;
    server_name _;

    root /opt/kebab/app/dist;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend SPA - React/Vite
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Backend API - proxy to gunicorn
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_request_buffering on;
        proxy_buffering on;
    }

    # Health check
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

    access_log /var/log/nginx/kebab-mes.access.log;
    error_log  /var/log/nginx/kebab-mes.error.log;
}
NGXEOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kebab-mes /etc/nginx/sites-enabled/kebab-mes
nginx -t 2>&1 && systemctl reload nginx
ok "Nginx skonfigurowany"


# -- START -----------------------------------------------------------
info "Uruchamiam serwis kebab-mes..."
systemctl restart kebab-mes
sleep 4

if systemctl is-active --quiet kebab-mes; then
    ok "Serwis kebab-mes DZIALA!"
else
    warn "Serwis nie wystartowal - sprawdz:"
    echo "    journalctl -u kebab-mes -n 50 --no-pager"
fi

# Weryfikacja
info "Sprawdzam health endpoint..."
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    ok "Health check: HTTP 200 OK"
else
    warn "Health check zwrocil: HTTP $HTTP_CODE (serwis moze potrzebowac chwili)"
fi


# ===================================================================
# DANE INSTALACJI
# ===================================================================
IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

cat > "$CONF_DIR/DANE_INSTALACJI.txt" << DATAEOF
========================================
KEBAB MES v3.0 - Dane instalacji
Data: $(date '+%Y-%m-%d %H:%M')
========================================

URL aplikacji:   http://${IP}
Health check:    http://${IP}/api/health

Baza danych:
  Host:          $DB_HOST:$DB_PORT
  Baza:          $DB_NAME
  Uzytkownik:    $DB_USER
  Haslo:         $DB_PASS
  DATABASE_URL:  $DB_URL

Struktura:
  Aplikacja:     $APP_DIR
  Backend:       $APP_DIR/backend
  Frontend:      $APP_DIR/dist
  Venv:          $VENV_DIR
  Konfiguracja:  $CONF_DIR/.env
  Logi:          journalctl -u kebab-mes -f

Komendy:
  systemctl status kebab-mes       - status
  systemctl restart kebab-mes      - restart
  systemctl stop kebab-mes         - stop
  journalctl -u kebab-mes -f       - logi na zywo
  journalctl -u kebab-mes -n 100   - ostatnie 100 linii
========================================
DATAEOF
chmod 600 "$CONF_DIR/DANE_INSTALACJI.txt"


# ===================================================================
# PODSUMOWANIE
# ===================================================================
echo ""
echo -e "${BOLD}${GREEN}+----------------------------------------------+${NC}"
echo -e "${BOLD}${GREEN}|    INSTALACJA ZAKONCZONA SUKCESEM!            |${NC}"
echo -e "${BOLD}${GREEN}+----------------------------------------------+${NC}"
echo ""
echo -e "  ${BOLD}Otworz w przegladarce:${NC}"
echo -e "  ${BOLD}${CYAN}http://${IP}${NC}"
echo ""
echo -e "  ${BOLD}Struktura:${NC}"
echo -e "    /opt/kebab/app/backend   - kod backendu"
echo -e "    /opt/kebab/app/dist      - frontend (nginx)"
echo -e "    /opt/kebab/venv          - Python venv"
echo -e "    /opt/kebab/config/.env   - konfiguracja"
echo ""
echo -e "  ${BOLD}Dane logowania do bazy:${NC}"
echo -e "    ${YELLOW}cat $CONF_DIR/DANE_INSTALACJI.txt${NC}"
echo ""
echo -e "  ${BOLD}Komendy:${NC}"
echo -e "    ${BLUE}systemctl status kebab-mes${NC}"
echo -e "    ${BLUE}journalctl -u kebab-mes -f${NC}"
echo -e "    ${BLUE}systemctl restart kebab-mes${NC}"
echo ""
