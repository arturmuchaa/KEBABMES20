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
