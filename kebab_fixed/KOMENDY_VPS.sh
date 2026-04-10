#!/bin/bash
# ===================================================================
# KEBAB MES v3.0 — KOMENDY DO WKLEJENIA NA VPS
# Wklej kazdy blok osobno w terminalu VPS (ssh root@204.168.166.34)
# ===================================================================

# ==========================
# BLOK 1: STOP + CZYSZCZENIE
# ==========================
systemctl stop kebab-mes 2>/dev/null
systemctl disable kebab-mes 2>/dev/null
rm -rf /opt/kebab
mkdir -p /opt/kebab/app/backend /opt/kebab/venv /opt/kebab/config /opt/kebab/logs
echo "OK: Stary serwis zatrzymany, /opt/kebab/ utworzony"


# ==========================
# BLOK 2: CLONE REPO
# ==========================
cd /tmp
rm -rf kebab-install
git clone https://github.com/arturmuchaa/KEBABMES20.git kebab-install
cd /tmp/kebab-install
git checkout glowny
echo "OK: Repo sklonowane, branch glowny"


# ==========================
# BLOK 3: KOPIUJ BACKEND
# ==========================
cp -r /tmp/kebab-install/kebab_fixed/backend/app /opt/kebab/app/backend/app
cp /tmp/kebab-install/kebab_fixed/backend/init_db.py /opt/kebab/app/backend/
cp /tmp/kebab-install/kebab_fixed/backend/requirements_pg.txt /opt/kebab/app/backend/
echo "OK: Backend w /opt/kebab/app/backend/"
ls /opt/kebab/app/backend/app/


# ==========================
# BLOK 4: PYTHON VENV + GUNICORN
# ==========================
python3 -m venv /opt/kebab/venv
/opt/kebab/venv/bin/pip install --upgrade pip
/opt/kebab/venv/bin/pip install fastapi uvicorn gunicorn psycopg2-binary python-dotenv pydantic
echo "OK: Venv gotowy"
/opt/kebab/venv/bin/gunicorn --version


# ==========================
# BLOK 5: .ENV (KONFIGURACJA)
# Jesli masz juz baze kebab_mes — uzyj istniejacego hasla
# Jesli nie — ten blok tworzy nowego usera
# ==========================
DB_PASS=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
sudo -u postgres psql -c "CREATE USER kebabmes WITH PASSWORD '$DB_PASS';" 2>/dev/null \
  || sudo -u postgres psql -c "ALTER USER kebabmes WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -c "CREATE DATABASE kebab_mes OWNER kebabmes;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE kebab_mes TO kebabmes;" 2>/dev/null || true

cat > /opt/kebab/config/.env << EOF
DATABASE_URL=postgresql://kebabmes:${DB_PASS}@localhost:5432/kebab_mes
CORS_ORIGINS=*
LOG_LEVEL=INFO
LOG_JSON=false
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_STATEMENT_TIMEOUT_MS=30000
EOF
chmod 600 /opt/kebab/config/.env
echo "OK: .env zapisany"
echo "HASLO BAZY: $DB_PASS"
echo "ZAPISZ TO HASLO!"


# ==========================
# BLOK 6: INIT DB + MIGRACJE
# ==========================
cd /opt/kebab/app/backend
source /opt/kebab/config/.env
DATABASE_URL="$DATABASE_URL" /opt/kebab/venv/bin/python3 init_db.py
DATABASE_URL="$DATABASE_URL" /opt/kebab/venv/bin/python3 -c "
import sys, os; sys.path.insert(0,'.')
from app.db import init_pool, close_pool
from app.migrations import run_migrations
init_pool(); run_migrations(); close_pool()
print('Migracje OK')
"
echo "OK: Baza danych gotowa"


# ==========================
# BLOK 7: FRONTEND BUILD
# ==========================
cd /tmp/kebab-install/kebab_fixed
echo "VITE_API_URL=" > .env.local
npm install --legacy-peer-deps
npm run build
cp -r dist /opt/kebab/app/dist
echo "OK: Frontend w /opt/kebab/app/dist/"
ls /opt/kebab/app/dist/


# ==========================
# BLOK 8: SYSTEMD SERVICE
# ==========================
cat > /etc/systemd/system/kebab-mes.service << 'EOF'
[Unit]
Description=Kebab MES v3.0 Backend (gunicorn)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=root
WorkingDirectory=/opt/kebab/app/backend
ExecStart=/opt/kebab/venv/bin/gunicorn \
  -k uvicorn.workers.UvicornWorker \
  -w 2 \
  -b 127.0.0.1:8000 \
  app.main:app
ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/opt/kebab/config/.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=kebab-mes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kebab-mes
echo "OK: Serwis systemd skonfigurowany"


# ==========================
# BLOK 9: NGINX
# ==========================
cat > /etc/nginx/sites-available/kebab-mes << 'EOF'
server {
    listen 80;
    server_name _;

    root /opt/kebab/app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    access_log /var/log/nginx/kebab-mes.access.log;
    error_log  /var/log/nginx/kebab-mes.error.log;
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/kebab-mes /etc/nginx/sites-enabled/kebab-mes
nginx -t && systemctl reload nginx
echo "OK: Nginx skonfigurowany"


# ==========================
# BLOK 10: START + WERYFIKACJA
# ==========================
systemctl restart kebab-mes
sleep 3
systemctl status kebab-mes --no-pager
curl -s http://127.0.0.1:8000/api/health
echo ""
echo "============================="
echo "GOTOWE! Otworz: http://204.168.166.34"
echo "============================="


# ==========================
# BLOK 11: SPRZATANIE
# ==========================
rm -rf /tmp/kebab-install
echo "OK: Katalog instalacyjny usuniety"
