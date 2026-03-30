# PostgreSQL — Konfiguracja na VPS

## Instalacja (Ubuntu/Debian)

```bash
apt update
apt install postgresql postgresql-contrib -y
systemctl enable postgresql
systemctl start postgresql
```

## Utwórz bazę i użytkownika

```bash
sudo -u postgres psql << SQL
CREATE USER kebabmes WITH PASSWORD 'TWOJE_SILNE_HASLO';
CREATE DATABASE kebab_mes OWNER kebabmes;
GRANT ALL PRIVILEGES ON DATABASE kebab_mes TO kebabmes;
SQL
```

Następnie w `backend/.env`:
```
DATABASE_URL=postgresql://kebabmes:TWOJE_SILNE_HASLO@localhost:5432/kebab_mes
```

## Inicjalizacja / migracja bazy

```bash
cd /opt/kebab
python3 backend/init_db.py          # tworzy tabele
python3 backend/init_db.py migrate  # dodaje brakujące kolumny (bezpieczne)
```

## Reset danych (uwaga — usuwa wszystko!)

```bash
python3 backend/init_db.py reset
```

## Backup

```bash
pg_dump -U kebabmes kebab_mes > backup_$(date +%Y%m%d).sql
```

## Restore

```bash
psql -U kebabmes kebab_mes < backup_YYYYMMDD.sql
```
