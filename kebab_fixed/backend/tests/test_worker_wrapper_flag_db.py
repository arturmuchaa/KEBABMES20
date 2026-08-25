"""Foliowczyk — znacznik w kartotece pracownika.

Przy linii stoi ~10 osób układających kebaby i 2 foliowczyków. Kiosk musi
wiedzieć, komu proponować wpis zafoliowanych kilogramów — inaczej okno
foliowania pokazuje całą zmianę i operator szuka dwóch nazwisk w dziesięciu.

Znacznik, nie osobna rola: foliowczyk zwykle też układa, a płaca sumuje
jedno i drugie.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest

from app.db import query_one
from app.models.workers import WorkerCreate, WorkerUpdate
from app.services.workers_service import create_worker, list_workers, update_worker


def _stworz(name="VLAD", **kw):
    return create_worker(WorkerCreate(name=name, role="WORKER_PRODUCTION", **kw))


def test_nowy_pracownik_domyslnie_nie_jest_foliowczykiem(db):
    w = _stworz()

    assert w["is_wrapper"] is False


def test_mozna_dodac_od_razu_jako_foliowczyka(db):
    w = _stworz(is_wrapper=True)

    assert w["is_wrapper"] is True


def test_mozna_zaznaczyc_i_odznaczyc_pozniej(db):
    w = _stworz()

    update_worker(w["id"], WorkerUpdate(is_wrapper=True))
    assert query_one("SELECT is_wrapper FROM workers WHERE id=%s", (w["id"],))["is_wrapper"] is True

    update_worker(w["id"], WorkerUpdate(is_wrapper=False))
    assert query_one("SELECT is_wrapper FROM workers WHERE id=%s", (w["id"],))["is_wrapper"] is False


def test_edycja_bez_pola_nie_kasuje_znacznika(db):
    """Zapis formularza bez tego pola (starszy klient) nie może odznaczyć."""
    w = _stworz(is_wrapper=True)

    update_worker(w["id"], WorkerUpdate(name="VLAD K."))

    assert query_one("SELECT is_wrapper FROM workers WHERE id=%s", (w["id"],))["is_wrapper"] is True


def test_lista_pracownikow_niesie_znacznik_do_kiosku(db):
    _stworz("VLAD", is_wrapper=True)
    _stworz("DAWID")

    po_nazwie = {w["name"]: w for w in list_workers()}
    assert po_nazwie["VLAD"]["is_wrapper"] is True
    assert po_nazwie["DAWID"]["is_wrapper"] is False
