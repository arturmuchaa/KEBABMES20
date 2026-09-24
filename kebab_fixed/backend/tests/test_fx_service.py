"""Kurs EUR do raportu zarządczego — NBP tabela A.

Raport pokazuje koszt 1 kg mięsa też w euro (część odbiorców rozlicza się
w EUR). Kurs MUSI być z konkretnego dnia i ten dzień ma być wydrukowany
na dokumencie — inaczej dwie osoby liczące „to samo" dostają różne kwoty
i nikt nie wie, która ma rację.

NBP nie publikuje w weekendy i święta, więc bierzemy ostatnią tabelę NIE
PÓŹNIEJSZĄ niż zadany dzień. Gdy API nie odpowiada, zwracamy None —
raport wydrukuje same złotówki. Zmyślony kurs byłby gorszy niż jego brak.

Testy czyste (bez sieci) — podmieniamy warstwę pobrania."""
import json
from datetime import date

import pytest

from app.services import fx_service


@pytest.fixture(autouse=True)
def _clear_cache():
    fx_service._CACHE.clear()
    yield
    fx_service._CACHE.clear()


def _payload(rates):
    return json.dumps({"table": "A", "currency": "euro", "code": "EUR", "rates": rates}).encode()


def test_bierze_ostatni_kurs_nie_pozniejszy_niz_zadany_dzien(monkeypatch):
    monkeypatch.setattr(fx_service, "_fetch", lambda url: _payload([
        {"no": "139/A/NBP/2026", "effectiveDate": "2026-07-27", "mid": 4.3139},
        {"no": "140/A/NBP/2026", "effectiveDate": "2026-07-28", "mid": 4.3242},
    ]))
    assert fx_service.nbp_eur_rate("2026-07-28") == {
        "rate": 4.3242, "date": "2026-07-28", "table": "A"}


def test_weekend_bierze_kurs_z_ostatniego_dnia_roboczego(monkeypatch):
    """31.07 wypada w niedzielę → obowiązuje tabela z piątku."""
    monkeypatch.setattr(fx_service, "_fetch", lambda url: _payload([
        {"no": "146/A/NBP/2026", "effectiveDate": "2026-07-30", "mid": 4.3300},
    ]))
    r = fx_service.nbp_eur_rate("2026-08-02")
    assert r["date"] == "2026-07-30"
    assert r["rate"] == 4.33


def test_data_z_przyszlosci_jest_przycinana_do_dzis(monkeypatch):
    """Raport za lipiec drukowany 28.07 ma `to`=31.07. NBP odpowiada 400 na
    zakres sięgający w przyszłość — bez przycięcia kurs cicho znikał
    z gotowego dokumentu (prod 2026-07-28)."""
    seen = []

    def spy(url):
        seen.append(url)
        return _payload([{"no": "144/A/NBP/2026", "effectiveDate": "2026-07-28", "mid": 4.3242}])

    monkeypatch.setattr(fx_service, "_fetch", spy)
    monkeypatch.setattr(fx_service, "_today", lambda: date(2026, 7, 28))
    r = fx_service.nbp_eur_rate("2026-07-31")
    assert r is not None and r["date"] == "2026-07-28"
    assert "2026-07-31" not in seen[0], "zapytanie poszło z datą z przyszłości"
    assert "2026-07-28" in seen[0]


def test_brak_odpowiedzi_nbp_daje_None_a_nie_zmyslony_kurs(monkeypatch):
    def boom(url):
        raise OSError("NBP nieosiągalne")
    monkeypatch.setattr(fx_service, "_fetch", boom)
    assert fx_service.nbp_eur_rate("2026-07-28") is None


def test_pusta_lista_kursow_daje_None(monkeypatch):
    monkeypatch.setattr(fx_service, "_fetch", lambda url: _payload([]))
    assert fx_service.nbp_eur_rate("2026-07-28") is None


def test_smiec_w_odpowiedzi_nie_wywala_raportu(monkeypatch):
    monkeypatch.setattr(fx_service, "_fetch", lambda url: "<html>błąd</html>".encode())
    assert fx_service.nbp_eur_rate("2026-07-28") is None


def test_kurs_jest_cache_owany_zeby_nie_bic_w_nbp_przy_kazdym_wydruku(monkeypatch):
    calls = []

    def counting(url):
        calls.append(url)
        return _payload([{"no": "144/A/NBP/2026", "effectiveDate": "2026-07-28", "mid": 4.3242}])

    monkeypatch.setattr(fx_service, "_fetch", counting)
    fx_service.nbp_eur_rate("2026-07-28")
    fx_service.nbp_eur_rate("2026-07-28")
    assert len(calls) == 1


def test_rozne_dni_to_rozne_wpisy_w_cache(monkeypatch):
    calls = []

    def counting(url):
        calls.append(url)
        return _payload([{"no": "1/A/NBP/2026", "effectiveDate": "2026-06-30", "mid": 4.25}])

    monkeypatch.setattr(fx_service, "_fetch", counting)
    fx_service.nbp_eur_rate("2026-06-30")
    fx_service.nbp_eur_rate("2026-07-28")
    assert len(calls) == 2


# ─── Nieudane pobranie nie może blokować na pół dnia (24.09.2026) ───────
#
# Właściciel: „kursy z NBP niech pobiera, ale to mi coś nie zawsze działa —
# np. jak wystawiam WZ w euro, czasem pobiera, a czasem muszę ręcznie
# wpisywać".
#
# Pułapka w cache: wynik `None` (awaria sieci) zapisywał się z tym samym
# TTL co poprawny kurs — 6 GODZIN. Jedna chwilowa usterka i przez pół dnia
# biuro wpisuje kurs ręcznie, choć NBP dawno odpowiada.

def test_udany_kurs_jest_cache_owany(monkeypatch):
    """Zachowanie wsteczne: kurs dnia się nie zmienia, więc drugi raz
    nie pytamy sieci."""
    wolania = []

    def _raz(url):
        wolania.append(url)
        return _payload([{"effectiveDate": "2026-07-28", "mid": 4.3242}])

    monkeypatch.setattr(fx_service, "_fetch", _raz)
    monkeypatch.setattr(fx_service, "_today", lambda: date(2026, 7, 28))
    fx_service.nbp_eur_rate("2026-07-28")
    fx_service.nbp_eur_rate("2026-07-28")

    assert len(wolania) == 1


def test_PORAZKA_nie_blokuje_na_pol_dnia(monkeypatch):
    """SEDNO zgłoszenia. Awaria ma znikać po MINUCIE, nie po sześciu
    godzinach — biuro wystawia WZ w euro wiele razy dziennie."""
    stan = {"padaj": True, "wolania": 0, "zegar": 1000.0}

    def _czasem(url):
        stan["wolania"] += 1
        if stan["padaj"]:
            raise OSError("chwilowy brak sieci")
        return _payload([{"effectiveDate": "2026-07-28", "mid": 4.3242}])

    monkeypatch.setattr(fx_service, "_fetch", _czasem)
    monkeypatch.setattr(fx_service, "_today", lambda: date(2026, 7, 28))
    monkeypatch.setattr(fx_service, "_teraz", lambda: stan["zegar"])

    assert fx_service.nbp_eur_rate("2026-07-28") is None

    stan["padaj"] = False
    stan["zegar"] += fx_service._TTL_BLAD_S + 1

    assert fx_service.nbp_eur_rate("2026-07-28") == {
        "rate": 4.3242, "date": "2026-07-28", "table": "A"}
    assert stan["wolania"] == 2


def test_udany_kurs_trzyma_sie_dluzej_niz_porazka(monkeypatch):
    """Dwa różne okna życia w cache — to jest cała istota poprawki."""
    assert fx_service._TTL_BLAD_S < fx_service._TTL_S


def test_porazka_chroni_przed_mlynkiem_zapytan(monkeypatch):
    """Ale nie rezygnujemy z hamulca całkiem: seria wejść w tej samej chwili
    nie może zamienić awarii NBP w pętlę zapytań z naszego serwera."""
    stan = {"wolania": 0}

    def _pada(url):
        stan["wolania"] += 1
        raise OSError("brak sieci")

    monkeypatch.setattr(fx_service, "_fetch", _pada)
    monkeypatch.setattr(fx_service, "_today", lambda: date(2026, 7, 28))
    monkeypatch.setattr(fx_service, "_teraz", lambda: 1000.0)

    for _ in range(5):
        assert fx_service.nbp_eur_rate("2026-07-28") is None

    assert stan["wolania"] == 1
