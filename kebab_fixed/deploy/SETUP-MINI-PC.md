# Wdrożenie mini-PC u klienta — od pustego sprzętu do działającej instancji

Checklista wdrożeniowa. Czas: ~30–45 min. Robisz to RAZ na klienta.
Po wszystkim mini-PC działa „sam": włącza się, kontenery wstają, kioski się łączą,
Ty doglądasz zdalnie.

---

## 0. Sprzęt (kup)
- Mini-PC fanless: Intel N100/N305 lub i3/i5, **16 GB RAM**, **512 GB NVMe SSD**.
  (Dell OptiPlex Micro / Lenovo ThinkCentre Tiny / HP EliteDesk Mini / Beelink / MinisForum)
- **UPS** (mały, line-interactive) — chroni bazę przy skoku/zaniku prądu.
- Pendrive ≥ 8 GB (do instalacji systemu).
- Kabel Ethernet.

## 1. BIOS (raz, przy pierwszym włączeniu)
- **Auto power-on po zaniku prądu**: włącz „Restore on AC Power Loss = Power On"
  (po blackoucie mini-PC sam wstanie).
- Wyłącz tryb uśpienia/hibernacji.
- (Opcjonalnie) Secure Boot możesz zostawić włączony — Ubuntu Server go obsługuje.

## 2. System: Ubuntu Server LTS (headless, bez pulpitu)
- Wgraj **Ubuntu Server LTS** na pendrive (Rufus/balenaEtcher) i zainstaluj.
- Przy instalacji: utwórz użytkownika, **zaznacz „Install OpenSSH server"**.
- Po instalacji odłącz monitor — dalej pracujesz przez SSH.

## 3. Sieć — stałe IP (żeby kioski zawsze go znalazły)
Mini-PC wpinasz **kablem w wolny port switcha** sieci biuro/produkcja (NIE w sieć kamer).
Nadaj **stałe IP poza pulą DHCP** — najlepiej **rezerwacja DHCP po MAC** w routerze
(czyściej niż ustawianie statycznie na maszynie). Przykład docelowy: `192.168.1.50`.

Sprawdź MAC karty:
```bash
ip link show          # adres po "link/ether"
```
Wpisz rezerwację w routerze (MAC → 192.168.1.50). Restart sieci/maszyny i:
```bash
ip a                  # potwierdź że ma 192.168.1.50
```
> Monitoring/CCTV: jeśli jest na osobnym switchu/VLAN — nie dotykasz. Jeśli wszystko
> na jednym switchu — wystarczy stałe IP/rezerwacja, kamery nie kolidują (inne adresy).

## 4. Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER       # przeloguj się po tym
docker --version && docker compose version
```

## 5. Postaw instancję klienta
```bash
git clone https://github.com/arturmuchaa/KEBABMES20.git
cd KEBABMES20/kebab_fixed
bash deploy/nowy-klient.sh <slug>   # pyta o nazwę/NIP/port/moduły; baza startuje pusta
```
Sprawdź:
```bash
docker compose -p kebab-<slug> -f deploy/docker-compose.yml ps
curl -s http://localhost:8080/ | head     # albo Twój APP_PORT
```
Kontenery mają `restart: unless-stopped` → wstaną same po restarcie maszyny.

## 6. Konfiguracja kiosków / biura / tabletu
Na każdym urządzeniu otwórz `http://192.168.1.50:8080` (przeglądarka lub apka desktop).
- Stałe kioski (rozbiór, pakowanie) i biuro → **kabel**.
- Tablet operatora (mobilny) → **WiFi**.

## 7. Dostęp zdalny
**Tailscale (Twój serwis/aktualizacje):**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Od teraz dostajesz się do mini-PC z dowolnego miejsca po prywatnym adresie.

**Cloudflare Tunnel (szef z domu, w przeglądarce, bez instalek):**
- Zainstaluj `cloudflared`, utwórz tunel do `http://localhost:8080`,
  podepnij domenę (np. `mes.firmaklienta.pl`) i włącz **Cloudflare Access** (logowanie).
- Mini-PC NIE jest wystawiony publicznie (tunel wychodzi na zewnątrz).

> ⚠️ Przed wystawieniem na zewnątrz: włącz realne logowanie/konta w MES
> (dziś `ADMIN_TOKEN` jest w trybie miękkim).

## 8. Backup bazy (automyczny)
Cron z `pg_dump` + kopia poza maszynę (np. na dysk sieciowy / chmurę):
```bash
# /etc/cron.daily/kebab-backup  (chmod +x)
SLUG=<slug>
docker exec kebab-$SLUG-db-1 pg_dump -U kebab kebab_mes \
  | gzip > /var/backups/kebab-$SLUG-$(date +\%F).sql.gz
find /var/backups -name "kebab-$SLUG-*.sql.gz" -mtime +30 -delete
```

## 9. Aktualizacja u klienta (zdalnie przez Tailscale)
```bash
cd KEBABMES20 && git pull
cd kebab_fixed
docker compose -p kebab-<slug> --env-file clients/<slug>/.env -f deploy/docker-compose.yml up -d --build
```
Migracje schematu wykonają się same przy starcie backendu.

---

## Szybka checklista odbioru
- [ ] mini-PC ma stałe IP, pinguje z kiosku
- [ ] `docker compose ps` → kontenery `Up`
- [ ] kiosk/biuro otwiera UI po IP
- [ ] auto-start po restarcie (zrestartuj i sprawdź)
- [ ] Tailscale działa (wejście z zewnątrz)
- [ ] (opcjonalnie) Cloudflare + Access dla szefa
- [ ] backup w cronie + test odtworzenia
- [ ] UPS podłączony
