"""Pierwszeństwo ma zamówienie, które wyjeżdża wcześniej.

31.08.2026 YALCIN złożył rano zamówienie na wyjazd tego samego dnia. Świeże
sztuki z poprzedniego wieczoru były już ostemplowane zamówieniem sprzed
czterech dni, jadącym dopiero 3 września — auto stało puste obok pełnej
chłodni. Stempel `client_order_no` to PRZYDZIAŁ, nie fakt fizyczny, więc
wolno go zmienić, dopóki towar nie wyjechał.
"""
from app.db import execute, query_all, query_one
from app.models.orders import ClientOrderCreate
from app.services.orders_service import create_order
from app.utils.ids import cuid, now_iso

KLIENT = 'cl-yalcin'
REC = 'rec-kirmizi'


def _klient():
    execute("INSERT INTO clients (id, code, name, display_name, active, created_at) "
            "VALUES (%s,'YAL','OKAY SP. Z O.O.','YALCIN',true,%s) "
            "ON CONFLICT (id) DO NOTHING", (KLIENT, now_iso()))


def _zamowienie(order_no, delivery, qty=10, kg=25.0, status='confirmed', dni_temu=0):
    oid = cuid()
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, "
            "order_date, delivery_date, status, created_at) "
            "VALUES (%s,%s,%s,'YALCIN',%s,%s,%s, now() - (%s || ' days')::interval)",
            (oid, order_no, KLIENT, delivery, delivery, status, dni_temu))
    execute("INSERT INTO client_order_lines (id, order_id, qty, kg_per_unit, recipe_id) "
            "VALUES (%s,%s,%s,%s,%s)", (cuid(), oid, qty, kg, REC))
    return oid


def _sztuki(order_no, qty=10, kg=25.0, shipped=0, produced='2026-08-30'):
    fid = cuid()
    execute("INSERT INTO finished_goods (id, batch_no, recipe_id, recipe_name, "
            "kg_per_unit, qty, qty_available, qty_shipped, total_kg, client_id, "
            "client_name, client_order_no, produced_date, created_at) "
            "VALUES (%s,'B1',%s,'KIRMIZI',%s,%s,%s,%s,%s,%s,'YALCIN',%s,%s,%s)",
            (fid, REC, kg, qty, qty - shipped, shipped, qty * kg, KLIENT,
             order_no, produced, now_iso()))
    return fid


def _dto(delivery, qty=10, kg=25.0):
    # Model zamówienia nie ma aliasów camelCase — pola idą po snake_case.
    return ClientOrderCreate.model_validate({
        "client_id": KLIENT, "order_date": delivery, "delivery_date": delivery,
        "lines": [{"qty": qty, "kg_per_unit": kg, "recipe_id": REC}],
    })


def _stempel(fid):
    return query_one("SELECT client_order_no FROM finished_goods WHERE id=%s",
                     (fid,))["client_order_no"]


class TestPrzepiecie:
    def test_sztuki_przechodza_na_zamowienie_jadace_wczesniej(self, db):
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=10)
        nowe = create_order(_dto('2026-08-31', qty=10))
        assert _stempel(fid) == nowe["order_no"]

    def test_bierze_tylko_tyle_ile_pilniejsze_potrzebuje(self, db):
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', qty=30, dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=30)
        nowe = create_order(_dto('2026-08-31', qty=10))
        # Wiersz dzieli się: 10 na pilniejsze, 20 zostaje na późniejszym.
        wiersze = query_all("SELECT client_order_no, qty FROM finished_goods "
                            "ORDER BY qty")
        assert sorted((w["client_order_no"], int(w["qty"])) for w in wiersze) == [
            (nowe["order_no"], 10), ('YALCIN/Z/3/08/26', 20)]
        assert _stempel(fid) == 'YALCIN/Z/3/08/26'

    def test_NIE_rusza_sztuk_ktore_juz_wyjechaly(self, db):
        # Po wydaniu stempel stoi na WZ i HDI u odbiorcy.
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=10, shipped=4)
        create_order(_dto('2026-08-31'))
        assert _stempel(fid) == 'YALCIN/Z/3/08/26'

    def test_NIE_zabiera_zamowieniu_jadacemu_WCZESNIEJ(self, db):
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-08-29', dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=10)
        create_order(_dto('2026-09-05'))
        assert _stempel(fid) == 'YALCIN/Z/3/08/26'

    def test_NIE_zabiera_INNEMU_klientowi(self, db):
        _klient()
        execute("INSERT INTO clients (id, code, name, active, created_at) "
                "VALUES ('cl-inny','INN','INNY',true,%s) ON CONFLICT (id) DO NOTHING",
                (now_iso(),))
        oid = cuid()
        execute("INSERT INTO client_orders (id, order_no, client_id, client_name, "
                "order_date, delivery_date, status, created_at) "
                "VALUES (%s,'INNY/Z/1/08/26','cl-inny','INNY','2026-09-03',"
                "'2026-09-03','confirmed',%s)", (oid, now_iso()))
        fid = cuid()
        execute("INSERT INTO finished_goods (id, batch_no, recipe_id, kg_per_unit, qty, "
                "qty_available, qty_shipped, total_kg, client_id, client_name, "
                "client_order_no, created_at) VALUES (%s,'B9',%s,25,10,10,0,250,"
                "'cl-inny','INNY','INNY/Z/1/08/26',%s)", (fid, REC, now_iso()))
        create_order(_dto('2026-08-31'))
        assert _stempel(fid) == 'INNY/Z/1/08/26'

    def test_NIE_rusza_zamowien_zamknietych(self, db):
        # Zrealizowane zamówienie ma wydane = zamówione i nie sięga do puli.
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', status='done', dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=10)
        create_order(_dto('2026-08-31'))
        assert _stempel(fid) == 'YALCIN/Z/3/08/26'

    def test_zamowienie_bez_daty_wyjazdu_nic_nie_przejmuje(self, db):
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', dni_temu=4)
        fid = _sztuki('YALCIN/Z/3/08/26', qty=10)
        dto = ClientOrderCreate.model_validate({
            "client_id": KLIENT, "order_date": '2026-08-31',
            "lines": [{"qty": 10, "kg_per_unit": 25.0, "recipe_id": REC}]})
        create_order(dto)
        assert _stempel(fid) == 'YALCIN/Z/3/08/26'

    def test_najstarsza_produkcja_idzie_na_najblizszy_wyjazd(self, db):
        # FEFO: nie zostawiamy najstarszego towaru na sam koniec.
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', qty=20, dni_temu=4)
        stara = _sztuki('YALCIN/Z/3/08/26', qty=10, produced='2026-08-25')
        _sztuki('YALCIN/Z/3/08/26', qty=10, produced='2026-08-30')
        nowe = create_order(_dto('2026-08-31', qty=10))
        assert _stempel(stara) == nowe["order_no"]

    def test_ilosc_i_waga_po_podziale_sie_zgadzaja(self, db):
        _klient()
        _zamowienie('YALCIN/Z/3/08/26', '2026-09-03', qty=30, dni_temu=4)
        _sztuki('YALCIN/Z/3/08/26', qty=30, kg=25.0)
        create_order(_dto('2026-08-31', qty=10))
        sumy = query_one("SELECT SUM(qty) q, SUM(qty_available) d, SUM(total_kg) kg "
                         "FROM finished_goods")
        assert int(sumy["q"]) == 30 and int(sumy["d"]) == 30
        assert float(sumy["kg"]) == 750.0
