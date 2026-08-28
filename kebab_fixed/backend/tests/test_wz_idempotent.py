from app.services.wz_service import should_reuse


def test_reuse_when_existing_and_source_id():
    # istniejący dokument dla źródła → użyj ponownie (nie nabijaj numeru)
    assert should_reuse(existing={"id": "x"}, source_id="disp1") is True


def test_no_reuse_when_no_existing():
    assert should_reuse(existing=None, source_id="disp1") is False


def test_no_reuse_for_manual_wz_without_source():
    # WZ ręczny (brak source_id) zawsze nowy, nawet gdy istnieje
    assert should_reuse(existing={"id": "x"}, source_id=None) is False
    assert should_reuse(existing={"id": "x"}, source_id="") is False


def test_no_reuse_when_existing_is_cancelled():
    """Anulowany WZ wyszedł z serii („ANUL WZ/…") i nic już nie wydaje.
    Ponowne wystawienie ma zrobić NOWY dokument, a nie odesłać do trupa.

    Zgłoszone 28.08.2026: po cofnięciu pomyłkowego wydania ISSA „Wystaw WZ"
    przerzucało biuro na anulowany dokument, więc zamówienia nie dało się już
    ani wydać, ani domknąć."""
    assert should_reuse(existing={"id": "x", "status": "anulowany"},
                        source_id="order1") is False


def test_reuse_when_existing_is_alive():
    for status in ("wstepny", "wystawiony", None):
        assert should_reuse(existing={"id": "x", "status": status},
                            source_id="order1") is True
