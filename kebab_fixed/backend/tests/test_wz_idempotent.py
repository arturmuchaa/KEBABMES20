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
