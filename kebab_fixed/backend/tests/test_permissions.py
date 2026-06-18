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
    assert permission_for_path("/api/packaging/items") == "pakowanie"
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
