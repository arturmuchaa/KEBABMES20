#!/usr/bin/env bash
# Odnowienie certyfikatu HTTPS MES (:8443) po zmianie adresu serwera.
#
# POWÓD ISTNIENIA: certyfikat serwera ma adres wpisany w polu SAN. Po migracji
# do Falkenstein (22.08.2026) SAN nadal wskazywał stary adres w Helsinkach, więc
# Chrome pokazywał ERR_CERT_COMMON_NAME_INVALID i — co ważniejsze — NIE dawało
# się tego naprawić zainstalowaniem naszego CA: niezgodnego adresu żaden CA nie
# przykryje. Bez działającego HTTPS strona MES nie jest „bezpiecznym kontekstem",
# a wtedy Chrome blokuje dostęp do drukarki Zebra na http://localhost:9100.
#
# Podpisujemy TYM SAMYM lokalnym CA, więc certyfikat CA raz zainstalowany na
# komputerach biura zostaje ważny — wymieniamy tylko certyfikat serwera.
#
# Użycie (na serwerze produkcyjnym):
#   deploy/odnow-certyfikat.sh                      # adresy domyślne
#   deploy/odnow-certyfikat.sh 91.98.105.107 1.2.3.4
set -euo pipefail

SSL_DIR="${KEBAB_SSL_DIR:-/etc/kebab/ssl}"
DNI="${KEBAB_CERT_DAYS:-1460}"
IPS=("$@")
if [ ${#IPS[@]} -eq 0 ]; then
  # Falkenstein = produkcja. Stary adres zostaje na liście: stamtąd nadal idą
  # przekierowania, a w przeglądarkach biura siedzą stare zakładki.
  IPS=(91.98.105.107 204.168.166.34)
fi

cd "$SSL_DIR"
for f in ca.crt ca.key server.key server.csr; do
  [ -f "$f" ] || { echo "✗ brak $SSL_DIR/$f — nie ma z czego wystawić" >&2; exit 1; }
done

TS="$(date +%Y%m%d-%H%M%S)"
cp -a server.crt "server.crt.bak-$TS"
[ -f server.ext ] && cp -a server.ext "server.ext.bak-$TS"
echo "▶ kopia poprzedniego: server.crt.bak-$TS"

SAN="$(printf 'IP:%s,' "${IPS[@]}")DNS:kebab-mes,DNS:$(hostname),DNS:localhost"
cat > server.ext <<EXT
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $SAN
EXT

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt.new -days "$DNI" -sha256 -extfile server.ext >/dev/null 2>&1

# Certyfikat niepasujący do klucza wywala nginx przy starcie — sprawdzamy PRZED
# podmianą, bo po niej byłoby już za późno na „ups".
if [ "$(openssl rsa -in server.key -noout -modulus | openssl md5)" \
   != "$(openssl x509 -in server.crt.new -noout -modulus | openssl md5)" ]; then
  rm -f server.crt.new
  echo "✗ klucz nie pasuje do nowego certyfikatu — nic nie zmieniono" >&2
  exit 1
fi

mv server.crt.new server.crt
echo "▶ nowy certyfikat:"
openssl x509 -in server.crt -noout -dates | sed 's/^/    /'
openssl x509 -in server.crt -noout -text | grep -A 1 "Subject Alternative Name" | tail -1 | sed 's/^/    /'

nginx -t
systemctl reload nginx
echo "✓ nginx przeładowany"
echo
echo "Certyfikat CA do zainstalowania na komputerach biura (Chrome →"
echo "Ustawienia → Prywatność → Bezpieczeństwo → Zarządzaj certyfikatami →"
echo "Zaufane główne urzędy certyfikacji):"
echo "    $SSL_DIR/ca.crt"
