"""Endpointy kart HACCP — arkusz kontroli i kontrola temperatury.

Render do PDF podmieniamy: test pilnuje URL-a i nazwy pliku, a nie tego,
czy na maszynie CI stoi Chrome.
"""
import app.routes.haccp_forms as hf


def _capture(monkeypatch) -> list[str]:
    """Podmienia render na atrapę; zwraca listę URL-i, o które poproszono."""
    seen: list[str] = []

    def fake_render(url: str, timeout: int = 45) -> bytes:
        seen.append(url)
        return b"%PDF-1.4 fake"

    monkeypatch.setattr(hf, "render_url_to_pdf", fake_render)
    return seen


def test_arkusz_renderuje_wskazany_dzien(monkeypatch):
    seen = _capture(monkeypatch)
    resp = hf.sanitary_check_pdf(data="2026-08-05")

    assert "/office/arkusz-kontroli/druk" in seen[0]
    assert "data=2026-08-05" in seen[0]
    # pdf=1 MUSI być — bez tego strona sama otwiera okno druku i render wisi
    assert "pdf=1" in seen[0]
    assert "Arkusz-kontroli_2026-08-05.pdf" in resp.headers["Content-Disposition"]
    assert resp.media_type == "application/pdf"


def test_temperatura_normalizuje_do_poniedzialku(monkeypatch):
    seen = _capture(monkeypatch)
    # środa 5.08.2026 należy do tygodnia zaczętego 3.08 (poniedziałek)
    resp = hf.temperature_log_pdf(od="2026-08-05")

    assert "od=2026-08-03" in seen[0]
    assert "pdf=1" in seen[0]
    # nazwa pliku niesie cały zakres — sam poniedziałek mylił przy kartach
    # numerowanych miesiącem niedzieli (01/08/2026 zaczyna się 27.07)
    assert "Kontrola-temperatury_2026-08-03_2026-08-09.pdf" in resp.headers["Content-Disposition"]


def test_temperatura_ten_sam_tydzien_daje_ten_sam_plik(monkeypatch):
    seen = _capture(monkeypatch)
    for day in ("2026-08-03", "2026-08-06", "2026-08-09"):  # pon, czw, ndz
        hf.temperature_log_pdf(od=day)
    assert seen[0] == seen[1] == seen[2]


def test_zla_data_to_422(monkeypatch):
    _capture(monkeypatch)
    for bad in ("05.08.2026", "2026-13-01", "wczoraj", ""):
        try:
            hf.sanitary_check_pdf(data=bad)
        except Exception as exc:  # HTTPException
            assert getattr(exc, "status_code", None) == 422
        else:
            raise AssertionError(f"{bad!r} powinno zostać odrzucone")


def test_blad_renderu_to_500(monkeypatch):
    def boom(url: str, timeout: int = 45) -> bytes:
        raise RuntimeError("Brak Chrome/Chromium na serwerze")

    monkeypatch.setattr(hf, "render_url_to_pdf", boom)
    try:
        hf.temperature_log_pdf(od="2026-08-03")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 500
    else:
        raise AssertionError("Błąd renderu powinien dać 500")
