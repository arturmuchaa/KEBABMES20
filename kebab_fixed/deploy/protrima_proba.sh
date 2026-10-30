#!/usr/bin/env bash
# Środowisko PRÓBY PROTRIMA na serwerze produkcyjnym — OBOK produkcji, nie zamiast.
#
#   deploy/protrima_proba.sh instaluj       # raz: env próby, usługa systemd, plik nginx (bez włączania)
#   deploy/protrima_proba.sh odswiez-baze   # świeża kopia bazy produkcyjnej -> kebab_protrima, start backendu
#   deploy/protrima_proba.sh status         # usługa, kopia, izolacja roli, odpowiedzi :8020 i :8090
#   deploy/protrima_proba.sh sprawdz-env    # strażnik uruchamiany przez systemd przed startem backendu
#   deploy/protrima_proba.sh usun           # sprzątanie po próbie (pyta o potwierdzenie; robi człowiek)
#
# Jak próba jest odcięta od produkcji:
#   - kopia bazy kebab_protrima należy do OSOBNEJ roli protrima_test bez praw do tabel produkcji
#     (status to sprawdza), więc nawet pomyłka w adresie bazy nie pozwoli jej niczego zmienić;
#   - backend próby (usługa protrima-proba, 127.0.0.1:8020) nie wystartuje, jeśli DATABASE_URL
#     wskazuje inną bazę lub rolę albo jeśli sekrety są wspólne z produkcją (sprawdz-env
#     w ExecStartPre). To ważne, bo app/config.py doczytuje /opt/kebab/config/.env produkcji
#     dla zmiennych, których próba nie ustawi;
#   - próba ma własne RENDER_TOKEN_SECRET i ADMIN_TOKEN: ważny token renderowania PDF przepuszcza
#     każde żądanie /api (app/auth/middleware.py), więc token wydany przez próbę nie może działać
#     na produkcji;
#   - z kopii kasowane są sesje (tabela sessions trzyma tokeny logowania jawnie) — do próby
#     loguje się od nowa, tym samym loginem i hasłem;
#   - systemd montuje katalogi produkcji tylko do odczytu (ReadOnlyPaths) i odbiera procesowi
#     CAP_SYS_ADMIN oraz wywołania mount, żeby nie mógł tego odkręcić;
#   - nginx :8090 dostaje osobny plik w sites-available; włączenie i przeładowanie nginx
#     (wspólnego z produkcją) robi człowiek po `nginx -t`.
#
# Wzorzec kopiowania bazy jest ten sam co w deploy/proba_generalna.sh.
set -euo pipefail

TU="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE="${PROTRIMA_WORKTREE:-/opt/kebab/protrima}"
APP_DIR="$WORKTREE/kebab_fixed"
GALAZ="protrima-ui"
ENV_PROD="${KEBAB_ENV:-/opt/kebab/config/.env}"
ENV_PROBY="${PROTRIMA_ENV:-/opt/kebab/config/protrima.env}"
VENV="${KEBAB_VENV:-/opt/kebab/venv}"
PG_PORT="${KEBAB_PG_PORT:-5433}"
BAZA="kebab_protrima"
ROLA="protrima_test"
PORT_API=8020
PORT_WWW=8090
USLUGA="protrima-proba"
UNIT="/etc/systemd/system/$USLUGA.service"
NGINX_SITE="/etc/nginx/sites-available/$USLUGA"
# Data kopii dla paska „PRÓBA” w aplikacji (nginx podaje plik jako /proba-kopia.json).
STAN_DIR="${PROTRIMA_STAN:-/var/lib/protrima-proba}"
SEKRETY=(RENDER_TOKEN_SECRET ADMIN_TOKEN)

zle()  { echo "✗ $*" >&2; exit 1; }
info() { echo "▶ $*"; }
root() { [ "$(id -u)" = 0 ] || zle "Uruchom jako root (systemd, postgres)."; }
losowy() { python3 -c 'import secrets; print(secrets.token_hex(24))'; }

nazwa_z_url() { local n="${1##*/}"; echo "${n%%\?*}"; }

# Wartość zmiennej z pliku .env (ostatnie wystąpienie, bez cudzysłowów i `export`).
wartosc_z_env() {
  local plik="$1" zmienna="$2"
  [ -r "$plik" ] || return 0
  grep -E "^[[:space:]]*(export[[:space:]]+)?$zmienna=" "$plik" | tail -1 \
    | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$zmienna=//; s/^[\"']//; s/[\"'][[:space:]]*$//" || true
}

# SQL ze standardowego wejścia, wynik bez nagłówków. Uruchamia superużytkownik postgres.
sql_w() { su - postgres -c "psql -p $PG_PORT -d $1 -At -q -v ON_ERROR_STOP=1"; }

baza_produkcji() {
  [ -f "$ENV_PROD" ] || zle "Brak $ENV_PROD — to nie jest serwer produkcyjny."
  local nazwa; nazwa="$(nazwa_z_url "$(wartosc_z_env "$ENV_PROD" DATABASE_URL)")"
  [ -n "$nazwa" ] || zle "Nie umiem odczytać nazwy bazy z DATABASE_URL w $ENV_PROD."
  [ "$nazwa" != "$BAZA" ] || zle "Baza produkcji nazywa się jak baza próby ($BAZA) — przerwane."
  echo "$nazwa"
}

straznik() {
  # Ten sam strażnik co deploy.sh: na starym serwerze (przekierowanie 308) kopia byłaby z nieaktualnej bazy.
  # shellcheck source=deploy/straznik_hosta.sh
  . "$TU/straznik_hosta.sh"
  straznik_hosta
  [ -d "$APP_DIR/backend" ] || zle "Brak worktree $APP_DIR. Najpierw: git -C /opt/kebab/kebab_new worktree add -b $GALAZ $WORKTREE"
  local g; g="$(git -C "$WORKTREE" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [ "$g" = "$GALAZ" ] || zle "$WORKTREE jest na gałęzi '$g', a powinien na '$GALAZ'."
}

sprawdz_env() {
  if [ -z "${DATABASE_URL:-}" ] && [ -f "$ENV_PROBY" ]; then
    set -a; # shellcheck disable=SC1090
    . "$ENV_PROBY"; set +a
  fi
  local url="${DATABASE_URL:-}"
  [ -n "$url" ] || zle "DATABASE_URL nieustawione. Backend próby NIE wystartuje (wziąłby bazę z $ENV_PROD)."
  local nazwa; nazwa="$(nazwa_z_url "$url")"
  [ "$nazwa" = "$BAZA" ] || zle "DATABASE_URL wskazuje bazę '$nazwa'. Próba może używać wyłącznie $BAZA."
  case "$url" in
    *"://$ROLA:"*|*"://$ROLA@"*) ;;
    *) zle "DATABASE_URL musi używać roli $ROLA (bez praw do produkcji)." ;;
  esac
  [ "${BIND:-}" = "127.0.0.1:$PORT_API" ] || zle "BIND musi być 127.0.0.1:$PORT_API (jest: ${BIND:-brak})."
  local s w
  for s in "${SEKRETY[@]}"; do
    w="${!s:-}"
    [ -n "$w" ] || zle "$s nieustawione — próba wzięłaby wartość z produkcji. Uruchom: $0 instaluj"
    [ "$w" != "$(wartosc_z_env "$ENV_PROD" "$s")" ] || zle "$s jest taki sam jak w produkcji. Próba musi mieć własny."
  done
  echo "✓ env próby: baza $nazwa, rola $ROLA, $BIND, własne ${SEKRETY[*]}"
}

# Dopisuje do env próby brakujące sekrety (nowa instalacja albo plik sprzed tej wersji skryptu).
dopisz_sekrety() {
  local s
  for s in "${SEKRETY[@]}"; do
    if ! grep -qE "^$s=" "$ENV_PROBY"; then
      echo "$s=$(losowy)" >> "$ENV_PROBY"
      info "dopisano $s (własny dla próby)"
    fi
  done
}

unit_tresc() {
  cat <<EOF
[Unit]
Description=PROTRIMA PROBA - backend na KOPII bazy ($BAZA), nie produkcja
After=network.target postgresql.service

[Service]
Type=notify
User=root
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$ENV_PROBY
Environment=PYTHONUNBUFFERED=1
ExecStartPre=/bin/bash $APP_DIR/deploy/protrima_proba.sh sprawdz-env
ExecStart=$VENV/bin/gunicorn app.main:app -c app/gunicorn_conf.py
KillMode=mixed
TimeoutStopSec=30
Restart=on-failure
RestartSec=5
ProtectSystem=full
PrivateTmp=true
NoNewPrivileges=true
ReadOnlyPaths=-/opt/kebab/app -/opt/kebab/kebab_new -$ENV_PROD
CapabilityBoundingSet=~CAP_SYS_ADMIN
SystemCallFilter=~@mount
SystemCallErrorNumber=EPERM
SyslogIdentifier=$USLUGA

[Install]
WantedBy=multi-user.target
EOF
}

nginx_tresc() {
  sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@PORT_WWW@|$PORT_WWW|g" -e "s|@PORT_API@|$PORT_API|g" \
      -e "s|@STAN_DIR@|$STAN_DIR|g" <<'EOF'
# PROTRIMA PRÓBA — nie produkcja. Backend: usługa protrima-proba (127.0.0.1:@PORT_API@), baza kebab_protrima.
server {
    listen @PORT_WWW@;
    server_name _;
    root @APP_DIR@/dist;
    client_max_body_size 50m;
    add_header X-Protrima-Proba "kopia-bazy" always;

    location = / { return 302 /protrima.html; }
    location / { try_files $uri $uri/ /index.html; }

    # Kiedy zrobiono kopię bazy — pokazuje to pasek „PRÓBA” w aplikacji.
    location = /proba-kopia.json {
        alias @STAN_DIR@/kopia.json;
        default_type application/json;
        add_header Cache-Control "no-store" always;
        add_header X-Protrima-Proba "kopia-bazy" always;
    }

    location /api/admin/ { return 403; }
    location /api/desktop-updates/ { return 404; }

    location /api/ {
        proxy_pass http://127.0.0.1:@PORT_API@;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF
}

instaluj() {
  root
  straznik
  baza_produkcji >/dev/null

  if [ ! -f "$ENV_PROBY" ]; then
    local haslo; haslo="$(losowy)"
    ( umask 077
      cat > "$ENV_PROBY" <<EOF
# Backend PRÓBY PROTRIMA — NIE produkcji. Czego tu nie ma, backend weźmie z $ENV_PROD
# (load_dotenv nie nadpisuje zmiennych już ustawionych przez systemd).
DATABASE_URL=postgresql://$ROLA:$haslo@127.0.0.1:$PG_PORT/$BAZA
BIND=127.0.0.1:$PORT_API
SELF_BASE_URL=http://127.0.0.1:$PORT_API
WEB_CONCURRENCY=2
EOF
    )
    info "utworzono $ENV_PROBY (hasło roli $ROLA wygenerowane, plik 600)"
  else
    info "$ENV_PROBY już istnieje — zostawiam"
  fi
  dopisz_sekrety

  unit_tresc > "$UNIT"
  systemctl daemon-reload
  info "usługa $USLUGA zapisana w $UNIT (bez autostartu; start robi: $0 odswiez-baze)"

  nginx_tresc > "$NGINX_SITE"
  info "nginx: przygotowano $NGINX_SITE (NIE włączony)."
  cat <<EOF

Kroki dla człowieka (nginx i zapora są wspólne z produkcją):
  ln -s $NGINX_SITE /etc/nginx/sites-enabled/$USLUGA
  nginx -t && systemctl reload nginx
  ufw allow from <IP_BIURA> to any port $PORT_WWW proto tcp
Potem: $0 odswiez-baze
EOF
}

# Usuwa WYŁĄCZNIE bazę próby. WITH (FORCE) rozłącza otwarte sesje (PostgreSQL 13+);
# starszy serwer dostaje zwykłe DROP.
usun_baze_proby() {
  su - postgres -c "psql -p $PG_PORT -q -c 'DROP DATABASE IF EXISTS $BAZA WITH (FORCE)'" 2>/dev/null \
    || su - postgres -c "psql -p $PG_PORT -q -c 'DROP DATABASE IF EXISTS $BAZA'"
}

# Kopia bazy produkcji do $BAZA. Produkcja jest tylko czytana (pg_dump).
kopiuj_baze() {
  local prod="$1" obce ext
  usun_baze_proby
  su - postgres -c "createdb -p $PG_PORT -O $ROLA $BAZA"

  # Rozszerzenia zakłada superużytkownik (rola próby nie może), a ich CREATE/COMMENT
  # wycinamy ze zrzutu. Obsługujemy tylko rozszerzenia w schemacie public.
  obce="$(sql_w "$prod" <<'SQL'
SELECT string_agg(e.extname || ' w ' || n.nspname, ', ')
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE e.extname <> 'plpgsql' AND n.nspname <> 'public';
SQL
)"
  [ -z "$obce" ] || zle "Rozszerzenia poza schematem public ($obce). Ta kopia wymaga ręcznego kroku — przerwane."
  ext="$(sql_w "$prod" <<'SQL'
SELECT format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA public;', extname)
  FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname;
SQL
)"
  if [ -n "$ext" ]; then
    info "rozszerzenia w kopii: $(echo "$ext" | awk '{print $6}' | paste -sd' ' -)"
    echo "$ext" | sql_w "$BAZA" >/dev/null
  fi

  # SET ROLE: wszystkie obiekty kopii zakłada (i posiada) rola próby, nie właściciel produkcji.
  { echo "SET ROLE $ROLA;"
    su - postgres -c "pg_dump -p $PG_PORT --no-owner --no-privileges $prod" \
      | sed -E '/^(CREATE|COMMENT ON) EXTENSION /d'
  } | su - postgres -c "psql -p $PG_PORT -q -v ON_ERROR_STOP=1 -d $BAZA" >/dev/null

  # Tokeny logowania z produkcji nie mogą zostać w kopii.
  local sesje
  sesje="$(printf 'SET ROLE %s;\nWITH u AS (DELETE FROM sessions RETURNING 1) SELECT count(*) FROM u;\n' "$ROLA" | sql_w "$BAZA")"
  info "kopia gotowa; usunięte sesje z produkcji: $sesje"
}

zapisz_date_kopii() {
  mkdir -p "$STAN_DIR"
  chmod 755 "$STAN_DIR"
  printf '{"kopia": "%s", "baza": "%s"}\n' "$(date -Iseconds)" "$BAZA" > "$STAN_DIR/kopia.json"
  chmod 644 "$STAN_DIR/kopia.json"
}

# Rola próby nie może mieć żadnych praw do obiektów bazy produkcji.
sprawdz_izolacje() {
  local prod="$1" jest tabele schematy
  jest="$(echo "SELECT count(*) FROM pg_roles WHERE rolname = '$ROLA'" | sql_w postgres)" \
    || { echo "✗ izolacja: brak połączenia z PostgreSQL (port $PG_PORT)." >&2; return 1; }
  if [ "$jest" = 0 ]; then
    echo "— izolacja: rola $ROLA jeszcze nie istnieje"; return 0
  fi
  tabele="$(sql_w "$prod" <<SQL
SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
 WHERE s.nspname NOT IN ('pg_catalog', 'information_schema') AND s.nspname NOT LIKE 'pg_toast%'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d  -- widoki rozszerzeń (np. pg_stat_statements) są dla PUBLIC z definicji
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
   AND has_table_privilege('$ROLA', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
SQL
)"
  schematy="$(sql_w "$prod" <<SQL
SELECT coalesce(string_agg(nspname, ', '), '') FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
   AND has_schema_privilege('$ROLA', oid, 'CREATE');
SQL
)"
  if [ -z "$tabele" ]; then
    echo "✗ izolacja: nie udało się sprawdzić praw roli $ROLA w bazie $prod." >&2
    return 1
  fi
  if [ "$tabele" != 0 ]; then
    echo "✗ izolacja: $ROLA ma prawa do $tabele tabel/sekwencji bazy $prod. Zatrzymaj próbę i sprawdź GRANT-y." >&2
    return 1
  fi
  echo "✓ izolacja: $ROLA nie ma praw do tabel ani sekwencji bazy $prod"
  if [ -n "$schematy" ]; then
    echo "⚠ $ROLA może zakładać NOWE tabele w bazie $prod (schemat: $schematy) — domyślne prawo PostgreSQL < 15." >&2
    echo "  Istniejących danych to nie dotyczy. Zamknięcie tego to decyzja dla produkcji, nie dla próby." >&2
  fi
}

odswiez_baze() {
  root
  straznik
  [ -f "$ENV_PROBY" ] || zle "Najpierw: $0 instaluj"
  dopisz_sekrety
  local prod haslo
  prod="$(baza_produkcji)"
  haslo="$(sed -nE "s|^DATABASE_URL=postgresql://$ROLA:([^@]+)@.*|\1|p" "$ENV_PROBY")"
  [ -n "$haslo" ] || zle "Nie umiem odczytać hasła roli $ROLA z $ENV_PROBY."

  info "zatrzymuję $USLUGA (jeśli działa)"
  systemctl stop "$USLUGA" 2>/dev/null || true

  info "rola $ROLA (bez praw do produkcji)"
  su - postgres -c "psql -p $PG_PORT -q -v ON_ERROR_STOP=1" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLA') THEN
    CREATE ROLE $ROLA LOGIN;
  END IF;
END \$\$;
ALTER ROLE $ROLA WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$haslo';
SQL

  info "kopia $prod -> $BAZA (produkcja tylko czytana przez pg_dump)"
  kopiuj_baze "$prod"
  sprawdz_izolacje "$prod"
  zapisz_date_kopii

  info "start $USLUGA (migracje wykonują się przy starcie, jak na produkcji)"
  systemctl start "$USLUGA"
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT_API/api/health" || true)" = 200 ] && break
    sleep 1
  done
  status
}

status() {
  local usluga rozmiar kiedy kod u
  usluga="$(systemctl is-active "$USLUGA" 2>/dev/null || true)"
  rozmiar="$(echo "SELECT pg_size_pretty(pg_database_size('$BAZA'))" | sql_w postgres 2>/dev/null || true)"
  kiedy="$(sed -nE 's/.*"kopia": "([^"]+)".*/\1/p' "$STAN_DIR/kopia.json" 2>/dev/null || true)"
  echo "— usługa:  ${usluga:-brak}"
  echo "— kopia:   ${rozmiar:-brak}${kiedy:+, zrobiona $kiedy}"
  for u in "http://127.0.0.1:$PORT_API/api/health" "http://127.0.0.1:$PORT_WWW/api/health"; do
    kod="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$u" 2>/dev/null || true)"
    [ "$kod" != 000 ] || kod="brak odpowiedzi"
    echo "— $u -> ${kod:-brak odpowiedzi}"
  done
  local prod
  if prod="$(baza_produkcji 2>/dev/null)" && [ -n "$prod" ]; then
    sprawdz_izolacje "$prod" || true
  fi
}

usun() {
  root
  read -r -p "Usunąć bazę $BAZA, rolę $ROLA, usługę $USLUGA i $ENV_PROBY? Wpisz TAK: " ok
  [ "$ok" = "TAK" ] || zle "Przerwano."
  systemctl disable --now "$USLUGA" 2>/dev/null || true
  rm -f "$UNIT"
  systemctl daemon-reload
  usun_baze_proby
  su - postgres -c "psql -p $PG_PORT -q -c 'DROP ROLE IF EXISTS $ROLA'"
  rm -f "$ENV_PROBY"
  rm -rf "$STAN_DIR"
  echo "Zostało (nginx jest wspólny z produkcją):"
  echo "  rm /etc/nginx/sites-enabled/$USLUGA $NGINX_SITE && nginx -t && systemctl reload nginx"
}

# Wczytany przez `source` (testy) — tylko funkcje, bez akcji.
[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

case "${1:-}" in
  instaluj)      instaluj ;;
  odswiez-baze)  odswiez_baze ;;
  status)        status ;;
  sprawdz-env)   sprawdz_env ;;
  usun)          usun ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
