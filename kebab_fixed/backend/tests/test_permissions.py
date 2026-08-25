from app.auth.permissions import permission_for_path, can_access


def test_public_paths():
    assert permission_for_path("/api/auth/login") == "public"
    assert permission_for_path("/api/auth/operators") == "public"
    assert permission_for_path("/api/health") == "public"


def test_any_authenticated_paths():
    assert permission_for_path("/api/auth/me") == "any"
    assert permission_for_path("/api/auth/logout") == "any"


def test_department_paths():
    assert permission_for_path("/api/deboning/sessions") == "rozbior"
    assert permission_for_path("/api/mixing/orders") == "produkcja"
    # Od 25.08.2026 sam ODCZYT kartoteki opakowań jest wspólny dla hali
    # (kiosk produkcji wybiera z niej tuleję) — zapis zostaje przy pakowaniu.
    assert permission_for_path("/api/packaging/items", "POST") == "pakowanie"
    assert permission_for_path("/api/dispatches/123") == "wydanie"


def test_admin_paths():
    assert permission_for_path("/api/app-users") == "admin"


def test_default_is_office():
    assert permission_for_path("/api/orders") == "office"
    assert permission_for_path("/api/wz/nowy") == "office"


def test_admin_can_access_everything():
    admin = {"kind": "office", "role": "admin", "departments": []}
    for perm in ("public", "any", "admin", "office", "rozbior"):
        assert can_access(admin, perm) is True


def test_office_access():
    office = {"kind": "office", "role": "office", "departments": []}
    assert can_access(office, "office") is True
    assert can_access(office, "rozbior") is True   # biuro widzi wszystko w aplikacji
    assert can_access(office, "any") is True
    assert can_access(office, "admin") is False     # konta biura tylko admin


def test_operator_access():
    op = {"kind": "operator", "role": None, "departments": ["rozbior"]}
    assert can_access(op, "rozbior") is True
    assert can_access(op, "pakowanie") is False
    assert can_access(op, "office") is False
    assert can_access(op, "admin") is False
    assert can_access(op, "any") is True


def test_public_always_accessible():
    assert can_access(None, "public") is True


def test_login_prefix_does_not_overmatch():
    # przyszly /api/auth/login-cokolwiek NIE moze byc automatycznie public
    assert permission_for_path("/api/auth/login-secret") == "office"


# ── Pakowanie hali: skan palet/kartonów (fix B) ────────────────────────
def test_hall_can_scan_stock_carton():
    assert permission_for_path("/api/stock-cartons/abc/scan", "POST") == "pakowanie"


def test_hall_can_list_open_cartons():
    assert permission_for_path("/api/stock-cartons/open", "GET") == "pakowanie"
    assert permission_for_path("/api/stock-cartons/abc/eligible-units", "GET") == "pakowanie"


def test_create_stock_carton_is_office():
    assert permission_for_path("/api/stock-cartons", "POST") == "office"


def test_manual_add_to_line_is_office():
    assert permission_for_path("/api/stock-cartons/c1/lines/l1/add", "POST") == "office"


def test_hall_can_pack_pallet():
    assert permission_for_path("/api/pallets/abc/pack", "POST") == "pakowanie"
    assert permission_for_path("/api/pallets/to-pack", "GET") == "pakowanie"


def test_pallet_loading_scan_is_wydanie():
    assert permission_for_path("/api/pallets/scan", "POST") == "wydanie"
    assert permission_for_path("/api/pallets/in-cold-storage", "GET") == "wydanie"


def test_carton_dispatch_is_wydanie():
    assert permission_for_path("/api/dispatches/abc/scan-carton", "POST") == "wydanie"


def test_korekta_wpisu_tylko_dla_biura():
    """/correct omija blokadę zatwierdzonej zmiany, więc operator hali NIE
    może go wywołać — inaczej przepisywałby zatwierdzone dane i cudzy akord."""
    p = permission_for_path("/api/deboning/entries/abc123/correct", "POST")
    assert p == "office"
    # operator działu rozbior — mimo że /api/deboning to jego dział
    operator = {"kind": "operator", "departments": ["rozbior"]}
    assert can_access(operator, p) is False
    # biuro przechodzi
    assert can_access({"kind": "office", "role": "office"}, p) is True
    assert can_access({"kind": "office", "role": "admin"}, p) is True
    # zwykłe ścieżki rozbioru dalej działają dla operatora
    assert permission_for_path("/api/deboning/entries/abc123", "PATCH") == "rozbior"


# Ważenie zbiorcze mięsa robi HALA (rozbiór), nie biuro: kiosk zapisuje paletę
# i czyta magazyn mięsa, żeby rozpisać skład partii. Bez tego kiosk dostawał
# „odmowa dostępu" przy druku etykiety mięsa (prod 2026-08-14) — uboczne
# drukowały się dalej, bo one nie ruszają backendu.
def test_palety_miesa_dostepne_dla_rozbioru():
    assert permission_for_path("/api/meat-pallets", "POST") == "rozbior"
    assert permission_for_path("/api/meat-pallets", "GET") == "rozbior"
    assert permission_for_path("/api/meat-pallets/PAL/14/08/26", "GET") == "rozbior"


def test_magazyn_miesa_do_odczytu_dla_hali_zapis_dla_biura():
    """Hala musi ZOBACZYĆ loty, żeby rozpisać skład palety; zmieniać ich nie może."""
    assert permission_for_path("/api/meat-stock", "GET") == "rozbior"
    assert permission_for_path("/api/meat-stock/abc", "GET") == "rozbior"
    assert permission_for_path("/api/meat-stock/abc", "POST") == "office"


def test_operator_rozbioru_wchodzi_na_palety_miesa():
    operator = {"kind": "operator", "departments": ["rozbior"]}
    assert can_access(operator, permission_for_path("/api/meat-pallets", "POST"))
    assert can_access(operator, permission_for_path("/api/meat-stock", "GET"))


def test_operator_pakowania_nie_wchodzi_na_palety_miesa():
    pakowacz = {"kind": "operator", "departments": ["pakowanie"]}
    assert not can_access(pakowacz, permission_for_path("/api/meat-pallets", "POST"))


# ── Kiosk produkcji (HMI produkcyjne) ────────────────────────────────────
# Stanowisko produkcyjne pracuje na planie dnia: czyta go, dopisuje sztuki,
# zmienia tuleję i zamyka zmianę. Domyślne „office" na /api/production-plans
# odcinałoby kiosk od WSZYSTKIEGO — operator nie zapisałby ani jednej sztuki.
def test_kiosk_produkcji_czyta_i_zapisuje_plan():
    assert permission_for_path("/api/production-plans", "GET") == "produkcja"
    assert permission_for_path("/api/production-plans/p1", "GET") == "produkcja"
    assert permission_for_path(
        "/api/production-plans/p1/lines/l1/progress", "PATCH") == "produkcja"
    assert permission_for_path(
        "/api/production-plans/p1/lines/l1/packaging", "PATCH") == "produkcja"
    assert permission_for_path(
        "/api/production-plans/p1/lines/l1/move-pieces", "POST") == "produkcja"
    assert permission_for_path("/api/production-plans/p1/tablet-finish", "POST") == "produkcja"
    assert permission_for_path("/api/production-plans/p1/tablet-reopen", "POST") == "produkcja"


def test_uklandanie_planu_zostaje_w_biurze():
    """Hala robi to, co zaplanowane — planu nie tworzy, nie kasuje i nie potwierdza."""
    assert permission_for_path("/api/production-plans", "POST") == "office"
    assert permission_for_path("/api/production-plans/p1", "PUT") == "office"
    assert permission_for_path("/api/production-plans/p1", "DELETE") == "office"
    assert permission_for_path("/api/production-plans/p1/status", "PATCH") == "office"
    assert permission_for_path("/api/production-plans/p1/office-confirm", "POST") == "office"
    operator = {"kind": "operator", "departments": ["produkcja"]}
    assert not can_access(operator, permission_for_path(
        "/api/production-plans/p1/office-confirm", "POST"))


def test_kiosk_produkcji_prowadzi_folie_i_foliowanie():
    assert permission_for_path("/api/production-day-materials", "GET") == "produkcja"
    assert permission_for_path("/api/production-day-materials/take", "POST") == "produkcja"
    assert permission_for_path("/api/production-day-materials/return", "POST") == "produkcja"
    assert permission_for_path("/api/production-wrapping", "GET") == "produkcja"
    assert permission_for_path("/api/production-wrapping", "POST") == "produkcja"


def test_lista_tulei_do_odczytu_dla_kazdej_hali():
    """Kiosk produkcji wybiera tuleję z kartoteki opakowań; zmieniać jej nie może."""
    assert permission_for_path("/api/packaging", "GET") == "any"
    assert permission_for_path("/api/packaging/all", "GET") == "any"
    assert permission_for_path("/api/packaging", "POST") == "pakowanie"
    assert permission_for_path("/api/packaging/abc/use", "PATCH") == "pakowanie"
    produkcja = {"kind": "operator", "departments": ["produkcja"]}
    assert can_access(produkcja, permission_for_path("/api/packaging", "GET"))
    assert not can_access(produkcja, permission_for_path("/api/packaging", "POST"))


def test_operator_produkcji_wchodzi_na_swoj_kiosk():
    operator = {"kind": "operator", "departments": ["produkcja"]}
    for sciezka, metoda in (
        ("/api/production-plans", "GET"),
        ("/api/production-plans/p1/lines/l1/progress", "PATCH"),
        ("/api/production-plans/p1/lines/l1/packaging", "PATCH"),
        ("/api/production-day-materials/take", "POST"),
        ("/api/production-wrapping", "POST"),
    ):
        assert can_access(operator, permission_for_path(sciezka, metoda)), sciezka
    # ...a operator innego działu nie
    pakowacz = {"kind": "operator", "departments": ["pakowanie"]}
    assert not can_access(pakowacz, permission_for_path(
        "/api/production-plans/p1/lines/l1/progress", "PATCH"))


# Sztuki gotowe skanują DWA działy: produkcja (kebab schodzi z linii i wchodzi
# na magazyn) oraz pakowanie (kompletacja). Reguła miała dotąd literówkę —
# `/api/finished_units` z podkreśleniem, gdy trasa to `/api/finished-units` —
# więc NIE działała wcale i wszystko wpadało w domyślne „office".
def test_skan_sztuki_dla_produkcji_i_pakowania():
    p = permission_for_path("/api/finished-units/scan-produced", "POST")
    assert can_access({"kind": "operator", "departments": ["produkcja"]}, p)
    assert can_access({"kind": "operator", "departments": ["pakowanie"]}, p)
    assert not can_access({"kind": "operator", "departments": ["rozbior"]}, p)
    assert can_access({"kind": "office", "role": "office"}, p)


def test_generowanie_sztuk_i_etykiety_zostaja_w_biurze():
    """Etykiety z QR drukuje biuro — hala tylko skanuje to, co dostała."""
    assert permission_for_path("/api/finished-units/from-plan-line", "POST") == "office"


def test_odczyt_sztuki_po_qr_dla_hali():
    p = permission_for_path("/api/finished-units/lookup", "GET")
    assert can_access({"kind": "operator", "departments": ["produkcja"]}, p)
    assert can_access({"kind": "operator", "departments": ["pakowanie"]}, p)


def test_usuniecie_wpisu_z_biura_tylko_dla_biura():
    """Okno 15 minut pilnuje hali; ścieżka biura je omija, więc hala tu nie wchodzi."""
    assert permission_for_path("/api/deboning/entries/abc/office-delete", "POST") == "office"
    # Zwykłe cofnięcie z HMI (świeży wpis) zostaje przy dziale rozbioru.
    assert permission_for_path("/api/deboning/entries/abc", "DELETE") == "rozbior"
    operator = {"kind": "operator", "departments": ["rozbior"]}
    assert not can_access(operator, permission_for_path(
        "/api/deboning/entries/abc/office-delete", "POST"))
