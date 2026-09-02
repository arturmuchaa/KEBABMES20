"""WZ i HDI mają pokazywać odbiorcy TO SAMO.

Właściciel (2026-09-02): „na WZ taka sama zasada jak HDI — wybór receptura
i rodzaj, lub sam rodzaj, lub własna nazwa, żeby to współgrało z HDI 1:1;
oraz osobna pozycja na niestandardowe tuleje".

Do tej zmiany WZ brał nazwę na sztywno („receptura albo rodzaj") i nie znał
ani trybu z kartoteki odbiorcy, ani jego własnych nazw receptur. Odbiorca
dostawał dwa papiery z różnymi nazwami tego samego wyrobu.

Test czysty — buildery są funkcjami, baza niepotrzebna."""
from app.services.hdi_service import hdi_product_base
from app.services.wz_service import (build_goods_wz_lines, build_order_wz_lines,
                                     build_stock_wz_lines)

RODZAJ = "KEBAB MIX"
RECEPTURA = "KIRMIZI"
DOC_NAMES = {"pt1": RODZAJ}
WLASNE = {"r1": "BEYAZ"}


def _linia_planu(kg=30.0, tuleja="METAL 65CM", qty=10):
    return {"qty_done": qty, "recipe_id": "r1", "recipe_name": RECEPTURA,
            "product_type_id": "pt1", "product_type_name": RODZAJ,
            "packaging_name": tuleja, "kg_per_unit": kg,
            "batch_allocation": None, "seasoned_batch_no": "518"}


def _porcja(kg=30.0, tuleja="METAL 65CM", take=10):
    return {"take": take, "fg": {
        "id": "fg1", "recipe_id": "r1", "recipe_name": RECEPTURA,
        "product_type_id": "pt1", "product_type_name": RODZAJ,
        "packaging_name": tuleja, "kg_per_unit": kg, "batch_no": "010926 518"}}


def _sztuki(kg=30.0, tuleja="METAL 65CM", count=10):
    return [{"count": count, "goods": {
        "id": "fg1", "recipe_id": "r1", "recipe_name": RECEPTURA,
        "product_type_id": "pt1", "product_type_name": RODZAJ,
        "packaging_name": tuleja, "kg_per_unit": kg, "batch_no": "010926 518"}}]


# ── Tryb nazwy z kartoteki odbiorcy ─────────────────────────────────
def test_tryb_sam_rodzaj_dziala_na_wz():
    """POLAT chce sam rodzaj („nazwa receptury to nasza kuchnia")."""
    linie, _ = build_order_wz_lines([_linia_planu()], "type", {}, DOC_NAMES)
    assert linie[0]["name"] == "KEBAB MIX 30kg"


def test_tryb_sama_receptura_dziala_na_wz():
    linie, _ = build_order_wz_lines([_linia_planu()], "recipe", {}, DOC_NAMES)
    assert linie[0]["name"] == "KIRMIZI 30kg"


def test_tryb_domyslny_daje_rodzaj_i_recepture():
    linie, _ = build_order_wz_lines([_linia_planu()], "type_recipe", {}, DOC_NAMES)
    assert linie[0]["name"] == "KEBAB MIX KIRMIZI 30kg"


def test_wlasna_nazwa_receptury_odbiorcy_wchodzi_na_wz():
    """Odbiorca ma swoją nazwę receptury — WZ ma ją uszanować tak jak HDI."""
    linie, _ = build_order_wz_lines([_linia_planu()], "recipe", WLASNE, DOC_NAMES)
    assert linie[0]["name"] == "BEYAZ 30kg"


def test_wz_i_hdi_licza_nazwe_TA_SAMA_funkcja():
    """Zgodność 1:1 nie może polegać na przepisaniu reguły w dwóch miejscach."""
    linie, _ = build_order_wz_lines([_linia_planu()], "type_recipe", WLASNE, DOC_NAMES)
    baza_hdi = hdi_product_base(RODZAJ, "BEYAZ", "type_recipe")
    assert linie[0]["name"].startswith(baza_hdi)


# ── Tuleja niestandardowa ───────────────────────────────────────────
def test_tuleja_standardowa_bez_dopisku():
    linie, _ = build_order_wz_lines([_linia_planu(tuleja="METAL 65CM")], "type", {}, DOC_NAMES)
    assert "(65cm)" not in linie[0]["name"]


def test_tuleja_niestandardowa_z_dopiskiem():
    linie, _ = build_order_wz_lines([_linia_planu(tuleja="METAL 80CM")], "type", {}, DOC_NAMES)
    assert linie[0]["name"] == "KEBAB MIX 30kg (80cm)"


def test_ta_sama_waga_w_dwoch_tulejach_to_DWIE_pozycje():
    """SEDNO: KIRMIZI 30 kg jedzie u was i w 65 cm, i w 80 cm. Scalone
    w jedną pozycję odbiorca nie wie, co dostał."""
    linie, _ = build_order_wz_lines(
        [_linia_planu(tuleja="METAL 65CM", qty=14),
         _linia_planu(tuleja="METAL 80CM", qty=6)], "type", {}, DOC_NAMES)
    nazwy = sorted(l["name"] for l in linie)
    assert nazwy == ["KEBAB MIX 30kg", "KEBAB MIX 30kg (80cm)"]
    assert sorted(l["qty"] for l in linie) == [6, 14]


def test_regula_dziala_tez_na_pozycjach_z_magazynu():
    linie = build_stock_wz_lines([_porcja(tuleja="METAL 80CM")], "type", {}, DOC_NAMES)
    assert linie[0]["name"] == "KEBAB MIX 30kg (80cm)"


def test_regula_dziala_tez_na_wydaniu_po_sztukach():
    """Ten builder nie dokleja wagi — sprawdzamy sam trzon nazwy i tuleję."""
    linie = build_goods_wz_lines(_sztuki(tuleja="METAL 80CM"), "type", {}, DOC_NAMES)
    assert linie[0]["name"] == "KEBAB MIX (80cm)"


def test_bez_podanej_kartoteki_nazwa_nadal_powstaje():
    """Ścieżki wołające builder bez kontekstu odbiorcy (wydanie z palet)
    nie mogą zostać z pustą nazwą pozycji."""
    linie = build_goods_wz_lines(_sztuki())
    assert linie[0]["name"].strip()
