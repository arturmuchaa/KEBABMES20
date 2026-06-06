import app.services.finished_goods_service as fg


def test_single_batch_keeps_bare_number():
    # 1 partia → 'ddmmrr <numer>' (bez prefiksu)
    out = fg._compute_kebab_batch_no("2026-06-06", ["326"])
    assert out == "060626 326"


def test_two_batches_get_ppp_not_pp(monkeypatch):
    # ≥2 partie zmieszane na produkcji → PPP (NIE PP)
    monkeypatch.setattr(fg, "next_seq", lambda key: 1)
    out = fg._compute_kebab_batch_no("2026-06-06", ["357", "358"])
    assert out == "060626 PPP1"
    assert out.split(" ")[1] == "PPP1"   # prefiks to PPP, nie PP


def test_two_batches_use_ppp_seq_counter(monkeypatch):
    # licznik musi być 'ppp_seq', nie 'pp_seq'
    seen = {}

    def fake_seq(key):
        seen["key"] = key
        return 3

    monkeypatch.setattr(fg, "next_seq", fake_seq)
    out = fg._compute_kebab_batch_no("2026-06-06", ["357", "358"])
    assert out == "060626 PPP3"
    assert seen["key"] == "ppp_seq"
