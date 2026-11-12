"""Arytmetyka księgi rozrachunków z odbiorcą (bez bazy danych).

Znak: minus = klient winien, plus = nadpłata. ``saldo = nadplata − do_zaplaty``.
Wszystkie salda w całym module liczone są wyłącznie tutaj.
"""
from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable, Optional

_GROSZ = Decimal("0.01")
_ZERO = Decimal("0.00")
_GRAM = Decimal("0.001")
_ZERO_KG = Decimal("0.000")


def grosze(x: Any) -> Decimal:
    """Kwantyzacja do 0,01 (ROUND_HALF_UP); przyjmuje float/str/Decimal/None."""
    if x is None or x == "":
        return _ZERO
    if not isinstance(x, Decimal):
        x = Decimal(str(x))
    return x.quantize(_GROSZ, rounding=ROUND_HALF_UP)


def brutto_wz(lines: Iterable[dict]) -> Decimal:
    """Brutto WZ z pozycji: netto per stawka VAT, VAT per stawka, suma brutto.

    Port ``wzVat.ts::podsumowanieVat`` (zaokrąglanie per stawka, nie per pozycja).
    """
    wg_stawki: dict[Decimal, Decimal] = {}
    for l in lines:
        stawka = Decimal(str(l.get("vat_rate") or 0))
        wartosc = Decimal(str(l.get("value") or 0))
        wg_stawki[stawka] = wg_stawki.get(stawka, Decimal(0)) + wartosc
    suma = _ZERO
    for stawka, netto in wg_stawki.items():
        n = grosze(netto)
        v = grosze(n * stawka / 100)
        suma += n + v
    return grosze(suma)


def kilogramy(x: Any) -> Decimal:
    """Kwantyzacja kg do 0,001 (ROUND_HALF_UP); None/pusty → 0,000."""
    if x is None or x == "":
        return _ZERO_KG
    if not isinstance(x, Decimal):
        x = Decimal(str(x))
    return x.quantize(_GRAM, rounding=ROUND_HALF_UP)


def kg_wz(lines: Iterable[dict]) -> Decimal:
    """Kilogramy WZ z pozycji: `total_kg` pozycji (sztuki z gramaturą, pozycja
    zbiorcza), a gdy go nie ma — `qty` pozycji w jednostce kg. Sztuki bez
    gramatury nie mają wagi. Przy podziale wysyłki WZ niesie tylko swoją część,
    więc kg części fakturowanej tu nie wchodzą."""
    suma = Decimal(0)
    for l in lines or []:
        total = Decimal(str(l.get("total_kg") or 0))
        if total > 0:
            suma += total
        elif (l.get("unit") or "") == "kg":
            suma += Decimal(str(l.get("qty") or 0))
    return kilogramy(suma)


def faktura_bez_kwoty(dok: dict) -> bool:
    """FV z papierów kursu, której kwoty biuro jeszcze nie wpisało
    (`stan_zrodla='czeka_na_kwote'` albo kwota NULL)."""
    return dok["ksiega"] == "fv" and (dok.get("stan_zrodla") == "czeka_na_kwote"
                                      or dok.get("kwota") is None)


def obrot_okresu(dokumenty: Iterable[dict], waluta: str, od: date,
                 do: Optional[date]) -> dict:
    """Obrót i sprzedane kg klienta za okres [od, do] (`do` None = bez końca).

    Obrót = suma brutto dokumentów liczonych (aktywne, w walucie kontrahenta,
    bez WZ „nie licz”), z datą w okresie — korekty ujemne odejmują. Kg = kg tych
    samych dokumentów plus kg faktur bez kwoty (towar wyjechał). Saldo otwarcia
    nie jest dokumentem, więc nie wchodzi nigdzie. `fv_bez_kwoty` — liczba
    faktur czekających na kwotę, bez względu na okres.
    Wejście: wiersze `rozl_dokumenty` (nieusunięte, od daty startu).
    """
    obrot, kg, bez_kwoty = _ZERO, _ZERO_KG, 0
    for r in dokumenty:
        if r.get("nie_licz"):
            continue
        brak_kwoty = faktura_bez_kwoty(r)
        if brak_kwoty:
            bez_kwoty += 1
        if r["data_dok"] < od or (do is not None and r["data_dok"] > do):
            continue
        if brak_kwoty:
            kg += kilogramy(r.get("kg"))
            continue
        if r["stan_zrodla"] != "aktywny" or r["waluta"] != waluta:
            continue
        obrot += grosze(r["kwota"])
        kg += kilogramy(r.get("kg"))
    return {"obrot": obrot, "kg": kg, "fv_bez_kwoty": bez_kwoty}


def ma_vat(lines: Iterable[dict]) -> bool:
    """Czy jakakolwiek pozycja ma stawkę VAT > 0."""
    return any(Decimal(str(l.get("vat_rate") or 0)) > 0 for l in lines)


def nip_krajowy(nip: str | None) -> bool:
    """Czy NIP jest polski (port ``wzVat.ts::nipKrajowy``). Brak NIP = krajowy."""
    czysty = "".join(str(nip or "").split()).replace("-", "").upper()
    if not czysty:
        return True
    if czysty.startswith("PL"):
        return True
    return not (len(czysty) >= 2 and czysty[:2].isalpha() and czysty[:2].isascii())


def waluta_z_nip(nip: str | None) -> str:
    """PLN dla kontrahenta krajowego, EUR dla zagranicznego."""
    return "PLN" if nip_krajowy(nip) else "EUR"


def rozlicz_ksiege(dokumenty: list[dict], kredyty: list[dict]) -> dict:
    """Rozlicza kredyty (wpłaty) z dokumentami od najstarszych.

    Kolejność dokumentów: ``(not otwarcie, data, numer, id)``; kredytów: ``(data, id)``.
    Przebieg 1: kredyt przypięty do istniejącego dokumentu pokrywa go w pierwszej
    kolejności. Przebieg 2: reszty kredytów (FIFO, bez względu na daty) pokrywają
    dokumenty w kolejności. Nieprzydzielona reszta to nadpłata.
    """
    docs = [
        {**d, "zaplacono": _ZERO, "zostalo": grosze(d["kwota"]), "zamkniety": None, "pokrycie": []}
        for d in sorted(dokumenty, key=lambda d: (not d.get("otwarcie", False), d["data"], str(d["numer"]), str(d["id"])))
    ]
    kreds = [
        {**k, "przydzialy": [], "reszta": grosze(k["kwota"])}
        for k in sorted(kredyty, key=lambda k: (k["data"], str(k["id"])))
    ]
    po_id = {d["id"]: d for d in docs}

    def przydziel(k: dict, d: dict) -> None:
        kwota = min(k["reszta"], d["zostalo"])
        if kwota <= 0:
            return
        k["reszta"] -= kwota
        d["zostalo"] -= kwota
        d["zaplacono"] += kwota
        k["przydzialy"].append({"dokument_id": d["id"], "kwota": kwota})
        d["pokrycie"].append({"kredyt_id": k["id"], "kwota": kwota})
        d["_data_kredytu"] = max(d.get("_data_kredytu", k["data"]), k["data"])

    for k in kreds:
        d = po_id.get(k.get("dokument_id"))
        if d is not None:
            przydziel(k, d)

    i = 0
    for k in kreds:
        while k["reszta"] > 0 and i < len(docs):
            if docs[i]["zostalo"] <= 0:
                i += 1
                continue
            przydziel(k, docs[i])

    for d in docs:
        data_kredytu = d.pop("_data_kredytu", None)
        if d["zostalo"] == 0 and data_kredytu is not None:
            d["zamkniety"] = max(d["data"], data_kredytu)
        elif d["zostalo"] == 0:
            d["zamkniety"] = d["data"]  # dokument o kwocie 0

    do_zaplaty = sum((d["zostalo"] for d in docs), _ZERO)
    nadplata = sum((k["reszta"] for k in kreds), _ZERO)
    return {"dokumenty": docs, "kredyty": kreds, "do_zaplaty": do_zaplaty,
            "nadplata": nadplata, "saldo": nadplata - do_zaplaty}


def stan_dokumentu(dok: dict, dzis: date) -> dict:
    """Stan dokumentu z wyniku ``rozlicz_ksiege`` na dzień ``dzis``."""
    if dok["zostalo"] <= 0:
        return {"kod": "zaplacony", "dni": (dok["zamkniety"] - dok["data"]).days, "czesciowo": False}
    czesciowo = dok["zaplacono"] > 0
    do_terminu = (dok["termin"] - dzis).days
    if do_terminu < 0:
        return {"kod": "po_terminie", "dni": -do_terminu, "czesciowo": czesciowo}
    if do_terminu == 0:
        return {"kod": "termin_dzis", "dni": 0, "czesciowo": czesciowo}
    if do_terminu == 1:
        return {"kod": "termin_jutro", "dni": 1, "czesciowo": czesciowo}
    return {"kod": "w_terminie", "dni": do_terminu, "czesciowo": czesciowo}


def na_dzien(dokumenty: list[dict], kredyty: list[dict], dzien: date) -> tuple[list, list]:
    """Odfiltrowuje pozycje z datą późniejszą niż ``dzien``."""
    return ([d for d in dokumenty if d["data"] <= dzien],
            [k for k in kredyty if k["data"] <= dzien])
