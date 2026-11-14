"""Chrome bez okna potrafi paść przy starcie (rc=-11, SIGSEGV) — jeden taki przypadek
psuł cały druk zbiorczy w module Dokumenty (14.11.2026). Generator ponawia próbę."""
import re
import subprocess

import pytest

from app.services import pdf_render


class _Proc:
    def __init__(self, rc):
        self.returncode, self.stderr = rc, b"crashpad: no stack mapping"


def _symuluj(monkeypatch, kody):
    wywolania = []

    def run(cmd, capture_output, timeout):
        rc = kody[len(wywolania)]
        wywolania.append(cmd)
        if rc == 0:
            out = next(a for a in cmd if a.startswith("--print-to-pdf=")).split("=", 1)[1]
            open(out, "wb").write(b"%PDF-1.4 ok")
        return _Proc(rc)
    monkeypatch.setattr(pdf_render, "find_chrome", lambda: "/usr/bin/chrome")
    monkeypatch.setattr(pdf_render.subprocess, "run", run)
    return wywolania


def test_awaria_chrome_przy_starcie_jest_ponawiana(monkeypatch):
    w = _symuluj(monkeypatch, [-11, 0])
    assert pdf_render.render_url_to_pdf("http://127.0.0.1/office/hdi/x/druk") == b"%PDF-1.4 ok"
    assert len(w) == 2
    # każda próba ma własny katalog profilu (zepsuty profil nie przechodzi dalej)
    ud = [next(a for a in c if a.startswith("--user-data-dir=")) for c in w]
    assert ud[0] != ud[1]


def test_trwala_awaria_konczy_sie_czytelnym_bledem(monkeypatch):
    w = _symuluj(monkeypatch, [-11, -11, -11])
    with pytest.raises(RuntimeError, match=r"rc=-11"):
        pdf_render.render_url_to_pdf("http://127.0.0.1/office/hdi/x/druk")
    assert len(w) == 3
