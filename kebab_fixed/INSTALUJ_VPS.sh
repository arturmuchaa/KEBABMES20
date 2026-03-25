#!/bin/bash
# ================================================================
#  KEBAB MES v2.5 — Instalacja od zera na VPS (Ubuntu 22.04/24.04)
#  Uruchom jako root: bash INSTALUJ_VPS.sh
# ================================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${BLUE}  → $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
step() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════${NC}"; \
         echo -e "${BOLD}${CYAN}  $1${NC}"; \
         echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"; }
err()  { echo -e "${RED}  ✗ BŁĄD: $1${NC}"; exit 1; }

[[ $EUID -ne 0 ]] && err "Uruchom jako root: sudo bash INSTALUJ_VPS.sh"

clear
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║      KEBAB MES v2.5 — Instalacja na VPS      ║${NC}"
echo -e "${BOLD}${CYAN}║      Ubuntu 22.04 / 24.04                    ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$INSTALL_DIR/backend"

# ── Konfiguracja ────────────────────────────────────────────────
step "KONFIGURACJA"

DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="kebab_mes"
DB_USER="kebabmes"
DB_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
APP_PORT="80"

echo ""
echo -e "  Ustawienia instalacji:"
echo -e "    Katalog:        ${BOLD}$INSTALL_DIR${NC}"
echo -e "    Baza danych:    ${BOLD}$DB_NAME${NC}"
echo -e "    Użytkownik DB:  ${BOLD}$DB_USER${NC}"
echo -e "    Port aplikacji: ${BOLD}$APP_PORT${NC}"
echo ""
read -p "  Kontynuować? [T/n]: " CONFIRM
[[ "$CONFIRM" =~ ^[Nn] ]] && echo "Anulowano." && exit 0

# ── 1. Pakiety systemowe ─────────────────────────────────────────
step "1/7 — PAKIETY SYSTEMOWE"
info "apt update..."
apt-get update -qq
info "Instaluję postgresql, python3, nginx..."
apt-get install -y -qq \
  postgresql postgresql-contrib \
  python3 python3-pip python3-venv \
  nginx curl wget 2>/dev/null
ok "Pakiety systemowe zainstalowane"

# ── 2. Node.js 20 ───────────────────────────────────────────────
step "2/7 — NODE.JS"
info "Instaluję Node.js 20 przez nodesource..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
# Twarda ścieżka — nie polegaj na PATH sesji
NODE_BIN=$(which node || echo "/usr/bin/node")
NPM_BIN=$(which npm || echo "/usr/bin/npm")
ok "Node.js $($NODE_BIN -v)"
ok "npm $($NPM_BIN -v)"

# ── 3. PostgreSQL ────────────────────────────────────────────────
step "3/7 — BAZA DANYCH POSTGRESQL"
info "Uruchamiam PostgreSQL..."
systemctl enable postgresql -q
systemctl start postgresql
ok "PostgreSQL uruchomiony"

info "Tworzę użytkownika i bazę..."
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  || sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null \
  || warn "Baza $DB_NAME już istnieje"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null
ok "Baza '$DB_NAME' i użytkownik '$DB_USER' gotowi"

# ── 4. Backend Python ────────────────────────────────────────────
step "4/7 — BACKEND PYTHON"
DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

cat > "$BACKEND_DIR/.env" << EOF
DATABASE_URL=${DB_URL}
CORS_ORIGINS=*
EOF
ok "Plik backend/.env zapisany"

info "Tworzę wirtualne środowisko Python..."
python3 -m venv "$INSTALL_DIR/.venv"
source "$INSTALL_DIR/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q fastapi uvicorn psycopg2-binary python-dotenv
ok "Python venv gotowy"

info "Inicjalizuję schemat bazy danych..."
cd "$BACKEND_DIR"
python3 init_db.py
ok "Schemat bazy danych utworzony"

# ── 5. Frontend build ────────────────────────────────────────────
step "5/7 — FRONTEND BUILD"
cd "$INSTALL_DIR"

cat > "$INSTALL_DIR/.env.local" << EOF
VITE_API_URL=
EOF

info "npm install..."
$NPM_BIN install --legacy-peer-deps
ok "Zależności npm zainstalowane"

info "npm run build..."
$NPM_BIN run build
ok "Frontend zbudowany w ./dist"

# ── 6. Systemd serwis ────────────────────────────────────────────
step "6/7 — SERWIS SYSTEMD"
VENV_UVICORN="$INSTALL_DIR/.venv/bin/uvicorn"

cat > /etc/systemd/system/kebab-mes.service << EOF
[Unit]
Description=Kebab MES — Backend API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$VENV_UVICORN server_pg:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=$BACKEND_DIR/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebab-mes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kebab-mes -q
systemctl restart kebab-mes
sleep 3

if systemctl is-active --quiet kebab-mes; then
  ok "Serwis kebab-mes uruchomiony"
else
  warn "Serwis nie wystartował — sprawdź: journalctl -u kebab-mes -n 30"
fi

# ── 7. Nginx ─────────────────────────────────────────────────────
step "7/7 — NGINX"

cat > /etc/nginx/sites-available/kebab-mes << EOF
server {
    listen $APP_PORT;
    server_name _;

    root $INSTALL_DIR/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }

    access_log /var/log/nginx/kebab-mes.access.log;
    error_log  /var/log/nginx/kebab-mes.error.log;
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kebab-mes /etc/nginx/sites-enabled/kebab-mes
nginx -t && systemctl reload nginx
ok "Nginx skonfigurowany"

# ── Dane instalacji do pliku ─────────────────────────────────────
IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

cat > "$INSTALL_DIR/DANE_INSTALACJI.txt" << EOF
========================================
KEBAB MES v2.5 — Dane instalacji
Data: $(date '+%Y-%m-%d %H:%M')
========================================

URL aplikacji:   http://${IP}

Baza danych:
  Host:          $DB_HOST:$DB_PORT
  Baza:          $DB_NAME
  Użytkownik:    $DB_USER
  Hasło:         $DB_PASS
  DATABASE_URL:  $DB_URL

Pliki:
  Kod:      $INSTALL_DIR
  Backend:  $BACKEND_DIR
  Logi:     journalctl -u kebab-mes -f

Komendy serwisowe:
  systemctl restart kebab-mes
  systemctl status kebab-mes
  journalctl -u kebab-mes -n 50 -f
========================================
EOF
chmod 600 "$INSTALL_DIR/DANE_INSTALACJI.txt"

# ── Podsumowanie ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║       INSTALACJA ZAKOŃCZONA SUKCESEM!        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Otwórz w przeglądarce:${NC}"
echo -e "  ${BOLD}${CYAN}http://${IP}${NC}"
echo ""
echo -e "  Hasło bazy danych zapisane w:"
echo -e "  ${YELLOW}$INSTALL_DIR/DANE_INSTALACJI.txt${NC}"
echo ""
echo -e "  Przydatne komendy:"
echo -e "  ${BLUE}systemctl status kebab-mes${NC}       — status"
echo -e "  ${BLUE}journalctl -u kebab-mes -f${NC}       — logi na żywo"
echo -e "  ${BLUE}systemctl restart kebab-mes${NC}      — restart"
echo ""
