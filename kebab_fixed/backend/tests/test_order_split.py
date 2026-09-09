"""Podział zamówienia na część fakturowaną i część na WZ.

Właściciel (2026-09-09): „musimy zrobić tak, aby można było dzielić tak, jak
ja chcę — równo. Jeżeli chcę 8000 kg i 5005 kg, to musi się dać tak dzielić,
wtedy trzeba usunąć jakąś sztukę, tak aby trafić w ten podział".

Podział ma trafiać DOKŁADNIE, a nie tylko blisko.

Fix po review, runda 1 (2026-09-09): stara wersja zakładała bez sprawdzenia,
że wagi sztuk leżą na siatce 5 kg. Trzy testy niżej łapią to wprost: wagi
spoza siatki (żeby złapać wykładniczy czas starego `_osiagalne_sumy` i
niesprawdzony wynik drugiego dobicia), realny rozmiar z takimi wagami
(wydajność) i przypadek wymagający ruchu trzech sztuk (poprawność `_dobij`).
"""
import time

from app.services.order_split import podziel_pozycje


def _l(lid, qty, kg):
    return {"id": lid, "qty": qty, "kg_per_unit": kg}


#: Prawdziwe zamówienie YALCIN/Z/4/09/26 — 21 pozycji, 486 szt, 13 005 kg.
YALCIN = [
    _l("l0", 15, 50), _l("l1", 20, 40), _l("l2", 10, 35), _l("l3", 30, 30),
    _l("l4", 60, 25), _l("l5", 40, 20), _l("l6", 60, 15), _l("l7", 50, 10),
    _l("l8", 4, 60), _l("l9", 10, 35), _l("l10", 10, 30), _l("l11", 40, 40),
    _l("l12", 5, 35), _l("l13", 30, 30), _l("l14", 20, 25), _l("l15", 20, 20),
    _l("l16", 20, 15), _l("l17", 20, 10), _l("l18", 5, 80), _l("l19", 12, 70),
    _l("l20", 5, 60),
]


def test_trafia_CO_DO_KILOGRAMA_w_8000(db=None):
    """Przypadek wprost od właściciela: 8000 na fakturę, 5005 na WZ."""
    w = podziel_pozycje(YALCIN, 8000.0)
    assert w["trafiono"] is True
    assert w["kg_fv"] == 8000.0


def test_reszta_to_dokladnie_5005():
    w = podziel_pozycje(YALCIN, 8000.0)
    calosc = sum(l["qty"] * l["kg_per_unit"] for l in YALCIN)
    assert calosc - w["kg_fv"] == 5005.0


def test_trafia_w_okragle_cele():
    for cel in (6000.0, 7000.0, 9000.0, 10000.0):
        w = podziel_pozycje(YALCIN, cel)
        assert w["trafiono"] is True, cel
        assert w["kg_fv"] == cel


def test_cel_nieosiagalny_daje_najblizsza_sume_i_MOWI_o_tym():
    # Połowa nieparzystej sumy: 13 005 / 2 = 6502,5 kg — z całych sztuk nie ma
    # jak tego złożyć. Najbliżej 6500 kg.
    w = podziel_pozycje(YALCIN, 6502.5)
    assert w["trafiono"] is False
    assert w["kg_fv"] == 6500.0


def test_podzial_zostaje_rownomierny():
    """Dobicie do celu ma poprawiać punktowo, nie wywracać proporcji."""
    w = podziel_pozycje(YALCIN, 8000.0)
    qty = {l["id"]: l["qty"] for l in YALCIN}
    udzialy = [x["qty_invoice"] / qty[x["id"]] for x in w["lines"] if qty[x["id"]] >= 10]
    assert min(udzialy) > 0.45 and max(udzialy) < 0.80


def test_kazda_pozycja_jest_obecna_po_obu_stronach():
    w = podziel_pozycje([_l("a", 10, 50), _l("b", 10, 10)], 300.0)
    for x in w["lines"]:
        assert 0 < x["qty_invoice"] < 10, x


def test_polowa_dzieli_kazda_pozycje_na_pol():
    w = podziel_pozycje([_l("a", 10, 30), _l("b", 20, 25)], 400.0)
    assert [(x["id"], x["qty_invoice"]) for x in w["lines"]] == [("a", 5), ("b", 10)]


def test_sztuki_sa_calkowite_i_w_zakresie():
    w = podziel_pozycje(YALCIN, 8000.0)
    qty = {l["id"]: l["qty"] for l in YALCIN}
    for x in w["lines"]:
        assert isinstance(x["qty_invoice"], int)
        assert 0 <= x["qty_invoice"] <= qty[x["id"]]


def test_cel_zero_nie_daje_nic_na_fakture():
    w = podziel_pozycje([_l("a", 10, 30)], 0)
    assert w["kg_fv"] == 0 and w["lines"][0]["qty_invoice"] == 0


def test_cel_wiekszy_niz_zamowienie_bierze_calosc():
    w = podziel_pozycje([_l("a", 10, 30)], 99999)
    assert w["lines"][0]["qty_invoice"] == 10 and w["kg_fv"] == 300.0


def test_pozycja_bez_wagi_nie_wywraca_podzialu():
    w = podziel_pozycje([_l("a", 10, 30), _l("b", 5, 0)], 150.0)
    assert len(w["lines"]) == 2 and w["kg_fv"] == 150.0


def test_puste_zamowienie_daje_pusta_liste():
    w = podziel_pozycje([], 100.0)
    assert w["lines"] == [] and w["kg_fv"] == 0


def test_wagi_spoza_siatki_5kg_trafiaja_w_prawdziwa_najblizsza_sume():
    """Wagi 12,5 i 7,25 kg — poza siatką 5 kg. `trafiono=False` ma zwracać
    NAPRAWDĘ najbliższą osiągalną sumę, nie zgadywać. Liczymy ją tu brute
    force (wszystkie kombinacje sztuk z tego małego zestawu) niezależnie od
    implementacji, żeby test faktycznie sprawdzał wynik, a nie powtarzał
    kod produkcyjny."""
    linie = [_l("a", 3, 12.5), _l("b", 4, 7.25)]
    cel = 30.0

    najblizsza = None
    for qa in range(4):
        for qb in range(5):
            suma = round(qa * 12.5 + qb * 7.25, 4)
            klucz = (abs(suma - cel), suma)
            if najblizsza is None or klucz < (abs(najblizsza - cel), najblizsza):
                najblizsza = suma

    w = podziel_pozycje(linie, cel)
    assert w["trafiono"] is False
    assert w["kg_fv"] == najblizsza
    suma_z_linii = sum(x["qty_invoice"] * x["kg_per_unit"] for x in w["lines"])
    assert suma_z_linii == w["kg_fv"]


def test_wagi_spoza_siatki_wydajnosc_realnego_rozmiaru():
    """21 pozycji, do 60 sztuk każda, wagi PRZESUNIĘTE poza siatkę 5 kg
    (+0,3 kg) — cel dobrany tak, żeby wymusić ścieżkę „nieosiągalne z
    równomiernego punktu startowego" (bitset). Stary `_osiagalne_sumy` na
    takich wagach nie kończył się w rozsądnym czasie; bitset ma zejść z
    tego w sekundach, nie minutach."""
    linie = [_l(l["id"], l["qty"], l["kg_per_unit"] + 0.3) for l in YALCIN]
    calosc = sum(l["qty"] * l["kg_per_unit"] for l in linie)
    cel = calosc / 2 + 0.07

    start = time.perf_counter()
    w = podziel_pozycje(linie, cel)
    czas = time.perf_counter() - start

    assert czas < 2.0, f"podziel_pozycje trwało {czas:.2f} s (limit 2 s)"
    suma_z_linii = sum(x["qty_invoice"] * x["kg_per_unit"] for x in w["lines"])
    assert abs(suma_z_linii - w["kg_fv"]) < 1e-6
    qty = {l["id"]: l["qty"] for l in linie}
    for x in w["lines"]:
        assert 0 <= x["qty_invoice"] <= qty[x["id"]]


def test_ruch_trzech_sztuk_trafia_dokladnie():
    """Przypadek skonstruowany tak, że z równomiernego punktu startowego
    brakujące -5 kg NIE da się dobić żadnym ruchem 1 sztuki ani wymianą
    dwóch (sprawdzone niezależnie dla wag 17/2/6: zbiór osiągalnych delt
    1- i 2-sztukowych to {±2,±4,±6,±8,±11,±12,±15,±17,±19,±23,±34} — nie ma
    w nim -5) — trafia tylko ruch trzech sztuk: +2 sztuki wagi 6 kg,
    -1 sztuka wagi 17 kg (6+6-17=-5).

    Sprawdzamy to na dwóch poziomach: `_dobij` samo (żeby regresja w ruchach
    trzysztukowych faktycznie czerwoniła test, a nie chowała się za
    bitsetowym planem B z kroku 3) i `podziel_pozycje` (kontrakt publiczny)."""
    from app.services.order_split import _dobij, _rownomiernie

    linie = [_l("l0", 8, 17.0), _l("l1", 20, 2.0), _l("l2", 19, 6.0)]
    calosc = sum(l["qty"] * l["kg_per_unit"] for l in linie)

    stan = _rownomiernie(linie, 20.0, calosc)
    assert _dobij(stan, 20.0) is True, "_dobij powinno trafić ruchem trzech sztuk"
    assert sum(x["qty_invoice"] * x["kg_per_unit"] for x in stan) == 20.0

    w = podziel_pozycje(linie, 20.0)
    assert w["trafiono"] is True
    assert w["kg_fv"] == 20.0
