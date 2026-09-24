"""Rozliczenie dostawy — kartka, którą biuro wypisuje dziś długopisem.

Właściciel przysłał 24.09.2026 zdjęcie takiej kartki dla TRUVY z prośbą
„chciałbym coś bardziej profesjonalnego". Rachunki na niej zgadzały się
co do euro, więc to gotowa specyfikacja układu:

    KIRMIZI         30×25kg=750 + 80×20kg=1600 + 60×15kg=900
                    = 3250 kg × 3,20 € = 10 400 €
    KIRMIZI/FILET   30×30kg=900 + 60×25kg=1500 + 40×20kg=800
                    = 3200 kg × 3,40 € = 10 880 €
    BEYAZ           60×30kg=1800        = 1800 kg × 3,20 € =  5 760 €
                                          za dostawę        27 040 €
                                        + BORÇLAR           37 000 €
                                          RAZEM             64 040 €

Dwie rzeczy, których sama specyfikacja nie mówiła, a kartka rozstrzyga:

1. **Cena jest PER GRUPA** (3,20 / 3,40 / 3,20), nie jedna na dokument.
2. **Liczba sztuk i gramatura muszą zostać widoczne.** Klient sprawdza
   dostawę po pojemnikach, nie po kilogramach — scalona linia „3250 kg"
   bez rozbicia byłaby krokiem wstecz wobec kartki pisanej ręcznie.

Kartka opisuje CAŁĄ dostawę (8250 kg), także część, która poszła na fakturę
(3200 kg). Nie jest więc wydrukiem dokumentu WZ, bo ten opisuje resztę
(5050 kg) — źródłem jest cała dostawa.

Czyste funkcje, bez bazy: to jedyne liczby na tym papierze, których klient
nie sprawdzi inaczej niż kalkulatorem.
"""
from typing import Any, Dict, List


def grupy_dostawy(linie: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pozycje dostawy pogrupowane jak na kartce: po nazwie wyrobu, a w niej
    po gramaturze.

    Kolejność grup i gramatur jest KOLEJNOŚCIĄ WYSTĄPIENIA w dokumencie, nie
    alfabetyczna — biuro czyta ten papier obok dokumentu wydania i porównuje
    pozycja po pozycji.

    Ta sama gramatura z dwóch partii schodzi na dwóch wierszach dokumentu,
    ale dla klienta to jedna pozycja („40 × 25 kg"), więc sumujemy.
    """
    grupy: Dict[str, Dict[str, Any]] = {}
    for l in linie or []:
        nazwa = str(l.get("name") or "").strip()
        kg_szt = float(l.get("kg_per_unit") or 0)
        qty = int(l.get("qty") or 0)
        kg = float(l.get("total_kg") or 0) or (qty * kg_szt)

        g = grupy.setdefault(nazwa, {"nazwa": nazwa, "pozycje": {}, "kg": 0.0})
        p = g["pozycje"].setdefault(kg_szt, {"qty": 0, "kg_per_unit": kg_szt, "kg": 0.0})
        p["qty"] += qty
        p["kg"] = round(p["kg"] + kg, 3)
        g["kg"] = round(g["kg"] + kg, 3)

    return [{"nazwa": g["nazwa"], "kg": g["kg"], "pozycje": list(g["pozycje"].values())}
            for g in grupy.values()]


def podsumowanie_dostawy(linie: List[Dict[str, Any]],
                         ceny: Dict[str, float],
                         saldo_przed: float) -> Dict[str, Any]:
    """Cała kartka: grupy z wartościami, suma za dostawę, zaległość, razem.

    `ceny` to cena ZA KILOGRAM per grupa — biuro wpisuje ją na formularzu,
    tak jak dziś na kartce. Brak ceny zostawia wartość zerem zamiast NaN:
    kilogramy mają się liczyć, zanim ktokolwiek wpisze stawkę.

    `saldo_przed` to zaległość z poprzednich dostaw — linia `BORÇLAR`
    z oryginału (`borçlar` to po turecku „długi"). Jest UJEMNA, jak całe
    saldo w tym module, więc `razem` też wychodzi ujemne: tyle klient
    jest nam winien po tej dostawie.
    """
    grupy = grupy_dostawy(linie)
    for g in grupy:
        cena = float(ceny.get(g["nazwa"]) or 0)
        g["cena"] = cena
        g["wartosc"] = round(g["kg"] * cena, 2)

    za_dostawe = round(sum(g["wartosc"] for g in grupy), 2)
    return {
        "grupy": grupy,
        "kg_razem": round(sum(g["kg"] for g in grupy), 3),
        "za_dostawe": za_dostawe,
        "saldo_przed": round(float(saldo_przed or 0), 2),
        "razem": round(float(saldo_przed or 0) - za_dostawe, 2),
    }
