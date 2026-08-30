"""Katalog wyrobów — to, co zakład faktycznie sprzedaje.

Pozycja katalogu to NIE sam rodzaj, tylko czwórka **rodzaj × receptura ×
tuleja × gramatura**. Ta czwórka jest już kluczem pokrycia zamówień, więc
katalog nie wprowadza drugiej tożsamości obok działającej — nadaje jej numer.

Katalog jest REJESTREM, nie kartoteką do ręcznego prowadzenia: kombinacje
dopisują się z tego, co realnie wyprodukowano i zamówiono. Biuro poprawia
kody i wygasza pozycje, których już nie sprzedaje.
"""
from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import (
    cx_execute, cx_execute_returning, cx_query_all, cx_query_one,
    query_all, query_one, transaction,
)
from app.logging_config import get_logger
from app.utils.ids import cuid, now_iso
from app.utils.product_codes import (
    kod_katalogowy, kolejny_wolny, normalizuj_kod, skrot_nazwy, skrot_tulei,
)

logger = get_logger(__name__)


def nadaj_kody_slownikowi_cx(conn, tabela: str) -> None:
    """Skrót nazwy jako kod — dla wierszy, które kodu jeszcze nie mają."""
    zajete = {
        r["code"] for r in cx_query_all(
            conn, f"SELECT code FROM {tabela} WHERE COALESCE(code,'') <> ''")
    }
    for row in cx_query_all(
        conn, f"SELECT id, name FROM {tabela} WHERE COALESCE(code,'') = '' ORDER BY name"
    ):
        kod = kolejny_wolny(skrot_nazwy(row["name"] or ""), zajete)
        if not kod:
            continue
        zajete.add(kod)
        cx_execute(conn, f"UPDATE {tabela} SET code = %s WHERE id = %s", (kod, row["id"]))


def odswiez_katalog_cx(conn) -> int:
    """Dopisuje do katalogu kombinacje widziane w produkcji i w zamówieniach."""
    from app.utils.ids import cuid, now_iso

    kody_tulei = {
        r["name"]: r["code"] for r in cx_query_all(conn, "SELECT name, code FROM packaging")
    }
    skroty_rodzajow = {
        r["name"]: r["code"] for r in cx_query_all(conn, "SELECT name, code FROM product_types")
    }
    skroty_receptur = {
        r["name"]: r["code"] for r in cx_query_all(conn, "SELECT name, code FROM recipes")
    }
    zajete = {
        r["code"] for r in cx_query_all(
            conn, "SELECT code FROM product_catalog WHERE COALESCE(code,'') <> ''")
    }

    kombinacje = cx_query_all(
        conn,
        """
        SELECT product_type_id, product_type_name, recipe_id, recipe_name,
               packaging_id, packaging_name, kg_per_unit
        FROM (
            SELECT DISTINCT product_type_id, product_type_name, recipe_id, recipe_name,
                   packaging_id, packaging_name, kg_per_unit
            FROM finished_goods
            WHERE COALESCE(product_type_name,'') <> ''
            UNION
            SELECT DISTINCT product_type_id, product_type_name, recipe_id, recipe_name,
                   packaging_id, packaging_name, kg_per_unit
            FROM client_order_lines
            WHERE COALESCE(product_type_name,'') <> ''
        ) x
        ORDER BY product_type_name, recipe_name, packaging_name, kg_per_unit
        """,
    )

    dodane = 0
    for k in kombinacje:
        kod = kolejny_wolny(
            kod_katalogowy(
                skroty_rodzajow.get(k["product_type_name"]) or skrot_nazwy(k["product_type_name"]),
                skroty_receptur.get(k["recipe_name"]) or skrot_nazwy(k["recipe_name"] or ""),
                skrot_tulei(kody_tulei.get(k["packaging_name"], ""), k["packaging_name"] or ""),
                float(k["kg_per_unit"] or 0),
            ),
            zajete,
        )
        if not kod:
            continue
        row = cx_execute_returning(
            conn,
            """INSERT INTO product_catalog
                 (id, code, product_type_id, product_type_name, recipe_id, recipe_name,
                  packaging_id, packaging_name, kg_per_unit, active, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s)
               ON CONFLICT (product_type_name, recipe_name, packaging_name, kg_per_unit)
               DO NOTHING
               RETURNING id""",
            (cuid(), kod, k["product_type_id"] or "", k["product_type_name"] or "",
             k["recipe_id"] or "", k["recipe_name"] or "",
             k["packaging_id"] or "", k["packaging_name"] or "",
             float(k["kg_per_unit"] or 0), now_iso()),
        )
        if row:
            zajete.add(kod)
            dodane += 1
    return dodane


def list_product_catalog(only_active: bool = False) -> List[Dict]:
    """Katalog do ekranu i do eksportu — najpierw rodzaj, potem gramatura."""
    where = "WHERE active = true" if only_active else ""
    return query_all(
        f"""SELECT * FROM product_catalog {where}
            ORDER BY product_type_name, recipe_name, packaging_name, kg_per_unit"""
    )


def refresh_product_catalog() -> Dict[str, Any]:
    """Dociąga kombinacje, które pojawiły się od ostatniego odświeżenia."""
    with transaction() as conn:
        nadaj_kody_slownikowi_cx(conn, "product_types")
        nadaj_kody_slownikowi_cx(conn, "recipes")
        dodane = odswiez_katalog_cx(conn)
    logger.info("product_catalog.refreshed", extra={"added": dodane})
    return {"added": dodane}


def update_product_catalog_entry(entry_id: str, body: Dict[str, Any]) -> Dict:
    """Poprawka kodu albo wygaszenie pozycji.

    Czwórki (rodzaj, receptura, tuleja, gramatura) NIE da się tu zmienić —
    to tożsamość pozycji, a nie jej opis. Inny wyrób to inna pozycja.
    """
    with transaction() as conn:
        rec = cx_query_one(conn, "SELECT * FROM product_catalog WHERE id=%s", (entry_id,))
        if not rec:
            raise HTTPException(404, "Nie ma takiej pozycji katalogu")

        pola, wartosci = [], []
        if "code" in body:
            kod = normalizuj_kod(str(body.get("code") or ""))
            if not kod:
                raise HTTPException(400, "Kod nie może być pusty")
            zajety = cx_query_one(
                conn, "SELECT id FROM product_catalog WHERE code=%s AND id<>%s",
                (kod, entry_id))
            if zajety:
                raise HTTPException(400, f"Kod {kod} jest już zajęty przez inną pozycję")
            pola.append("code = %s")
            wartosci.append(kod)
        if "active" in body:
            pola.append("active = %s")
            wartosci.append(bool(body.get("active")))
        if not pola:
            return rec

        wartosci.append(entry_id)
        row = cx_execute_returning(
            conn,
            f"UPDATE product_catalog SET {', '.join(pola)} WHERE id = %s RETURNING *",
            tuple(wartosci),
        )
    logger.info("product_catalog.updated", extra={"entry_id": entry_id})
    return row
