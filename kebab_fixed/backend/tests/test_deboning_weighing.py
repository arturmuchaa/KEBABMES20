"""Ważenie automatyczne RS232 — DTO + walidacja spójności netto (logika czysta, bez DB)."""
import pytest
from app.models.deboning import DeboningEntryCreate
from app.services.deboning_service import validate_weighing_consistency


def test_dto_przyjmuje_pola_wagi_camelcase():
    dto = DeboningEntryCreate(
        rawBatchId="b1", kgTaken=160, kgMeat=150.5,
        kgGross=170.0, tareCartKg=5.5, tareE2Kg=14.0, e2Count=7, weighMode="auto",
    )
    assert dto.kg_gross == 170.0
    assert dto.tare_cart_kg == 5.5
    assert dto.tare_e2_kg == 14.0
    assert dto.e2_count == 7
    assert dto.weigh_mode == "auto"


def test_dto_pola_wagi_opcjonalne():
    dto = DeboningEntryCreate(rawBatchId="b1", kgTaken=160, kgMeat=150.5)
    assert dto.kg_gross is None and dto.weigh_mode is None


def test_dto_odrzuca_zly_weigh_mode():
    with pytest.raises(Exception):
        DeboningEntryCreate(rawBatchId="b1", kgTaken=160, kgMeat=150.5, weighMode="magic")


def test_spojnosc_ok_przyklad_z_hali():
    # 170,0 brutto − wózek 5,5 − 7×E2 14,0 = 150,5 netto
    assert validate_weighing_consistency(170.0, 5.5, 14.0, 150.5) is None


def test_spojnosc_w_tolerancji_pol_kg():
    assert validate_weighing_consistency(170.0, 5.5, 14.0, 150.9) is None


def test_spojnosc_blad_poza_tolerancja():
    msg = validate_weighing_consistency(170.0, 5.5, 14.0, 140.0)
    assert msg is not None and "Niespójne" in msg


def test_spojnosc_brak_brutto_nie_waliduje():
    assert validate_weighing_consistency(None, None, None, 150.5) is None
