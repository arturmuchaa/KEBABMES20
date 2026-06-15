# KEBAB MES — System zarządzania produkcją

System MES do zarządzania produkcją kebaba: rozbiór, masowanie, receptury, magazyn, produkcja, HACCP.

## Architektura

```
kebab/
├── backend/          # Python FastAPI + PostgreSQL
│   ├── app/          # API (FastAPI) — entrypoint app.main:app
│   ├── init_db.py    # Tworzenie / migracja bazy
│   └── requirements_pg.txt
├── src/              # Frontend React + Vite + TypeScript
└── AKTUALIZUJ_VPS.sh # Skrypt instalacji/aktualizacji
```

## Instalacja na VPS (pierwsza lub aktualizacja)

### Wymagania
- Ubuntu 22.04+
- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- nginx

### Kroki

```bash
# 1. Wgraj archiwum na VPS
scp KEBAB-MES-FIXED-VPS.tar.gz user@VPS_IP:/opt/

# 2. Rozpakuj
cd /opt && tar -xzf KEBAB-MES-FIXED-VPS.tar.gz && cd kebab

# 3. Skonfiguruj bazę danych
cp backend/.env.example backend/.env
nano backend/.env        # uzupełnij DATABASE_URL z hasłem

# 4. Uruchom skrypt instalacyjny
bash AKTUALIZUJ_VPS.sh
```

### Nginx — przykładowa konfiguracja

```nginx
server {
    listen 80;
    server_name TWOJ_IP;

    # Frontend (pliki statyczne po npm run build)
    root /opt/kebab/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }
}
```

## Uruchomienie backendu (ręczne)

```bash
cd backend
pip3 install -r requirements_pg.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Uruchomienie frontendu (dev)

```bash
npm install
npm run dev        # dostępny na http://localhost:5173
```

## Build frontendu (produkcja)

```bash
npm run build      # wyniki w ./dist/
```
