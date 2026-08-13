"""Numer partii przyprawionego niesie sufiks wsadu surowca („55U").

Zgłoszenie 13.08.2026: na planie produkcji partia pokazywała „55" zamiast
„55U". Masowanie brało `internal_batch_seq` (liczbę 55) zamiast
`internal_batch_no` („55U"). Przy zwykłych przyjęciach oba są identyczne,
więc błąd nie wychodził — ale przyjęcie NA USŁUGĘ ma własną serię z sufiksem
i taka partia wyglądała w systemie jak własna.
"""
from app.services.mixing_service import seasoned_batch_no_from_raw


def wsad(seq, numer=None):
    return {"internal_batch_seq": seq, "internal_batch_no": numer}


def test_partia_uslugowa_zachowuje_sufiks_u():
    assert seasoned_batch_no_from_raw([wsad(55, "55U")]) == "55U"


def test_zwykla_partia_bez_zmian():
    assert seasoned_batch_no_from_raw([wsad(470, "470")]) == "470"


def test_stary_rekord_bez_numeru_spada_na_seq():
    # dane sprzed kolumny internal_batch_no → numer z seq
    assert seasoned_batch_no_from_raw([wsad(471, None)]) == "471"
    assert seasoned_batch_no_from_raw([wsad(471, "")]) == "471"


def test_ten_sam_wsad_w_kilku_wierszach_to_wciaz_jedna_partia():
    # DISTINCT po (seq, no) potrafi zwrócić duplikat seq — nie ma z tego PP
    assert seasoned_batch_no_from_raw([wsad(55, "55U"), wsad(55, "55U")]) == "55U"


def test_kilka_wsadow_daje_partie_mieszana():
    # None = sygnał dla wołającego, żeby nadał wspólny numer PP{n}
    assert seasoned_batch_no_from_raw([wsad(55, "55U"), wsad(56, "56")]) is None


def test_brak_wsadow_daje_partie_mieszana():
    assert seasoned_batch_no_from_raw([]) is None
    assert seasoned_batch_no_from_raw([{"internal_batch_seq": None}]) is None
