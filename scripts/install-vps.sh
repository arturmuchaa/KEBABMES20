#!/bin/bash
# ============================================================
# Kebab MES — Automatyczny instalator VPS
# Ubuntu 22.04 / 24.04
# Uruchom jako root: bash install-vps.sh
# ============================================================

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

echo ""
echo "  ██╗  ██╗███████╗██████╗  █████╗ ██████╗     ███╗   ███╗███████╗███████╗"
echo "  ██║ ██╔╝██╔════╝██╔══██╗██╔══██╗██╔══██╗    ████╗ ████║██╔════╝██╔════╝"
echo "  █████╔╝ █████╗  ██████╔╝███████║██████╔╝    ██╔████╔██║█████╗  ███████╗"
echo "  ██╔═██╗ ██╔══╝  ██╔══██╗██╔══██║██╔══██╗    ██║╚██╔╝██║██╔══╝  ╚════██║"
echo "  ██║  ██╗███████╗██████╔╝██║  ██║██████╔╝    ██║ ╚═╝ ██║███████╗███████║"
echo "  ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚═════╝     ╚═╝     ╚═╝╚══════╝╚══════╝"
echo ""
echo "  Automatyczny instalator systemu MES dla produkcji kebaba"
echo "  ========================================================="
echo ""

# Sprawdź root
[ "$EUID" -ne 0 ] && err "Uruchom jako root: sudo bash install-vps.sh"

# Zmienne
DB_NAME="kebabmes"
DB_USER="kebabmes"
DB_PASS="kebabmes$(date +%s | sha256sum | head -c 8)"
APP_DIR="/opt/kebabmes"
PORT=8000
BRANCH="claude/redesign-admin-ui-mOZG9"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"

echo "▶ Krok 1/8: Aktualizacja systemu..."
apt-get update -qq && apt-get upgrade -y -qq
log "System zaktualizowany"

echo "▶ Krok 2/8: Instalacja PostgreSQL..."
apt-get install -y -qq postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql
log "PostgreSQL zainstalowany"

echo "▶ Krok 3/8: Tworzenie bazy danych..."
sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS ${DB_USER};" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
log "Baza danych ${DB_NAME} utworzona"

echo "▶ Krok 4/8: Instalacja Python i Git..."
apt-get install -y -qq python3 python3-pip python3-venv git curl
log "Python i Git zainstalowane"

echo "▶ Krok 5/8: Pobieranie kodu z GitHub..."
rm -rf "$APP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
log "Kod pobrany do $APP_DIR"

echo "▶ Krok 6/8: Instalacja zależności Python..."
cd "$APP_DIR/kebab_fixed/backend"
pip3 install -q fastapi uvicorn psycopg2-binary python-dotenv cuid2

# Plik .env
cat > .env << EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost/${DB_NAME}
PORT=${PORT}
EOF
log "Zależności zainstalowane, .env utworzony"

echo "▶ Krok 7/8: Inicjalizacja bazy danych..."
python3 init_db.py
log "Baza danych zainicjalizowana"

echo "▶ Krok 8/8: Konfiguracja serwisu systemd..."
cat > /etc/systemd/system/kebabmes.service << EOF
[Unit]
Description=Kebab MES Backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
WorkingDirectory=${APP_DIR}/kebab_fixed/backend
ExecStart=/usr/bin/python3 server_pg.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebabmes
Environment=PORT=${PORT}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kebabmes
systemctl start kebabmes
sleep 3
log "Serwis kebabmes uruchomiony"

# Firewall
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp
    ufw allow ${PORT}/tcp
    ufw --force enable
    log "Firewall skonfigurowany (port ${PORT} otwarty)"
fi

# Pobierz publiczne IP
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "TWOJE_IP")

# Status
echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║           INSTALACJA ZAKOŃCZONA POMYŚLNIE            ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Adres API:       http://${PUBLIC_IP}:${PORT}"
echo "  Health check:    http://${PUBLIC_IP}:${PORT}/api/health"
echo "  Baza danych:     ${DB_NAME} @ localhost"
echo "  Hasło DB:        ${DB_PASS}"
echo ""
echo "  Zarządzanie serwisem:"
echo "    systemctl status kebabmes    # status"
echo "    systemctl restart kebabmes   # restart"
echo "    journalctl -fu kebabmes      # logi na żywo"
echo ""
echo "  W aplikacji Tauri Desktop wpisz jako URL:"
echo "    http://${PUBLIC_IP}:${PORT}"
echo ""

# Zapisz dane do pliku
cat > /root/kebabmes-info.txt << EOF
Kebab MES - dane instalacji
===========================
Data instalacji: $(date)
Adres API: http://${PUBLIC_IP}:${PORT}
Baza danych: ${DB_NAME}
Użytkownik DB: ${DB_USER}
Hasło DB: ${DB_PASS}
Katalog aplikacji: ${APP_DIR}
EOF

log "Dane zapisane w /root/kebabmes-info.txt"
