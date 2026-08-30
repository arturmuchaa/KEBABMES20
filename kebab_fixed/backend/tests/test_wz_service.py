"""VAT na pozycjach WZ (`build_wz_lines`).

Do 30.08.2026 WZ nie znało VAT-u w ogóle — kolumna „Wartość" była kwotą
netto i biuro dopisywało podatek ręcznie przy fakturze.
"""
from app.services.wz_service import build_wz_lines


class TestVatNaPozycji:
    """Stawka VAT jest cechą POZYCJI — jedno auto potrafi wieźć wyrób (5 %)
    i pozycję opodatkowaną inaczej. Do 30.08.2026 WZ nie znało VAT-u wcale."""

    def test_stawka_trafia_na_pozycje(self):
        lines, _ = build_wz_lines(
            [{"name": "KEBAB UDO", "qty": 2, "unit": "szt", "price": 3.0,
              "kg_per_unit": 20, "vat_rate": 5}], valued=True)
        assert lines[0]["vat_rate"] == 5.0

    def test_brak_stawki_to_zero_a_nie_None(self):
        lines, _ = build_wz_lines(
            [{"name": "Kości", "qty": 100, "unit": "kg", "price": 1.0}], valued=True)
        assert lines[0]["vat_rate"] == 0.0

    def test_smiec_w_stawce_nie_wywraca_dokumentu(self):
        lines, _ = build_wz_lines(
            [{"name": "Kości", "qty": 100, "unit": "kg", "price": 1.0,
              "vat_rate": "pięć"}], valued=True)
        assert lines[0]["vat_rate"] == 0.0

    def test_dokument_bez_cen_nie_niesie_stawki(self):
        # „Bez cen" to WZ na sam ruch towaru — VAT nie ma tam czego dotyczyć.
        lines, _ = build_wz_lines(
            [{"name": "Kości", "qty": 100, "unit": "kg", "vat_rate": 5}], valued=False)
        assert "vat_rate" not in lines[0]

    def test_stawka_nie_zmienia_wartosci_netto(self):
        lines, total = build_wz_lines(
            [{"name": "KEBAB UDO", "qty": 2, "unit": "szt", "price": 3.0,
              "kg_per_unit": 20, "vat_rate": 23}], valued=True)
        assert lines[0]["value"] == 120.0
        assert total == 120.0
