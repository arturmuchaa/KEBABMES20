#!/bin/bash
# ================================================================
#  KEBAB MES v3.0 — Aktualizacja VPS do nowej architektury
#  Uruchom jako root: bash AKTUALIZUJ_VPS.sh
#
#  Co robi:
#   1. Tworzy backup obecnego stanu
#   2. Czyści niepotrzebne pliki i duplikaty
#   3. Instaluje brakujące zależności (gunicorn)
#   4. Aktualizuje systemd serwis (gunicorn + uvicorn workers)
#   5. Buduje frontend
#   6. Restartuje wszystko
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

[[ $EUID -ne 0 ]] && err "Uruchom jako root: sudo bash AKTUALIZUJ_VPS.sh"

clear
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   KEBAB MES v3.0 — Aktualizacja na VPS       ║${NC}"
echo -e "${BOLD}${CYAN}║   Nowa architektura modułowa + gunicorn       ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$INSTALL_DIR/backend"

echo -e "  Katalog instalacji: ${BOLD}$INSTALL_DIR${NC}"
echo -e "  Backend:            ${BOLD}$BACKEND_DIR${NC}"
echo ""
read -p "  Kontynuować? [T/n]: " CONFIRM
[[ "$CONFIRM" =~ ^[Nn] ]] && echo "Anulowano." && exit 0

# ── 1. BACKUP ───────────────────────────────────────────────────────
step "1/8 — BACKUP"
BACKUP_DIR="$INSTALL_DIR/_backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Zachowaj .env (ma hasła do bazy)
[[ -f "$BACKEND_DIR/.env" ]] && cp "$BACKEND_DIR/.env" "$BACKUP_DIR/.env"
# Zachowaj stary monolityczny serwer
[[ -f "$BACKEND_DIR/server_pg.py" ]] && cp "$BACKEND_DIR/server_pg.py" "$BACKUP_DIR/server_pg.py"
# Zachowaj init_db
[[ -f "$BACKEND_DIR/init_db.py" ]] && cp "$BACKEND_DIR/init_db.py" "$BACKUP_DIR/init_db.py"
# Zachowaj dane instalacji
[[ -f "$INSTALL_DIR/DANE_INSTALACJI.txt" ]] && cp "$INSTALL_DIR/DANE_INSTALACJI.txt" "$BACKUP_DIR/"

ok "Backup zapisany w: $BACKUP_DIR"

# ── 2. WCZYTAJ DANE Z .ENV ─────────────────────────────────────────
step "2/8 — KONFIGURACJA"
if [[ -f "$BACKEND_DIR/.env" ]]; then
    source "$BACKEND_DIR/.env" 2>/dev/null || true
    ok "Plik .env wczytany"
    info "DATABASE_URL=$DATABASE_URL"
else
    warn "Brak pliku backend/.env — zostanie utworzony"
    read -p "  Podaj DATABASE_URL [postgresql://kebabmes:HASŁO@localhost:5432/kebab_mes]: " DB_URL_INPUT
    DB_URL="${DB_URL_INPUT:-postgresql://kebabmes:$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)@localhost:5432/kebab_mes}"
    cat > "$BACKEND_DIR/.env" << EOF
DATABASE_URL=${DB_URL}
CORS_ORIGINS=*
LOG_LEVEL=INFO
LOG_JSON=false
EOF
    ok "Plik backend/.env utworzony"
fi

# Upewnij się że .env ma nowe zmienne
grep -q "LOG_LEVEL" "$BACKEND_DIR/.env" || echo "LOG_LEVEL=INFO" >> "$BACKEND_DIR/.env"
grep -q "LOG_JSON" "$BACKEND_DIR/.env" || echo "LOG_JSON=false" >> "$BACKEND_DIR/.env"
ok "Konfiguracja .env kompletna"

# ── 3. CZYSZCZENIE ŚMIECI ──────────────────────────────────────────
step "3/8 — CZYSZCZENIE NIEPOTRZEBNYCH PLIKÓW"

# Stary monolityczny serwer (zastąpiony przez app/)
if [[ -f "$BACKEND_DIR/server_pg.py" ]]; then
    rm -f "$BACKEND_DIR/server_pg.py"
    ok "Usunięto: server_pg.py (monolityczny — zastąpiony przez app/)"
fi

# Stary skrypt migracji (zastąpiony przez app/migrations.py)
if [[ -f "$BACKEND_DIR/migrate_batch_numbers.py" ]]; then
    rm -f "$BACKEND_DIR/migrate_batch_numbers.py"
    ok "Usunięto: migrate_batch_numbers.py (zastąpiony przez app/migrations.py)"
fi

# Stare archiwa tar.gz w katalogu projektu
find "$INSTALL_DIR/.." -maxdepth 1 -name "*.tar.gz" -type f 2>/dev/null | while read f; do
    rm -f "$f"
    ok "Usunięto archiwum: $(basename $f)"
done

# latest.json (nie potrzebny)
[[ -f "$INSTALL_DIR/../latest.json" ]] && rm -f "$INSTALL_DIR/../latest.json" && ok "Usunięto: latest.json"

# Stare pliki __pycache__ i .pyc
find "$BACKEND_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null
find "$BACKEND_DIR" -name "*.pyc" -delete 2>/dev/null
ok "Usunięto: __pycache__ i .pyc"

# Node modules cache
[[ -d "$INSTALL_DIR/node_modules/.cache" ]] && rm -rf "$INSTALL_DIR/node_modules/.cache" && ok "Usunięto: node_modules/.cache"

ok "Czyszczenie zakończone"

# ── 4. SPRAWDŹ PYTHON + VENV ───────────────────────────────────────
step "4/8 — ŚRODOWISKO PYTHON"

if [[ ! -d "$INSTALL_DIR/.venv" ]]; then
    info "Tworzę wirtualne środowisko Python..."
    python3 -m venv "$INSTALL_DIR/.venv"
fi
source "$INSTALL_DIR/.venv/bin/activate"

info "Instaluję zależności (fastapi, gunicorn, psycopg2, pydantic)..."
pip install -q --upgrade pip
pip install -q fastapi uvicorn gunicorn psycopg2-binary python-dotenv pydantic
ok "Zależności Python zainstalowane"

# Weryfikacja gunicorn
GUNICORN_BIN="$INSTALL_DIR/.venv/bin/gunicorn"
if [[ -x "$GUNICORN_BIN" ]]; then
    ok "gunicorn zainstalowany: $($GUNICORN_BIN --version 2>&1)"
else
    err "gunicorn nie znaleziony w venv!"
fi

# ── 5. SPRAWDŹ BAZĘ DANYCH ─────────────────────────────────────────
step "5/8 — BAZA DANYCH"
info "Sprawdzam połączenie z bazą..."
cd "$BACKEND_DIR"
PYTHONPATH="$BACKEND_DIR" "$INSTALL_DIR/.venv/bin/python3" -c "
import sys
sys.path.insert(0, '.')
from app.db import init_pool, healthcheck, close_pool
init_pool()
ok = healthcheck()
close_pool()
if ok:
    print('  ✓ Połączenie z bazą OK')
else:
    print('  ✗ Brak połączenia z bazą!')
    sys.exit(1)
" || {
    warn "Baza niedostępna — upewnij się że PostgreSQL działa:"
    echo "  systemctl start postgresql"
    echo "  systemctl enable postgresql"
    err "Nie mogę kontynuować bez bazy danych"
}

info "Uruchamiam migracje..."
PYTHONPATH="$BACKEND_DIR" "$INSTALL_DIR/.venv/bin/python3" -c "
import sys
sys.path.insert(0, '.')
from app.db import init_pool, close_pool
from app.migrations import run_migrations
init_pool()
run_migrations()
close_pool()
print('  ✓ Migracje zakończone')
"
ok "Baza danych zaktualizowana"

# ── 6. FRONTEND BUILD ──────────────────────────────────────────────
step "6/8 — FRONTEND BUILD"
cd "$INSTALL_DIR"

NODE_BIN=$(which node 2>/dev/null)
NPM_BIN=$(which npm 2>/dev/null)

if [[ -z "$NODE_BIN" ]] || [[ -z "$NPM_BIN" ]]; then
    warn "Node.js nie znaleziony — pomijam build frontendu"
    warn "Zainstaluj Node.js i uruchom: npm install && npm run build"
else
    # Upewnij się że .env.local istnieje (frontend potrzebuje)
    [[ ! -f "$INSTALL_DIR/.env.local" ]] && echo "VITE_API_URL=" > "$INSTALL_DIR/.env.local"

    if [[ ! -d "$INSTALL_DIR/node_modules" ]]; then
        info "npm install..."
        $NPM_BIN install --legacy-peer-deps 2>&1 | tail -3
    fi
    info "npm run build..."
    $NPM_BIN run build 2>&1 | tail -5
    ok "Frontend zbudowany w ./dist"
fi

# ── 7. SYSTEMD SERWIS ──────────────────────────────────────────────
step "7/8 — SERWIS SYSTEMD (gunicorn)"

cat > /etc/systemd/system/kebab-mes.service << SERVICEEOF
[Unit]
Description=Kebab MES v3.0 — Backend API (gunicorn + uvicorn workers)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$INSTALL_DIR/.venv/bin/gunicorn app.main:app -c app/gunicorn_conf.py
ExecReload=/bin/kill -s HUP \$MAINPID
KillMode=mixed
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=$BACKEND_DIR/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebab-mes

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable kebab-mes -q
ok "Serwis systemd zaktualizowany (gunicorn)"

# ── 8. NGINX ────────────────────────────────────────────────────────
step "8/8 — NGINX"

# Zainstaluj nginx jeśli brak
if ! command -v nginx &>/dev/null; then
    info "Instaluję nginx..."
    apt-get install -y -qq nginx
fi

cat > /etc/nginx/sites-available/kebab-mes << NGINXEOF
server {
    listen 80;
    server_name _;

    root $INSTALL_DIR/dist;
    index index.html;

    # Frontend SPA
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API proxy → gunicorn
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    # Health check (direct, no /api prefix)
    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
    }

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1000;

    access_log /var/log/nginx/kebab-mes.access.log;
    error_log  /var/log/nginx/kebab-mes.error.log;
}
NGINXEOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kebab-mes /etc/nginx/sites-enabled/kebab-mes
nginx -t && systemctl reload nginx
ok "Nginx skonfigurowany"

# ── RESTART WSZYSTKIEGO ─────────────────────────────────────────────
echo ""
info "Restartuję serwisy..."
systemctl restart kebab-mes
sleep 3

if systemctl is-active --quiet kebab-mes; then
    ok "Serwis kebab-mes działa!"
else
    warn "Serwis nie wystartował — sprawdź logi:"
    echo "  journalctl -u kebab-mes -n 50 --no-pager"
fi

# ── PODSUMOWANIE ────────────────────────────────────────────────────
IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║     AKTUALIZACJA ZAKOŃCZONA SUKCESEM!        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Aplikacja:${NC}         http://${IP}"
echo -e "  ${BOLD}Health check:${NC}      http://${IP}/api/health"
echo ""
echo -e "  ${BOLD}Co się zmieniło:${NC}"
echo -e "    • Backend:  monolityczny server_pg.py → modułowy app/"
echo -e "    • Serwer:   uvicorn single → gunicorn + uvicorn workers"
echo -e "    • DB:       per-request connect → ThreadedConnectionPool"
echo -e "    • Transakcje: BEGIN/COMMIT/ROLLBACK + FOR UPDATE locking"
echo -e "    • Traceability: stock_movement na każdą zmianę kg"
echo ""
echo -e "  ${BOLD}Przydatne komendy:${NC}"
echo -e "    ${BLUE}systemctl status kebab-mes${NC}       — status serwisu"
echo -e "    ${BLUE}journalctl -u kebab-mes -f${NC}       — logi na żywo"
echo -e "    ${BLUE}systemctl restart kebab-mes${NC}      — restart"
echo ""
echo -e "  ${BOLD}Backup starego kodu:${NC}"
echo -e "    ${YELLOW}$BACKUP_DIR${NC}"
echo ""
