"""Tary wózków rozbioru — czysta normalizacja + RBAC ścieżki cart-tares.

Lista tar edytowana w biurze (PUT = office), czytana przez panel HMI
(GET = dział rozbior). Wartości: 0 < kg <= 50, zaokrąglane do 0,1,
bez duplikatów, zawsze posortowane rosnąco (wymóg UI: od najlżejszego).
"""
import pytest

from app.auth.permissions import permission_for_path
from app.services.settings_service import (
    DEFAULT_CART_TARES,
    normalize_cart_tares,
)


class TestNormalizeCartTares:
    def test_sortuje_rosnaco_i_zaokragla(self):
        assert normalize_cart_tares([7, 5.55, 6.5]) == [5.6, 6.5, 7.0]

    def test_usuwa_duplikaty_po_zaokragleniu(self):
        assert normalize_cart_tares([5.5, 5.54, 6.0]) == [5.5, 6.0]

    def test_akceptuje_stringi_liczbowe(self):
        assert normalize_cart_tares(["5,5", "6.0"]) == [5.5, 6.0]

    def test_odrzuca_wartosci_poza_zakresem(self):
        with pytest.raises(ValueError):
            normalize_cart_tares([5.5, 0])
        with pytest.raises(ValueError):
            normalize_cart_tares([5.5, 51])

    def test_odrzuca_nieliczby(self):
        with pytest.raises(ValueError):
            normalize_cart_tares([5.5, "wozek"])

    def test_odrzuca_pusta_liste(self):
        with pytest.raises(ValueError):
            normalize_cart_tares([])

    def test_default_to_cztery_wozki_z_hali(self):
        assert DEFAULT_CART_TARES == [5.5, 6.0, 6.5, 7.0]


class TestCartTaresRbac:
    def test_get_dostepny_dla_dzialu_rozbior(self):
        assert permission_for_path("/api/deboning/cart-tares", "GET") == "rozbior"

    def test_put_tylko_dla_biura(self):
        assert permission_for_path("/api/deboning/cart-tares", "PUT") == "office"

    def test_reszta_deboning_bez_zmian(self):
        assert permission_for_path("/api/deboning/entries", "POST") == "rozbior"
