# Karton magazynowy jako jednostka pakowa (bez zamówienia)

Data: 2026-06-18 · Status: zatwierdzony (brainstorming) · Zastępuje błędne „karton = finished_goods"

## Problem
Wyprodukowano 18×40kg na magazyn (na górkę) dla Gold Kebab — BEZ zamówienia.
Magazynierzy nie mają etykiety na karton, żeby spakować te już wyprodukowane
sztuki. Dziś etykieta kartonu (=paleta) wymaga zamówienia. Poprzednia próba
(karton = ręczny wpis finished_goods) była zła — tworzyła „nowego kebaba",
niezgodnie z łańcuchem.

## Decyzje (brainstorming)
- Karton = **jednostka pakowa** (NIE produkcja). Sztuki pochodzą z realnej produkcji.
- Magazynier **skanuje sztuki do kartonu** (pełna traceability co do sztuki).
- Tworzenie w **biurze**. **Późniejsze powiązanie z zamówieniem** — tak.

## Model — nowa tabela `stock_cartons`
Izolowana od `order_pallets` (brak zamówienia). `finished_units.carton_id`
(kolumna już istnieje) wskazuje karton.

```
stock_cartons(
  id, carton_no INTEGER (globalny carton_seq, wspólny z paletami),
  client_id, client_name, recipe_id, recipe_name,
  product_type_id, product_type_name, packaging_id, packaging_name,
  kg_per_unit NUMERIC, target_qty INT, packed_qty INT DEFAULT 0,
  status TEXT DEFAULT 'open',           -- open → packed
  linked_order_id, linked_order_no,     -- Faza 2
  created_at, closed_at)
```

## Faza 1 — karton + etykieta + skan sztuk
- **create_stock_carton(dto)**: insert, carton_no=next_seq('carton_seq'), status open.
- **scan_unit_into_carton(carton_id, qr)**: parse QR → sztuka. Walidacja:
  status sztuki == 'produced' (wyprodukowana, nie planned/packed/shipped);
  brak carton_id (nie spakowana); zgodność specyfikacji z kartonem
  (recipe_id + product_type_id + tuleja(=packaging_name) + waga(kg_per_unit));
  karton niepełny (packed_qty<target_qty). Sukces → finished_units.carton_id=karton,
  status='packed', packed_qty++; przy target → carton.status='packed'.
- **lookup_unit**: rozwiązuje carton_no także z `stock_cartons` po carton_id
  (żeby lokalizacja sztuki „Karton {nr}" działała dla kartonów magazynowych).
- **Etykieta kartonu** (drukowalna): carton_no + klient + produkt + ilość×waga + QR
  kartonu (`SCARTON|<id>` do otwarcia przy pakowaniu).
- **Front**: biuro „Dodaj karton magazynowy" (FinishedGoodsPage) → tworzy stock_carton;
  strona druku etykiety kartonu; mobile „Pakowanie kartonu" (skan kartonu → skan sztuk).

## Faza 2 — powiązanie z zamówieniem
- **suggestions_for_order(order_id)**: pasujące kartony magazynowe (status open/packed,
  linked_order_id NULL) po client_id+recipe_id+product_type_id+packaging_id+kg_per_unit.
- **assign_to_order(carton_id, order_id)**: walidacja klienta; ustawia
  carton.linked_order_id/no, stempluje order_id na sztukach kartonu. Pokrycie
  zamówienia i dokumenty już liczą zapas z finished_goods (order_stock_service).
- **Front**: panel „Pasujące kartony" na ClientOrdersPage (repoint na stock_cartons).

## Usunięcie błędnego feature
- `finished_goods_service.create_stock_carton` + `assign_stock_carton_to_order` —
  usunąć / przenieść na stock_cartons. `stock_carton_match_service` → na stock_cartons.
- Front: `StockCartonModal` (tworzył finished_goods) → tworzy stock_carton.
  `StockCartonSuggestions` → repoint endpoint.
- Kolumny finished_goods.carton_no/client_id — zostają (nieszkodliwe), bez użycia.

## Testy (TDD)
- create nadaje carton_no.
- scan_unit_into_carton: sukces (carton_id+packed_qty), odrzuca niezgodną specyfikację,
  odrzuca sztukę planned/już spakowaną, odrzuca gdy karton pełny.
- match_cartons (czysta) na stock_cartons; assign linkuje + waliduje klienta.

## Poza zakresem (YAGNI)
- Stock pallet w order_pallets (odrzucone — order_pallets za mocno związane z zamówieniem).
- Auto-pakowanie bez skanu.
