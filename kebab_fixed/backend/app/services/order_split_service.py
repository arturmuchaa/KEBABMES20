"""Podział zamówienia zapisany na pozycjach — podgląd i zapis.

Podgląd NIE zapisuje: biuro ogląda tabelę, poprawia pojedynczą pozycję
i dopiero wtedy zatwierdza.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.order_split import podziel_pozycje
from app.services.wz_service import KOMUNIKAT_ANULUJ_PODZIAL

logger = get_logger(__name__)

#: Podział wolno zmieniać TYLKO dopóki nie ma na nim papierów.
_KOMUNIKAT_PO_WYSTAWIENIU = (
    "Zamówienie ma już wystawione dokumenty z podziału ({numer}) — zmiana podziału "
    "rozjechałaby je między sobą: WZ dla klienta jest już wystawiony i zostaje taki, "
    "jaki jest, a papiery pod fakturę przeliczyłyby się na nowo. Żeby zmienić podział, "
    + KOMUNIKAT_ANULUJ_PODZIAL + ".")


#: Odmowa EDYCJI ZAMÓWIENIA, na którym leżą już papiery z podziału.
#: Osobny tekst od `_KOMUNIKAT_PO_WYSTAWIENIU`, bo opisuje inną szkodę:
#: tam rozjeżdżają się dokumenty MIĘDZY SOBĄ, tu zamówienie rozjeżdża się
#: z WYDRUKOWANYM papierem. Wyjście jest to samo, więc zdanie o wyjściu też
#: (`KOMUNIKAT_ANULUJ_PODZIAL`).
_KOMUNIKAT_EDYCJA_PO_WYSTAWIENIU = (
    "Zamówienie ma już wystawione dokumenty z podziału ({numer}) — edycja pozycji "
    "przestawiłaby liczby, które są już na WYDRUKOWANYM papierze. Część na WZ liczy się "
    "jako qty - qty_invoice, więc zmiana ilości po cichu przepisuje zawartość wystawionego "
    "WZ dla klienta. Żeby poprawić zamówienie, " + KOMUNIKAT_ANULUJ_PODZIAL + ".")


def _dokument_z_podzialu(order_id: str) -> Optional[Dict[str, Any]]:
    """Pierwszy ŻYWY dokument z podziału tego zamówienia (albo None)."""
    return query_one(
        "SELECT number FROM wz_documents WHERE source_type='order' AND source_id=%s "
        "AND split_scope IS NOT NULL AND COALESCE(status,'')<>'anulowany' "
        "ORDER BY created_at LIMIT 1", (order_id,))


def odmow_edycji_gdy_dokumenty_wystawione(order_id: str) -> None:
    """Trzecia siostra tej samej bramki — woła ją `orders_service.update_order`.

    Wystawienie kompletu NIE zmienia statusu zamówienia: zostaje `confirmed`,
    czyli w pełni edytowalne, a `_reconcile_lines_cx` po cichu PRZYCINA
    `qty_invoice` do nowego `qty` (min(stare, nowe)), zabiera je razem
    z usuniętą pozycją i daje NULL pozycji dopisanej. Zamówienie 10 szt.
    z 8 na fakturę, poprawione na 3 szt., zostawia „na WZ" zero, podczas gdy
    WYDRUKOWANY WZ dla klienta mówi o 2 sztukach — cicha zmiana liczb, które
    są już na papierze (review końcowy, I1, 2026-09-11).

    Stoi TUTAJ, a nie w `orders_service`, żeby wszystkie trzy odmowy
    („na tym zamówieniu leżą papiery z podziału") czytało się w jednym
    miejscu. Import po stronie `orders_service` jest lokalny — `wz_service`
    importuje `orders_service`, więc import modułowy zamknąłby cykl.
    """
    dokument = _dokument_z_podzialu(order_id)
    if dokument:
        raise HTTPException(
            400, _KOMUNIKAT_EDYCJA_PO_WYSTAWIENIU.format(numer=dokument["number"]))


def _odmow_gdy_dokumenty_wystawione(order_id: str) -> None:
    """Guard na `zapisz_podzial` i `wyczysc_podzial`.

    Po wystawieniu kompletu zmiana podziału rozjeżdża dokumenty MIĘDZY SOBĄ:
    `wystaw_wz_klienta` jest idempotentny i oddaje STARY dokument bez
    odświeżenia, a kolejne kliknięcie kompletu ODŚWIEŻA CMR i HDI wariantu
    `fv` do nowego podziału. Wydrukowany WZ dla klienta mówiłby wtedy co
    innego niż papiery pod fakturę — dla jednej wysyłki i bez ostrzeżenia.

    `wyczysc_podzial` jest jeszcze gorszy: kasuje `qty_invoice` oraz
    `invoice_kg_target` POD wystawionymi dokumentami, po czym warianty `fv`
    zaczynają odmawiać, a papiery zostają bez pokrycia w danych zamówienia.

    Odmowa jest w pełni odwracalna — `anuluj_dokumenty_podzialu` zwraca towar
    na stan i odblokowuje podział (review Task 7, runda 1, finding 3).
    """
    dokument = _dokument_z_podzialu(order_id)
    if dokument:
        raise HTTPException(400, _KOMUNIKAT_PO_WYSTAWIENIU.format(numer=dokument["number"]))


def _linie(order_id: str) -> List[Dict[str, Any]]:
    return query_all(
        "SELECT id, qty, kg_per_unit, recipe_name, product_type_name, position, qty_invoice "
        "FROM client_order_lines WHERE order_id=%s ORDER BY position", (order_id,))


def _trafiono(kg_fv: float, cel_kg: float, kg_calosc: float) -> bool:
    """JEDNA definicja „trafiono" dla wszystkich odpowiedzi tego modułu.

    Ta sama co w `podziel_pozycje` (tolerancja 1e-6, cel obcięty do
    [0, całość] liczonej BEZ zaokrąglenia). Trzymana w jednym miejscu,
    bo każde kolejne miejsce, które liczy to samo pojęcie po swojemu, to
    kolejna szansa, żeby ten sam podział raz „trafiał", a raz nie —
    zależnie od tego, którą trasą biuro na niego patrzy.
    """
    cel_obciety = max(0.0, min(float(cel_kg or 0), kg_calosc))
    return abs(kg_fv - cel_obciety) < 1e-6


def podglad_podzialu(order_id: str, cel_kg: float) -> Dict[str, Any]:
    """Jak rozłoży się podział — bez zapisu."""
    linie = _linie(order_id)
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    obliczone = podziel_pozycje(
        [{"id": l["id"], "qty": int(l["qty"] or 0),
          "kg_per_unit": float(l["kg_per_unit"] or 0)} for l in linie], cel_kg)
    po_id = {w["id"]: w for w in obliczone["lines"]}
    lines = []
    for l in linie:
        na_fv = int(po_id[l["id"]]["qty_invoice"])
        lines.append({
            "id": l["id"], "position": l["position"],
            "recipe_name": l.get("recipe_name") or "",
            "product_type_name": l.get("product_type_name") or "",
            "kg_per_unit": float(l["kg_per_unit"] or 0),
            "qty": int(l["qty"] or 0),
            "qty_invoice": na_fv,
            "qty_wz": int(l["qty"] or 0) - na_fv,
        })
    kg_fv = sum(x["qty_invoice"] * x["kg_per_unit"] for x in lines)
    kg_all = sum(x["qty"] * x["kg_per_unit"] for x in lines)
    return {"order_id": order_id, "cel_kg": float(cel_kg or 0), "lines": lines,
            "kg_fv": round(kg_fv, 3), "kg_wz": round(kg_all - kg_fv, 3),
            "kg_calosc": round(kg_all, 3),
            "trafiono": obliczone["trafiono"],
            "odchylka": round(kg_fv - float(cel_kg or 0), 3)}


def zapisz_podzial(order_id: str, cel_kg: float,
                   per_line: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Utrwala podział na pozycjach. `per_line` nadpisuje wyliczenie."""
    _odmow_gdy_dokumenty_wystawione(order_id)
    podglad = podglad_podzialu(order_id, cel_kg)
    korekty = per_line or {}
    for l in podglad["lines"]:
        if l["id"] in korekty:
            reczne = int(korekty[l["id"]])
            if reczne < 0 or reczne > l["qty"]:
                raise HTTPException(
                    400,
                    f"Pozycja {l['recipe_name']} {l['kg_per_unit']} kg: nie można dać "
                    f"na fakturę {reczne} szt, zamówiono {l['qty']}")
            l["qty_invoice"] = reczne
            l["qty_wz"] = l["qty"] - reczne

    with transaction() as conn:
        for l in podglad["lines"]:
            cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=%s WHERE id=%s",
                       (l["qty_invoice"], l["id"]))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=%s WHERE id=%s",
                   (float(cel_kg or 0), order_id))
    logger.info("order.split.saved", extra={"order_id": order_id, "cel_kg": float(cel_kg or 0)})
    kg_fv = sum(l["qty_invoice"] * l["kg_per_unit"] for l in podglad["lines"])
    podglad["kg_fv"] = round(kg_fv, 3)
    podglad["kg_wz"] = round(podglad["kg_calosc"] - kg_fv, 3)
    # `trafiono`/`odchylka` odziedziczone z `podglad_podzialu` (powyżej) opisują
    # PROPOZYCJĘ algorytmu SPRZED ręcznej korekty — po nałożeniu `per_line`
    # muszą opisywać to, co FAKTYCZNIE zapisane. Bez tego biuro poprawia
    # pozycję ręcznie, zapisuje i widzi „trafiono, odchyłka 0", podczas gdy
    # zapisany podział jest o kilkadziesiąt kg obok celu — liczba na ekranie,
    # która nie opisuje stanu w bazie (fix po review, runda 2, Task 8).
    #
    # `_trafiono` to TA SAMA definicja co w `podziel_pozycje` i w odczycie
    # zapisanego podziału — jedno pojęcie, jedno miejsce. Bez korekt
    # (`per_line` puste) `kg_fv` tutaj jest identyczne z tym z
    # `podglad_podzialu`, więc przeliczenie niczego nie zmienia także wtedy,
    # gdy nic nie poprawiono ręcznie.
    kg_calosc_nieokragl = sum(l["qty"] * l["kg_per_unit"] for l in podglad["lines"])
    podglad["trafiono"] = _trafiono(kg_fv, cel_kg, kg_calosc_nieokragl)
    podglad["odchylka"] = round(kg_fv - float(cel_kg or 0), 3)
    return podglad


def zapisany_podzial(order_id: str) -> Dict[str, Any]:
    """Podział ZAPISANY na zamówieniu — to, co naprawdę leży w bazie.

    Osobne pytanie niż `podglad_podzialu`, który odpowiada „jak BY się
    rozłożyło". Z bazy powstają dokumenty (`wystaw_komplet` nie dostaje ani
    celu, ani pozycji — czyta `qty_invoice`), więc okno musi umieć zapytać
    „jak JEST", zanim biuro cokolwiek wpisze. Bez tej trasy jedyną drogą do
    odblokowania „Wystaw komplet" był ponowny zapis — a `zapisz_podzial`
    nadpisuje `qty_invoice` na KAŻDEJ pozycji propozycją algorytmu, więc
    ręczna korekta z poprzedniej sesji znikała bez pytania.

    Dwie osobne flagi, bo to dwa różne fakty:

    * `istnieje` — którakolwiek pozycja ma zapisane `qty_invoice`;
    * `kompletny` — mają je WSZYSTKIE. Tylko wtedy komplet dokumentów da się
      wystawić (`_sprawdz_gotowosc_do_kompletu` odmawia przy choćby jednym
      NULL) i tylko wtedy sumy poniżej opisują cały towar z zamówienia.

    Podział niepełny (np. po dopisaniu pozycji do zamówienia) oddajemy z
    zapisanymi liczbami i `kompletny=False`: biuro ma ZOBACZYĆ, co już jest
    zapisane — inaczej zapisze podział na nowo i skasuje własną korektę.
    `qty_invoice`/`qty_wz` pozycji bez podziału zostają NULL — nie udajemy
    zera, którego nikt nie zapisał. `kg_fv`/`kg_wz` sumują wtedy wyłącznie
    pozycje z zapisanym podziałem, więc nie dodają się do `kg_calosc`; tę
    różnicę widać i o to chodzi.
    """
    linie = _linie(order_id)
    if not linie:
        raise HTTPException(404, "Zamówienie nie ma pozycji")
    zamowienie = query_one("SELECT invoice_kg_target FROM client_orders WHERE id=%s",
                           (order_id,))
    if zamowienie is None:
        raise HTTPException(404, "Nie ma takiego zamówienia")

    lines: List[Dict[str, Any]] = []
    for l in linie:
        qty = int(l["qty"] or 0)
        na_fv = None if l.get("qty_invoice") is None else int(l["qty_invoice"])
        lines.append({
            "id": l["id"], "position": l["position"],
            "recipe_name": l.get("recipe_name") or "",
            "product_type_name": l.get("product_type_name") or "",
            "kg_per_unit": float(l["kg_per_unit"] or 0),
            "qty": qty,
            "qty_invoice": na_fv,
            "qty_wz": None if na_fv is None else qty - na_fv,
        })

    z_podzialem = [x for x in lines if x["qty_invoice"] is not None]
    istnieje = bool(z_podzialem)
    kompletny = istnieje and len(z_podzialem) == len(lines)
    kg_all = sum(x["qty"] * x["kg_per_unit"] for x in lines)
    kg_fv = sum(x["qty_invoice"] * x["kg_per_unit"] for x in z_podzialem)
    kg_wz = sum((x["qty"] - x["qty_invoice"]) * x["kg_per_unit"] for x in z_podzialem)
    cel_kg = zamowienie.get("invoice_kg_target")
    cel_kg = None if cel_kg is None else float(cel_kg)

    # `trafiono`/`odchylka` mają sens tylko wobec ZAPISANEGO celu i tylko dla
    # pełnego podziału — przy niepełnym `kg_fv` nie opisuje jeszcze całego
    # zamówienia, więc porównanie z celem mówiłoby nieprawdę.
    trafiono = None
    odchylka = None
    if kompletny and cel_kg is not None:
        trafiono = _trafiono(kg_fv, cel_kg, kg_all)
        odchylka = round(kg_fv - cel_kg, 3)

    return {"order_id": order_id, "istnieje": istnieje, "kompletny": kompletny,
            "cel_kg": cel_kg, "lines": lines,
            "kg_fv": round(kg_fv, 3), "kg_wz": round(kg_wz, 3),
            "kg_calosc": round(kg_all, 3),
            "trafiono": trafiono, "odchylka": odchylka}


def wyczysc_podzial(order_id: str) -> None:
    """Kasuje podział — zamówienie wraca do zachowania sprzed tej zmiany."""
    _odmow_gdy_dokumenty_wystawione(order_id)
    with transaction() as conn:
        cx_execute(conn, "UPDATE client_order_lines SET qty_invoice=NULL WHERE order_id=%s",
                   (order_id,))
        cx_execute(conn, "UPDATE client_orders SET invoice_kg_target=NULL WHERE id=%s",
                   (order_id,))
