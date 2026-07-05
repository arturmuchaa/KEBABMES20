"""Twarde walidacje rozbioru na backendzie (audyt 2026-07-05).

Frontend blokował przeterminowane partie i zamknięte sesje, ale API
przyjmowało takie wpisy z innych klientów. Te czyste walidatory są
wpinane w create_deboning_entry / delete_deboning_entry.
"""
from datetime import date, datetime, timedelta, timezone

from app.services.deboning_service import (
    validate_edit_deltas,
    UNDO_MAX_AGE_MIN,
    validate_batch_expiry,
    validate_entry_undo,
    validate_session_writable,
)


class TestValidateBatchExpiry:
    def test_przeterminowana_wczoraj_blokuje(self):
        err = validate_batch_expiry("2026-07-04", today=date(2026, 7, 5))
        assert err and "HACCP" in err

    def test_termin_dzis_jeszcze_przechodzi(self):
        assert validate_batch_expiry("2026-07-05", today=date(2026, 7, 5)) is None

    def test_brak_terminu_nie_blokuje(self):
        assert validate_batch_expiry(None, today=date(2026, 7, 5)) is None

    def test_obiekt_date_tez_dziala(self):
        err = validate_batch_expiry(date(2026, 7, 1), today=date(2026, 7, 5))
        assert err


class TestValidateSessionWritable:
    def test_otwarta_przechodzi(self):
        assert validate_session_writable({"status": "open"}) is None

    def test_zamknieta_blokuje(self):
        err = validate_session_writable({"status": "closed"})
        assert err and "zamknięta" in err

    def test_zatwierdzona_blokuje(self):
        err = validate_session_writable({"status": "approved"})
        assert err and "zatwierdzona" in err

    def test_brak_sesji_blokuje(self):
        assert validate_session_writable(None)


class TestValidateEntryUndo:
    NOW = datetime(2026, 7, 5, 10, 0, 0, tzinfo=timezone.utc)

    def _entry(self, **kw):
        base = {
            "kg_backs": 0,
            "kg_bones": 0,
            "kg_meat": 150.5,
            "created_at": (self.NOW - timedelta(minutes=1)).isoformat(),
        }
        base.update(kw)
        return base

    def test_swiezy_wpis_do_cofniecia(self):
        assert validate_entry_undo(self._entry(), meat_available=150.5, now=self.NOW) is None

    def test_rozliczony_wpis_blokuje(self):
        err = validate_entry_undo(self._entry(kg_backs=20), meat_available=150.5, now=self.NOW)
        assert err and "rozliczony" in err

    def test_mieso_juz_zuzyte_blokuje(self):
        err = validate_entry_undo(self._entry(), meat_available=100.0, now=self.NOW)
        assert err and "zużyte" in err

    def test_za_stary_wpis_blokuje(self):
        old = self._entry(created_at=(self.NOW - timedelta(minutes=UNDO_MAX_AGE_MIN + 1)).isoformat())
        err = validate_entry_undo(old, meat_available=150.5, now=self.NOW)
        assert err and "minut" in err

    def test_brak_lotu_miesa_nie_blokuje(self):
        # lot mógł nie powstać (stare dane) — cofnięcie samego wpisu OK
        assert validate_entry_undo(self._entry(), meat_available=None, now=self.NOW) is None


class TestValidateEditDeltas:
    def test_bez_zmian_ok(self):
        assert validate_edit_deltas(0, 100, 0, 50) is None

    def test_zwiekszenie_taken_ponad_dostepne_blokuje(self):
        err = validate_edit_deltas(50, 30, 0, None)
        assert err and "dostępne" in err

    def test_zwiekszenie_taken_w_ramach_dostepnych_ok(self):
        assert validate_edit_deltas(20, 30, 0, None) is None

    def test_zmniejszenie_miesa_ponizej_zuzycia_blokuje(self):
        # lot ma już tylko 10 kg wolnych, a edycja zabiera 20 kg
        err = validate_edit_deltas(0, None, -20, 10)
        assert err and "zużyte" in err

    def test_zmniejszenie_miesa_w_ramach_wolnego_ok(self):
        assert validate_edit_deltas(0, None, -5, 10) is None

    def test_brak_lotu_nie_blokuje(self):
        assert validate_edit_deltas(0, None, -5, None) is None
