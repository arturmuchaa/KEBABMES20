"""Mapa prefiks URL → wymagane uprawnienie + sprawdzenie dostępu.

Zwracane uprawnienia:
  "public" — bez logowania
  "any"    — dowolny zalogowany
  "admin"  — tylko konto biura roli admin
  "office" — konto biura (admin lub office)
  <slug>   — operator z tym działem LUB biuro
"""
from __future__ import annotations

from typing import Optional

# Prefiksy publiczne (bez sesji)
PUBLIC_PREFIXES = (
    "/api/auth/login",
    "/api/auth/login-pin",
    "/api/auth/operators",
    "/api/health",
    # Manifesty/pobieranie aktualizacji desktopowych (Tauri updater) — klient
    # sprawdza/pobiera anonimowo, nie ma żadnego tokenu sesji. Publikacja
    # (/api/admin/desktop-updates/...) ma WŁASNY, osobny gate (require_admin /
    # nagłówek X-Admin-Token) — "public" tu oznacza tylko "pomiń system
    # Bearer/działów z tej warstwy", NIE "bez żadnej ochrony". Potwierdzone na
    # produkcji: oba te prefiksy dostawały 401 z tej warstwy PRZED dotarciem
    # do require_admin, więc auto-update (główna appka i kiosk rozbioru v10)
    # nigdy nie mógł zadziałać.
    "/api/desktop-updates",
    "/api/admin/desktop-updates",
)

# Endpointy dostępne każdemu zalogowanemu
ANY_PREFIXES = (
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/change-password",
    # Wspólne odczyty hali — używane przez kilka działów naraz (rozbiór,
    # mieszanie, produkcja), więc nie da się ich przypisać do jednego działu
    # przez sam prefiks ścieżki (np. production-sessions rozróżnia proces
    # dopiero po ?processType=, którego permission_for_path nie widzi).
    # Baza danych: 404/2xx per rekord to za mało uprawnień, więc nadal
    # wymagane jest bycie zalogowanym (nie "public").
    "/api/raw-batches",
    "/api/workers",
    "/api/production-sessions",
)

# Tylko admin (konta biura)
ADMIN_PREFIXES = ("/api/app-users", "/api/audit-log")

# Działy hali → prefiksy
DEPARTMENT_PREFIXES = {
    "rozbior": ("/api/deboning",),
    "produkcja": ("/api/mixing", "/api/seasoned_meat"),
    # `/api/finished-units` ma WŁASNĄ regułę niżej (dzielą je produkcja
    # i pakowanie). Nie wracać tu z wpisem `/api/finished_units` —
    # z podkreśleniem nigdy nie pasował do trasy i cicho nic nie robił.
    "pakowanie": ("/api/packaging",),
    "wydanie": ("/api/dispatches",),
}


def _matches(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def permission_for_path(path: str, method: str = "GET") -> str:
    for p in PUBLIC_PREFIXES:
        if _matches(path, p):
            return "public"
    for p in ANY_PREFIXES:
        if _matches(path, p):
            return "any"
    for p in ADMIN_PREFIXES:
        if _matches(path, p):
            return "admin"
    # Karton magazynowy: skan/odczyt = hala (pakowanie); tworzenie i ręczne dodanie
    # sztuk z magazynu = biuro (office ma nadzbiór, więc i tak ma dostęp do skanu).
    if path.startswith("/api/stock-cartons"):
        if method == "POST" and path == "/api/stock-cartons":
            return "office"
        if path.endswith("/add") and "/lines/" in path:
            return "office"
        return "pakowanie"
    # Palety: pakowanie sztuk = hala; skan na wyjazd / mroźnia = wydanie.
    if path.startswith("/api/pallets"):
        if path == "/api/pallets/scan" or path == "/api/pallets/in-cold-storage":
            return "wydanie"
        return "pakowanie"
    # Tary wózków rozbioru (ważenie RS232): panel hali tylko czyta listę,
    # edycja wyłącznie z biura (strona Ustawienia firmy).
    if _matches(path, "/api/deboning/cart-tares"):
        return "rozbior" if method == "GET" else "office"
    # Korekta wpisu z biura (pracownik/kg) ŚWIADOMIE omija blokadę
    # zatwierdzonej zmiany, więc wpuszczamy tu WYŁĄCZNIE biuro — operator
    # hali nie może przepisywać zatwierdzonych danych ani cudzego akordu.
    if path.startswith("/api/deboning/entries/") and path.endswith("/correct"):
        return "office"
    # Te same względy: przeniesienie wpisu na inną partię i dopisanie wpisu
    # wstecz omijają blokadę zatwierdzonej zmiany → wyłącznie biuro.
    if path.startswith("/api/deboning/entries/") and path.endswith("/change-batch"):
        return "office"
    if _matches(path, "/api/deboning/entries/office-add"):
        return "office"
    # Usunięcie wpisu z biura omija okno 15 minut, które pilnuje hali →
    # wyłącznie biuro. Zwykły DELETE (HMI, świeży wpis) zostaje przy „rozbior".
    if path.startswith("/api/deboning/entries/") and path.endswith("/office-delete"):
        return "office"
    # Usunięcie z HALI omija tylko okno 15 minut — zmiana zamknięta
    # i zatwierdzona blokuje dalej, więc operator nie sięgnie dnia domkniętego.
    # Operator musi móc skasować własną pomyłkę sprzed godziny bez biura.
    if path.startswith("/api/deboning/entries/") and path.endswith("/hall-delete"):
        return "rozbior"
    # Ważenie zbiorcze mięsa robi HALA: kiosk rozbioru zapisuje paletę i czyta
    # magazyn mięsa, żeby rozpisać jej skład na partie. Bez tego kiosk dostawał
    # „odmowa dostępu" przy druku etykiety mięsa (prod 2026-08-14) — uboczne
    # drukowały się dalej, bo ich etykieta nie rusza backendu.
    if _matches(path, "/api/meat-pallets"):
        return "rozbior"
    # Wzory podpisów: rysuje je HALA (menu serwisowe kiosku rozbioru pod
    # kodem 0099 — jedyny dotykowy ekran w zakładzie), a podgląd wzoru
    # potrzebny jest też biuru w dialogu podpisu. Reguła działowa daje jedno
    # i drugie, bo „office" ma nadzbiór uprawnień operatora.
    # SAMO złożenie podpisu zostaje przy domyślnym „office": dokument
    # podpisuje się z biura, kiosk tylko dostarcza wzór.
    if _matches(path, "/api/signature-samples"):
        return "rozbior"
    # Magazyn mięsa: hala tylko CZYTA loty (skład palety). Każda zmiana stanu
    # zostaje w biurze — kiosk nie ma po co ruszać kilogramów.
    if _matches(path, "/api/meat-stock"):
        return "rozbior" if method == "GET" else "office"
    # Kiosk produkcji pracuje na planie dnia: czyta go, dopisuje sztuki, zmienia
    # tuleję i zamyka zmianę. Układanie planu (utworzenie, edycja, kasowanie,
    # status) i POTWIERDZENIE dnia — czyli moment, w którym powstaje wyrób
    # gotowy — zostają w biurze. Bez tego rozróżnienia domyślne „office"
    # odcinałoby kiosk od wszystkiego i operator nie zapisałby ani jednej sztuki.
    if _matches(path, "/api/production-plans"):
        reszta = path[len("/api/production-plans"):].strip("/")
        if method == "GET":
            return "produkcja"
        if (reszta.endswith("/progress") or reszta.endswith("/packaging")
                or reszta.endswith("/move-pieces")):
            return "produkcja"
        if reszta.endswith("/tablet-finish") or reszta.endswith("/tablet-reopen"):
            return "produkcja"
        return "office"
    if _matches(path, "/api/production-day-materials") or _matches(path, "/api/production-wrapping"):
        return "produkcja"
    # Sztuki gotowe (QR): skanuje i podgląda PRODUKCJA (kebab schodzi z linii
    # na magazyn) oraz PAKOWANIE (kompletacja). Wygenerowanie sztuk i etykiet
    # zostaje w biurze — hala skanuje to, co dostała wydrukowane.
    #
    # Uwaga historyczna: reguła działowa miała tu `/api/finished_units`
    # z PODKREŚLENIEM, a trasa to `/api/finished-units` z myślnikiem, więc
    # nigdy się nie dopasowała i wszystko wpadało w domyślne „office".
    if _matches(path, "/api/finished-units"):
        if path.endswith("/from-plan-line"):
            return "office"
        return "produkcja|pakowanie"
    # Kartoteka opakowań: CZYTAĆ musi kilka działów naraz (kiosk produkcji
    # wybiera z niej tuleję pozycji), zmieniać — tylko pakowanie i biuro.
    if _matches(path, "/api/packaging"):
        return "any" if method == "GET" else "pakowanie"
    for dept, prefixes in DEPARTMENT_PREFIXES.items():
        for p in prefixes:
            if _matches(path, p):
                return dept
    return "office"  # default-deny: wymaga co najmniej biura


def can_access(subject: Optional[dict], required: str) -> bool:
    if required == "public":
        return True
    if subject is None:
        return False
    if required == "any":
        return True

    kind = subject.get("kind")
    role = subject.get("role")
    if kind == "office":
        if role == "admin":
            return True
        # office: wszystko poza kontami biura
        return required != "admin"

    # operator
    # „a|b" — ścieżka wspólna dla kilku działów (np. skan sztuki gotowej robi
    # produkcja I pakowanie). Wpuszczamy operatora z KTÓRYMKOLWIEK z nich;
    # „any" byłoby za szerokie, bo to zapis stanu, nie odczyt.
    wymagane = [r for r in required.split("|") if r]
    dzialy = set(subject.get("departments") or [])
    if wymagane and all(r in DEPARTMENT_PREFIXES for r in wymagane):
        return bool(dzialy.intersection(wymagane))
    return False
