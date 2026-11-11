from datetime import date
from decimal import Decimal as D
from app.services.rozliczenia_ksiega import (brutto_wz, rozlicz_ksiege, stan_dokumentu,
                                             waluta_z_nip, na_dzien, grosze)

def _d(i, dzien, kwota, termin=None, otwarcie=False):
    return {"id": i, "data": date.fromisoformat(dzien), "numer": i, "kwota": D(str(kwota)),
            "termin": date.fromisoformat(termin or dzien), "otwarcie": otwarcie}
def _k(i, dzien, kwota, dok=None):
    return {"id": i, "data": date.fromisoformat(dzien), "kwota": D(str(kwota)), "dokument_id": dok}

FV = [_d("528", "2026-10-27", "14280.00", "2026-11-03"), _d("541", "2026-11-03", "12342.20", "2026-11-10"),
      _d("553", "2026-11-08", "10416.00", "2026-11-15")]

def test_brutto_5_procent_i_zero():
    assert brutto_wz([{"value": 1000, "vat_rate": 5}, {"value": 200.10, "vat_rate": 5}]) == D("1260.11")  # 1200.10 + 60.01 (60.005 → w górę)
    assert brutto_wz([{"value": 9569.75, "vat_rate": 0}]) == D("9569.75")
    assert brutto_wz([{"value": 100, "vat_rate": None}, {"value": 100, "vat_rate": 23}]) == D("223.00")
    assert brutto_wz([]) == D("0.00")

def test_wplata_od_najstarszych_ze_szkicu():
    w = rozlicz_ksiege(FV, [_k("p0", "2026-10-30", "7000"), _k("p1", "2026-11-09", "15000")])
    d = {x["id"]: x for x in w["dokumenty"]}
    assert (d["528"]["zostalo"], d["541"]["zostalo"], d["553"]["zostalo"]) == (D("0.00"), D("4622.20"), D("10416.00"))
    assert d["528"]["zamkniety"] == date(2026, 11, 9)
    assert w["do_zaplaty"] == D("15038.20") and w["nadplata"] == D("0.00") and w["saldo"] == D("-15038.20")

def test_nadplata_zostaje_i_zjada_pozniejszy_dokument():
    w = rozlicz_ksiege([_d("a", "2026-11-09", "100")], [_k("p", "2026-11-09", "350")])
    assert w["nadplata"] == D("250.00") and w["saldo"] == D("250.00")
    w = rozlicz_ksiege([_d("a", "2026-11-09", "100"), _d("b", "2026-11-20", "400")], [_k("p", "2026-11-09", "350")])
    assert {x["id"]: x["zostalo"] for x in w["dokumenty"]} == {"a": D("0.00"), "b": D("150.00")}
    assert w["nadplata"] == D("0.00")

def test_przypiecie_ma_pierwszenstwo_reszta_fifo():
    w = rozlicz_ksiege(FV, [_k("p", "2026-11-09", "11000", dok="553")])
    d = {x["id"]: x for x in w["dokumenty"]}
    assert d["553"]["zostalo"] == D("0.00") and d["528"]["zostalo"] == D("13696.00")  # 584 nadwyżki idzie na najstarszy

def test_przypiecie_do_nieistniejacego_dokumentu_idzie_fifo():
    w = rozlicz_ksiege(FV, [_k("p", "2026-11-09", "1000", dok="ANULOWANY")])
    assert w["dokumenty"][0]["zostalo"] == D("13280.00") and w["nadplata"] == D("0.00")

def test_otwarcie_splaca_sie_pierwsze_nawet_z_pozniejsza_data():
    docs = [_d("fv", "2026-11-09", "500"), _d("otw", "2026-11-09", "1000", otwarcie=True)]
    w = rozlicz_ksiege(docs, [_k("p", "2026-11-10", "1200")])
    assert {x["id"]: x["zostalo"] for x in w["dokumenty"]} == {"otw": D("0.00"), "fv": D("300.00")}

def test_kolejnosc_ta_sama_data_po_numerze_i_wynik_deterministyczny():
    docs = [_d("B", "2026-11-09", "100"), _d("A", "2026-11-09", "100")]
    w = rozlicz_ksiege(docs, [_k("p", "2026-11-09", "100")])
    assert [x["id"] for x in w["dokumenty"]] == ["A", "B"] and w["dokumenty"][0]["zostalo"] == D("0.00")

def test_stany():
    w = rozlicz_ksiege(FV, [_k("p0", "2026-10-30", "7000")])
    d = {x["id"]: x for x in w["dokumenty"]}
    dzis = date(2026, 11, 9)
    assert stan_dokumentu(d["528"], dzis) == {"kod": "po_terminie", "dni": 6, "czesciowo": True}
    assert stan_dokumentu(d["541"], dzis) == {"kod": "termin_jutro", "dni": 1, "czesciowo": False}
    assert stan_dokumentu(d["553"], dzis) == {"kod": "w_terminie", "dni": 6, "czesciowo": False}
    assert stan_dokumentu(d["541"], date(2026, 11, 10))["kod"] == "termin_dzis"
    z = rozlicz_ksiege([FV[0]], [_k("p", "2026-11-05", "14280")])["dokumenty"][0]
    assert stan_dokumentu(z, dzis) == {"kod": "zaplacony", "dni": 9, "czesciowo": False}

def test_na_dzien_obcina_przyszlosc():
    docs, kred = na_dzien(FV, [_k("p", "2026-11-09", "1")], date(2026, 11, 5))
    assert [x["id"] for x in docs] == ["528", "541"] and kred == []

def test_waluta_z_nip():
    assert waluta_z_nip("HU25341187") == "EUR" and waluta_z_nip("PL5252525252") == "PLN"
    assert waluta_z_nip("525-25-25-252") == "PLN" and waluta_z_nip(None) == "PLN"
    assert grosze(None) == D("0.00") and grosze(2.675) == D("2.68")
