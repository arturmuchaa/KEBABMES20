# Rate-limit logowania (nginx)

Warstwa sieci uzupełniająca blokadę konta w aplikacji (`app/auth/lockout.py`:
5 nieudanych prób → blokada konta). nginx ogranicza tempo żądań do
`/api/auth/login` per IP — chroni przed hammeringiem / spray'owaniem loginów.

## Instalacja w `sites-available/kebab-mes`

1. W kontekście http (góra pliku, obok `upstream kebab_api`):

```nginx
# Klucz = IP tylko dla /api/auth/login; pusty klucz => brak limitu dla reszty /api/.
map $uri $kebab_login_key {
    default "";
    ~^/api/auth/login$ $binary_remote_addr;
}
limit_req_zone $kebab_login_key zone=kebab_login:10m rate=30r/m;
```

2. W KAŻDYM `location /api/ { ... }` (server 8080 i 8443), na początku bloku:

```nginx
limit_req zone=kebab_login burst=20 nodelay;
```

Pusty klucz dla nie-loginowych ścieżek => `limit_req` ich nie dotyczy, więc cała
reszta API działa bez limitu (nie trzeba duplikować bloku proxy).

3. `nginx -t && systemctl reload nginx`

## Parametry / weryfikacja

- `rate=30r/m` + `burst=20 nodelay` — pojedyncze logowanie zawsze przechodzi;
  biuro za NAT (kilka osób na starcie zmiany) mieści się w burst; atak (dziesiątki
  żądań/s) dostaje `503`.
- Test: 40 równoległych `POST /api/auth/login` → ~20×401 przechodzi, reszta `503`.
  Sekwencyjne logowanie (bcrypt) NIE wyzwala limitu — to oczekiwane.
