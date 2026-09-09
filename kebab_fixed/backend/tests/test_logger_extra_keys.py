"""Zarezerwowane klucze w ``logger.extra`` — strażnik.

Biuro (2026-09-09): „nie mogę dodać auta w zakładce Samochody, pokazuje się
failed to fetch". W logu:

    logger.info("vehicle.created", extra={"vehicle_id": ..., "name": dto.name})

`name` jest atrybutem `logging.LogRecord`. Przekazany w `extra=` powoduje
KeyError w `Logger.makeRecord` — czyli 500 z endpointu, który poza tym działa.

To był NAWRÓT: ta sama pułapka wywróciła już wcześniej inny zapis. Dlatego
strażnikiem jest skan całego kodu, nie test jednego serwisu — nowy log
z takim kluczem ma padać w CI, a nie u biura przy zapisie formularza.
"""
from __future__ import annotations

import logging
import pathlib
import re

import pytest

KATALOG_APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def _rezerwowane_tutaj() -> set[str]:
    """Nazwy, które `Logger.makeRecord` odrzuci w TYM środowisku.

    Wyliczone z prawdziwego `LogRecord`, nie spisane z palca: zestaw atrybutów
    zmienia się między wersjami Pythona (`taskName` doszło w 3.12), a test
    pilnujący wymyślonej listy sprawdzałby fikcję. `makeRecord` odrzuca
    dokładnie to, co już jest w `__dict__`, plus „message" i „asctime".
    """
    wzorzec = logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None)
    return set(wzorzec.__dict__) | {"message", "asctime"}


#: Do SKANU KODU bierzemy sumę: to, co odrzuca ten interpreter, plus nazwy
#: zarezerwowane w innych wersjach Pythona. Produkcja i CI nie muszą stać na
#: tej samej wersji, a log ma nie wybuchnąć na żadnej z nich.
REZERWOWANE_SKAN = _rezerwowane_tutaj() | {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "message", "module", "msecs", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "taskName", "thread", "threadName",
}


def _zajete_klucze(katalog: pathlib.Path | None = None) -> list[str]:
    """Miejsca, w których `extra=` używa zarezerwowanej nazwy."""
    katalog = katalog or KATALOG_APP
    znalezione: list[str] = []
    for plik in sorted(katalog.rglob("*.py")):
        tekst = plik.read_text(encoding="utf-8")
        for dopasowanie in re.finditer(r"extra\s*=\s*\{([^{}]*)\}", tekst, re.S):
            for klucz in re.findall(r"[\"'](\w+)[\"']\s*:", dopasowanie.group(1)):
                if klucz in REZERWOWANE_SKAN:
                    linia = tekst[: dopasowanie.start()].count("\n") + 1
                    znalezione.append(
                        f"{plik.relative_to(katalog.parent)}:{linia} — klucz '{klucz}'")
    return znalezione


def test_zaden_log_nie_uzywa_zarezerwowanej_nazwy():
    zajete = _zajete_klucze()
    assert not zajete, (
        "logger.extra= z zarezerwowaną nazwą LogRecord — KeyError i 500 "
        "przy każdym wywołaniu tego kodu:\n  " + "\n  ".join(zajete))


@pytest.mark.parametrize("klucz", sorted(_rezerwowane_tutaj()))
def test_zarezerwowana_nazwa_faktycznie_wywala_logger(klucz):
    """Dowód, że reguła nie jest przesądem: każdy z tych kluczy naprawdę psuje
    `logger.info` na TYM interpreterze.

    POZIOM MA ZNACZENIE i to jest sedno tej pułapki: `Logger.info` sprawdza
    najpierw `isEnabledFor`, więc przy domyślnym WARNING zakazany klucz nie
    dociera do `makeRecord` i nic nie wybucha. Dopiero produkcja, która loguje
    na INFO, dostaje KeyError — i 500 z endpointu, który „przecież działał".
    """
    logger = logging.getLogger(f"test.rezerwa.{klucz}")
    logger.setLevel(logging.INFO)
    with pytest.raises(KeyError):
        logger.info("proba", extra={klucz: "cokolwiek"})


def test_wlasny_klucz_przechodzi():
    """Kontrola przeciwna — zwykła nazwa ma działać."""
    logger = logging.getLogger("test.rezerwa.ok")
    logger.setLevel(logging.INFO)
    logger.info("proba", extra={"vehicle_name": "MAN"})


def test_skan_lapie_podsuniety_zly_log(tmp_path):
    """Sam skaner też musi działać — inaczej „zero trafień" nic nie znaczy."""
    (tmp_path / "app").mkdir()
    (tmp_path / "app" / "zly.py").write_text(
        'logger.info("cos", extra={"name": x})\n', encoding="utf-8")
    znalezione = _zajete_klucze(tmp_path / "app")
    assert any("klucz 'name'" in t for t in znalezione)
