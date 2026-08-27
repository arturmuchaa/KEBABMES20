from app.services.production_events_service import changed_worker


def test_wskazuje_osobe_ktorej_przybylo_sztuk():
    stare = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 9}]
    nowe = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 11}]
    assert changed_worker(stare, nowe) == ("w1", "DAWID NOWAK")


def test_wskazuje_osobe_dopisana_do_pozycji():
    stare = [{"workerId": "w1", "workerName": "DAWID NOWAK", "pieces": 9}]
    nowe = stare + [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_wskazuje_osobe_ktorej_ubylo_sztuk():
    stare = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    nowe = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 1}]
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_zdjecie_calego_dorobku_usuwa_wpis_a_osobe_nadal_widac():
    # HMI kasuje wpis na zero, więc osoby nie ma już w nowej liście.
    stare = [{"workerId": "w2", "workerName": "DENYS KOVAL", "pieces": 3}]
    nowe = []
    assert changed_worker(stare, nowe) == ("w2", "DENYS KOVAL")


def test_zmiana_u_dwoch_osob_naraz_nie_wskazuje_nikogo():
    # Przepisanie sztuk (`move_line_pieces`) rusza dwie osoby — to nie jest
    # praca, tylko zmiana przypisania, i nie ma jej kto zaliczyć.
    stare = [{"workerId": "w1", "workerName": "A", "pieces": 9},
             {"workerId": "w2", "workerName": "B", "pieces": 3}]
    nowe = [{"workerId": "w1", "workerName": "A", "pieces": 7},
            {"workerId": "w2", "workerName": "B", "pieces": 5}]
    assert changed_worker(stare, nowe) == ("", "")


def test_brak_zmian_nie_wskazuje_nikogo():
    stare = [{"workerId": "w1", "workerName": "A", "pieces": 9}]
    assert changed_worker(stare, list(stare)) == ("", "")
