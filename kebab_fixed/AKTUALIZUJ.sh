#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  Uruchom: bash /opt/kebab/kebab_fixed/AKTUALIZUJ.sh
# ================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
err()  { echo -e "${RED}  ✗ BŁĄD: $1${NC}"; exit 1; }

BRANCH="claude/redesign-dashboard-ui-gNVuD"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"
TMP_DIR="/tmp/_kebab_update"

# Katalog gdzie zbudujemy i gdzie nginx szuka dist/
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja${NC}"
echo -e "  Katalog aplikacji: ${BOLD}$APP_DIR${NC}"
echo -e "  Branch: ${BOLD}$BRANCH${NC}"
echo ""

# ── 1. Pobierz kod do /tmp ───────────────────────────────────────
echo "  Pobieram kod z GitHub..."
rm -rf "$TMP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP_DIR" -q \
  || err "Nie można pobrać repo. Sprawdź połączenie z internetem."
ok "Kod pobrany"

# ── 2. Zachowaj .env.local i backend/.env ────────────────────────
[ -f "$APP_DIR/.env.local" ]     && cp "$APP_DIR/.env.local"     /tmp/_kebab_env_local
[ -f "$APP_DIR/backend/.env" ]   && cp "$APP_DIR/backend/.env"   /tmp/_kebab_env_backend

# ── 3. Skopiuj nowy kod do APP_DIR ──────────────────────────────
echo "  Aktualizuję pliki w $APP_DIR..."
rsync -a --delete \
  --exclude='.env.local' \
  --exclude='backend/.env' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.venv/' \
  "$TMP_DIR/kebab_fixed/" "$APP_DIR/"
ok "Pliki zaktualizowane"

# ── 4. Przywróć .env ─────────────────────────────────────────────
[ -f /tmp/_kebab_env_local ]   && cp /tmp/_kebab_env_local   "$APP_DIR/.env.local"
[ -f /tmp/_kebab_env_backend ] && cp /tmp/_kebab_env_backend "$APP_DIR/backend/.env"
[ ! -f "$APP_DIR/.env.local" ] && echo "VITE_API_URL=" > "$APP_DIR/.env.local"

# ── 5. Build frontendu ───────────────────────────────────────────
echo "  Instaluję zależności npm..."
cd "$APP_DIR"
npm install --legacy-peer-deps -q 2>&1 | tail -3
ok "npm install gotowy"

echo "  Buduję frontend..."
npm run build 2>&1 || err "npm run build nie powiodło się — sprawdź logi wyżej"
ok "Frontend przebudowany → $APP_DIR/dist"

# ── 5b. Patch VIES + synchronizuj backend do lokalizacji serwisu ─
# Serwis systemd używa WorkingDirectory=/opt/kebab/backend
OLD_BACKEND="/opt/kebab/backend"

echo "  Aktualizuję endpoint VIES w backendzie..."
python3 << 'VIES_PATCH'
import re, sys

VIES_CODE = '''
# ─── VIES API — EC SOAP (primary) + viesapi.eu (fallback) ──────
VIESAPI_ID  = "MyDWn3QuH2rJ"
VIESAPI_KEY = "1cVi2cO97cKT"

def _vies_soap(cc, vn):
    import urllib.request, re as r2
    soap = (
        "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>"
        "<soapenv:Envelope xmlns:soapenv=\\"http://schemas.xmlsoap.org/soap/envelope/\\">"
        "<soapenv:Body>"
        "<checkVat xmlns=\\"urn:ec.europa.eu:taxud:vies:services:checkVat:types\\">"
        f"<countryCode>{cc}</countryCode><vatNumber>{vn}</vatNumber>"
        "</checkVat></soapenv:Body></soapenv:Envelope>"
    )
    req = urllib.request.Request(
        "https://ec.europa.eu/taxation_customs/vies/services/checkVatService",
        data=soap.encode(), method="POST"
    )
    req.add_header("Content-Type", "text/xml; charset=UTF-8")
    req.add_header("SOAPAction", "")
    req.add_header("User-Agent", "KebabMES/2.3")
    with urllib.request.urlopen(req, timeout=15) as resp:
        xml = resp.read().decode()
    def t(n):
        m = r2.search(rf"<(?:ns2:)?{n}>(.*?)</(?:ns2:)?{n}>", xml, r2.DOTALL)
        return m.group(1).strip() if m else ""
    name = t("traderName"); addr = t("traderAddress")
    return {"vatNumber": cc+vn, "countryCode": cc,
            "traderName": "" if name=="---" else name,
            "traderAddress": "" if addr=="---" else addr,
            "valid": t("valid")=="true"}

def _vies_viesapi(cc, vn):
    import urllib.request, hmac as h, hashlib, base64, time, os as o2, re as r2
    vat = cc+vn; path = f"/api/get/vies/euvat/{vat}"
    ts = int(time.time()); nonce = o2.urandom(4).hex()
    msg = f"{ts}\\n{nonce}\\nGET\\n{path}\\nviesapi.eu\\n443\\n\\n"
    mac = base64.b64encode(h.new(VIESAPI_KEY.encode(), msg.encode(), hashlib.sha256).digest()).decode()
    auth = f\'MAC id="{VIESAPI_ID}", ts="{ts}", nonce="{nonce}", mac="{mac}"\'
    req = urllib.request.Request(f"https://viesapi.eu{path}", method="GET")
    req.add_header("Authorization", auth)
    req.add_header("Accept", "text/xml")
    req.add_header("User-Agent", "KebabMES/2.3")
    with urllib.request.urlopen(req, timeout=12) as resp:
        xml = resp.read().decode()
    def xt(n):
        m = r2.search(rf"<{n}>(.*?)</{n}>", xml, r2.DOTALL)
        return m.group(1).strip() if m else ""
    name = xt("traderName"); addr = xt("traderAddress")
    rc = xt("countryCode") or cc; rv = xt("vatNumber") or vn
    return {"vatNumber": rc+rv, "countryCode": rc,
            "traderName": "" if name=="---" else name,
            "traderAddress": "" if addr=="---" else addr,
            "valid": xt("valid").lower()=="true"}

@app.get("/api/vies/lookup")
def vies_lookup(vat: str):
    vat = vat.strip().upper().replace(" ","").replace("-","")
    if len(vat) < 4: raise HTTPException(400, "Za krotki numer VAT")
    cc = vat[:2]; vn = vat[2:]
    if not cc.isalpha() or len(vn)<2: raise HTTPException(400, "Nieprawidlowy VAT-UE np. DE123456789")
    last = ""
    try:
        return _vies_soap(cc, vn)
    except Exception as e:
        last = str(e)
    try:
        return _vies_viesapi(cc, vn)
    except Exception as e:
        last = str(e)
    raise HTTPException(502, f"Blad VIES: {last[:200]}")
'''

for path in [
    "/opt/kebab/kebab_fixed/backend/server_pg.py",
    "/opt/kebab/backend/server_pg.py",
]:
    try:
        with open(path) as f:
            src = f.read()
        # Usuń stary blok VIES
        cleaned = re.sub(
            r'\n# ─+[^\n]*VIES[^\n]*\n.*?(?=\n# ─|\n# ==|\Z)',
            '',
            src,
            flags=re.DOTALL
        )
        # Dołącz nowy blok
        out = cleaned.rstrip() + '\n' + VIES_CODE
        with open(path, 'w') as f:
            f.write(out)
        print(f"  OK: {path}")
    except FileNotFoundError:
        print(f"  POMINIĘTO (brak pliku): {path}")
    except Exception as e:
        print(f"  BŁĄD {path}: {e}", file=sys.stderr)
VIES_PATCH
ok "Endpoint VIES zaktualizowany"

# ── 6. Restart backendu ──────────────────────────────────────────
echo "  Restartuję backend..."
for svc in kebab-mes.service kebab.service kebabmes.service; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc" && ok "Serwis $svc zrestartowany" && break
    fi
done

# ── 7. Nginx reload ──────────────────────────────────────────────
nginx -t 2>/dev/null && systemctl reload nginx && ok "Nginx przeładowany" || warn "Nginx reload pominięty"

# ── Cleanup ──────────────────────────────────────────────────────
rm -rf "$TMP_DIR" /tmp/_kebab_env_local /tmp/_kebab_env_backend

echo ""
echo -e "${GREEN}${BOLD}  ✓ Gotowe! Odśwież przeglądarkę (Ctrl+Shift+R lub tryb incognito).${NC}"
echo ""
