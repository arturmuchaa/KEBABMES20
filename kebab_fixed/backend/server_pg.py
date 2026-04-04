"""
KEBAB MES — Backend API (psycopg2 — kompatybilny z każdą wersją PostgreSQL)

Instalacja:
  pip install fastapi uvicorn psycopg2-binary python-dotenv

Uruchomienie:
  uvicorn server_pg:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime, date
import psycopg2
import psycopg2.extras
import os
import uuid
from pathlib import Path
from dotenv import load_dotenv
import logging
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/kebab_mes')
CORS_ORIGINS  = os.environ.get('CORS_ORIGINS', '*').split(',')

# ─── DB helper ────────────────────────────────────────────────
def get_conn():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)

def query_all(sql: str, params=None) -> List[Dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return [dict(r) for r in cur.fetchall()]

def query_one(sql: str, params=None) -> Optional[Dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            row = cur.fetchone()
            return dict(row) if row else None

def execute(sql: str, params=None) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
        conn.commit()

def execute_returning(sql: str, params=None) -> Optional[Dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            row = cur.fetchone()
            conn.commit()
            return dict(row) if row else None

def _b(body: dict, snake: str, default=None):
    """Pobiera wartość z body akceptując snake_case i camelCase (toSnake konwertuje frontend)."""
    if snake in body:
        return body[snake]
    # Auto-konwersja snake_case → camelCase: raw_batch_id → rawBatchId
    parts = snake.split('_')
    camel = parts[0] + ''.join(p.title() for p in parts[1:])
    return body.get(camel, default)

def next_seq(key: str) -> int:
    row = execute_returning(
        "UPDATE sequences SET value = value + 1 WHERE key = %s RETURNING value",
        (key,)
    )
    return row['value'] if row else 1

def cuid() -> str:
    return str(uuid.uuid4()).replace('-', '')[:20]

def now_iso() -> str:
    return datetime.utcnow().isoformat() + 'Z'

# ─── App ──────────────────────────────────────────────────────
app = FastAPI(title="Kebab MES API", version="1.0.0")

# BUGFIX: Upewnij sie ze Woda (skladnik nielimitowany) istnieje w bazie przy starcie
@app.on_event("startup")
def seed_water():
    try:
        existing = query_one("SELECT id FROM ingredients WHERE is_unlimited = true LIMIT 1")
        if not existing:
            execute("""
                INSERT INTO ingredients (id, name, unit, is_unlimited, active, created_at)
                VALUES (gen_random_uuid()::text, 'Woda', 'L', true, true, NOW())
            """)
            logger.info("Seed: dodano skladnik Woda (is_unlimited=true)")
        else:
            logger.info("Seed: skladnik Woda juz istnieje")
    except Exception as e:
        logger.warning(f"Seed water error: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    logger.info("Łączę z bazą danych...")
    try:
        conn = get_conn()
        conn.close()
        logger.info("✓ Połączenie z bazą OK")
    except Exception as e:
        logger.error(f"✗ Błąd połączenia z bazą: {e}")
        raise
    # Auto-migracja: dodaj brakujące kolumny jeśli nie istnieją
    migrations = [
        "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS description TEXT",
        "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS components JSONB DEFAULT '[]'",
        # Traceability v2 — powiązania batch→batch
        "ALTER TABLE seasoned_meat ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE mixing_orders ADD COLUMN IF NOT EXISTS source_seasoned_batch_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_mixing_batch_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
        "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_production_id TEXT",
        "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS batch_allocation JSONB DEFAULT '{}'",
        "ALTER TABLE production_plan_lines ADD COLUMN IF NOT EXISTS seasoned_batch_nos TEXT[] DEFAULT '{}'",
        # Traceability v3 — pełny łańcuch w production_sessions i finished_goods
        "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE production_sessions ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_mixing_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_seasoned_ids TEXT[] DEFAULT '{}'",
        "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS source_deboning_ids TEXT[] DEFAULT '{}'",
    ]
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                for sql in migrations:
                    cur.execute(sql)
            conn.commit()
        logger.info("✓ Migracje OK")
    except Exception as e:
        logger.warning(f"Migracja: {e}")
    # Backfill source_deboning_ids dla starych partii (bezpieczne, tylko puste)
    try:
        old_batches = query_all(
            "SELECT id, mixing_order_no FROM seasoned_meat "
            "WHERE source_deboning_ids = '{}' OR source_deboning_ids IS NULL")
        fixed = 0
        for sm in old_batches:
            mo = query_one("SELECT id FROM mixing_orders WHERE order_no=%s",
                           (sm.get('mixing_order_no'),)) if sm.get('mixing_order_no') else None
            if not mo:
                continue
            lots = query_all("""
                SELECT ms.deboning_session_id
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                WHERE mol.order_id = %s AND ms.deboning_session_id IS NOT NULL
            """, (mo['id'],))
            deb_ids = list({lt['deboning_session_id'] for lt in lots if lt.get('deboning_session_id')})
            if deb_ids:
                execute("""
                    UPDATE seasoned_meat SET source_deboning_ids = %s::text[]
                    WHERE id = %s AND (source_deboning_ids = '{}' OR source_deboning_ids IS NULL)
                """, (deb_ids, sm['id']))
                fixed += 1
        if fixed:
            logger.info(f"✓ Backfill lineage: naprawiono {fixed} partii mięsa przyprawionego")
    except Exception as e:
        logger.warning(f"Backfill lineage: {e}")

    # Zapewnij że sekwencja mixed_seq istnieje (numery MPP dla łączonych partii)
    try:
        execute("INSERT INTO sequences (key, value) VALUES ('mixed_seq', 0) ON CONFLICT (key) DO NOTHING")
        logger.info("✓ Sekwencja mixed_seq OK")
    except Exception as e:
        logger.warning(f"mixed_seq: {e}")

from fastapi.responses import HTMLResponse, RedirectResponse

@app.get("/")
def root():
    html = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kebab MES API</title>
<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:60px auto;padding:0 20px;color:#1a1a1a}
h1{color:#2563eb;margin-bottom:8px}p{color:#555;margin:4px 0}
.btn{display:inline-block;margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;
text-decoration:none;border-radius:8px;font-weight:600;margin-right:8px}
.btn.sec{background:#f0f4ff;color:#2563eb}
.status{display:inline-block;padding:4px 10px;background:#d1fae5;color:#065f46;border-radius:99px;font-size:13px;font-weight:600}
</style></head><body>
<h1>🥙 Kebab MES — Backend API</h1>
<p class="status">✓ Serwer działa</p>
<p style="margin-top:16px">Backend systemu zarządzania produkcją kebaba.</p>
<p>Frontend: <strong>http://localhost:5173</strong></p>
<a class="btn" href="/docs">📋 Dokumentacja API</a>
<a class="btn sec" href="/health">❤️ Health check</a>
</body></html>"""
    return HTMLResponse(html)

@app.get("/favicon.ico")
def favicon():
    from fastapi.responses import Response
    ico = bytes([
        0,0,1,0,1,0,1,1,0,0,1,0,24,0,
        40,0,0,0,0,0,0,0,1,0,24,0,0,0,
        0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,37,99,235,37,99,235,
        37,99,235,37,99,235,0,0,0,0
    ])
    return Response(content=ico, media_type="image/x-icon")

@app.get("/api/health")
@app.get("/health")
def health():
    try:
        conn = get_conn()
        conn.close()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "time": now_iso(),
        "version": "1.0.0"
    }

# ─── Dostawcy ─────────────────────────────────────────────────
class SupplierCreate(BaseModel):
    name: str; code: str = ""; nip: str = ""; vet_number: str = ""
    contact_name: str = ""; phone: str = ""; email: str = ""

@app.get("/api/suppliers")
def list_suppliers():
    return query_all("SELECT * FROM suppliers WHERE active = true ORDER BY name")

@app.post("/api/suppliers")
def create_supplier(dto: SupplierCreate):
    seq = next_seq('supplier_seq')
    code = dto.code or f"D-{str(seq).zfill(3)}"
    row = execute_returning("""
        INSERT INTO suppliers (id, code, name, nip, vet_number, contact_name, phone, email, active, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,true,%s) RETURNING *
    """, (cuid(), code, dto.name, dto.nip, dto.vet_number, dto.contact_name, dto.phone, dto.email, now_iso()))
    return row

@app.put("/api/suppliers/{id}")
def update_supplier(id: str, dto: SupplierCreate):
    row = execute_returning("""
        UPDATE suppliers SET name=%s, nip=%s, vet_number=%s,
        contact_name=%s, phone=%s, email=%s WHERE id=%s RETURNING *
    """, (dto.name, dto.nip, dto.vet_number, dto.contact_name, dto.phone, dto.email, id))
    if not row: raise HTTPException(404, "Dostawca nie znaleziony")
    return row

# ─── Partie ćwiartek ──────────────────────────────────────────
# Model akceptuje oba formaty: camelCase (z frontendu React) i snake_case
class RawBatchCreate(BaseModel):
    model_config = {"populate_by_name": True}

    # camelCase (frontend) → snake_case (wewnętrzny)
    supplier_id:       str         = Field("", alias="supplierId")
    supplier_batch_no: str         = Field("", alias="supplierBatchNo")
    slaughter_date:    str         = Field("", alias="slaughterDate")
    received_date:     str         = Field("", alias="receivedDate")
    kg_received:       float       = Field(0,  alias="kgReceived")
    price_per_kg:      float       = Field(0,  alias="pricePerKg")
    expiry_date:       str         = Field("", alias="expiryDate")
    invoice_no:        str         = Field("", alias="invoiceNo")
    notes:             str         = Field("", alias="notes")
    supplier_batches:  List[Any]   = Field([], alias="supplierBatches")

    # Fallback: jeśli frontend wyśle snake_case — też zadziała
    @classmethod
    def model_validate(cls, obj, **kw):
        if isinstance(obj, dict):
            # snake_case fallback — jeśli brakuje alias to spróbuj snake_case
            mapping = {
                "supplierId":      "supplier_id",
                "supplierBatchNo": "supplier_batch_no",
                "slaughterDate":   "slaughter_date",
                "receivedDate":    "received_date",
                "kgReceived":      "kg_received",
                "pricePerKg":      "price_per_kg",
                "expiryDate":      "expiry_date",
                "invoiceNo":       "invoice_no",
                "supplierBatches": "supplier_batches",
            }
            normalized = {}
            for k, v in obj.items():
                normalized[mapping.get(k, k)] = v
            return super().model_validate(normalized, **kw)
        return super().model_validate(obj, **kw)

# BUGFIX #1: next-number MUSI być zdefiniowany PRZED /{id} — inaczej FastAPI
# traktuje "next-number" jako parametr {id} i zwraca 404/błąd.
@app.get("/api/raw-batches/next-number")
def next_batch_number():
    seq_row = query_one("SELECT value FROM sequences WHERE key='batch_seq'")
    next_val = (seq_row['value'] if seq_row else 171) + 1
    # Zwracamy oba formaty żeby obsłużyć stary i nowy adapter frontendu
    return {
        "nextNo": f"R{next_val}",
        "seq": next_val,
        "suggestedBatchNo": f"R{next_val}",
        "suggestedSeq": next_val,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }

@app.get("/api/raw-batches/all")
def list_all_batches():
    return query_all("SELECT * FROM raw_batches ORDER BY internal_batch_seq ASC")

@app.get("/api/raw-batches")
def list_batches(active_only: bool = True, limit: int = 25):
    sql = "SELECT * FROM raw_batches"
    if active_only:
        sql += " WHERE status = 'active'"
    sql += f" ORDER BY internal_batch_seq ASC LIMIT {limit}"
    return {"data": query_all(sql), "total": None}

@app.post("/api/raw-batches")
def create_batch(dto: RawBatchCreate):
    seq = next_seq('batch_seq')
    sup = query_one("SELECT * FROM suppliers WHERE id = %s", (dto.supplier_id,))
    row = execute_returning("""
        INSERT INTO raw_batches
        (id, internal_batch_no, internal_batch_seq, supplier_id, supplier_name,
         supplier_batch_no, slaughter_date, received_date, kg_received, kg_available,
         price_per_kg, expiry_date, status, notes, invoice_no, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s) RETURNING *
    """, (cuid(), f"R{seq}", seq, dto.supplier_id, sup['name'] if sup else '',
          dto.supplier_batch_no,
          dto.slaughter_date or None, dto.received_date or None,
          dto.kg_received, dto.kg_received,  # kg_available = kg_received od razu
          dto.price_per_kg,
          dto.expiry_date or None, dto.notes,
          dto.invoice_no or None, now_iso()))
    return row

@app.get("/api/raw-batches/{id}/history")
def batch_history(id: str):
    return query_all("SELECT * FROM raw_batch_history WHERE batch_id=%s ORDER BY created_at DESC", (id,))

@app.patch("/api/raw-batches/{id}/cancel")
def cancel_batch(id: str):
    row = execute_returning("UPDATE raw_batches SET status='cancelled' WHERE id=%s RETURNING *", (id,))
    if not row: raise HTTPException(404)
    return row

@app.put("/api/raw-batches/{id}")
def update_batch(id: str, body: dict):
    row = execute_returning("""
        UPDATE raw_batches SET supplier_batch_no=%s, slaughter_date=%s,
        received_date=%s, kg_received=%s, price_per_kg=%s,
        expiry_date=%s, notes=%s WHERE id=%s RETURNING *
    """, (_b(body,'supplier_batch_no'), _b(body,'slaughter_date') or None,
          _b(body,'received_date') or None, _b(body,'kg_received', 0),
          _b(body,'price_per_kg', 0), _b(body,'expiry_date') or None,
          body.get('notes'), id))
    if not row: raise HTTPException(404)
    return row

# ─── Mięso Z/S (meat stock) ───────────────────────────────────
@app.get("/api/meat-stock")
def list_meat():
    return {"data": query_all("""
        SELECT m.*, b.internal_batch_no, b.supplier_name, b.slaughter_date as batch_slaughter_date
        FROM meat_stock m
        LEFT JOIN raw_batches b ON b.id = m.raw_batch_id
        WHERE m.kg_available > 0
        ORDER BY m.expiry_date ASC, m.lot_no ASC
    """)}

# ─── Kontrahenci ──────────────────────────────────────────────
class ClientCreate(BaseModel):
    name: str; nip: str = ""; regon: str = ""; address: str = ""
    city: str = ""; contact_name: str = ""; phone: str = ""; email: str = ""

@app.get("/api/clients")
def list_clients():
    return query_all("SELECT * FROM clients WHERE active = true ORDER BY name")

@app.post("/api/clients")
def create_client(dto: ClientCreate):
    seq = next_seq('client_seq')
    row = execute_returning("""
        INSERT INTO clients (id, code, name, nip, regon, address, city, contact_name, phone, email, active, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,%s) RETURNING *
    """, (cuid(), f"KLI-{str(seq).zfill(3)}", dto.name, dto.nip, dto.regon,
          dto.address, dto.city, dto.contact_name, dto.phone, dto.email, now_iso()))
    return row

@app.put("/api/clients/{id}")
def update_client(id: str, dto: ClientCreate):
    row = execute_returning("""
        UPDATE clients SET name=%s, nip=%s, regon=%s, address=%s, city=%s,
        contact_name=%s, phone=%s, email=%s WHERE id=%s RETURNING *
    """, (dto.name, dto.nip, dto.regon, dto.address, dto.city,
          dto.contact_name, dto.phone, dto.email, id))
    if not row: raise HTTPException(404, "Klient nie znaleziony")
    return row

@app.patch("/api/clients/{id}/deactivate")
def deactivate_client(id: str):
    execute("UPDATE clients SET active=false WHERE id=%s", (id,))
    return {"ok": True}

# ─── Receptury ────────────────────────────────────────────────
# BUGFIX #3: RecipeIngredientDto przyjmuje camelCase z frontendu (ingredientId, qtyPer100kg)
class RecipeIngredientDto(BaseModel):
    model_config = {"populate_by_name": True}
    ingredient_id:   str   = Field("", alias="ingredientId")
    ingredient_name: str   = Field("", alias="ingredientName")
    unit:            str   = Field("kg", alias="unit")
    qty_per_100kg:   float = Field(0,  alias="qtyPer100kg")

class RecipeCreate(BaseModel):
    model_config = {"populate_by_name": True}
    name:                   str   = ""
    product_type_id:        str   = Field("", alias="productTypeId")
    product_type_name:      str   = Field("", alias="productTypeName")
    total_output_per_100kg: float = Field(100, alias="totalOutputPer100kg")
    notes:                  str   = ""
    ingredients: List[RecipeIngredientDto]

def _enrich_ingredient(ing: RecipeIngredientDto) -> tuple:
    """Uzupełnia ingredient_name i unit z bazy danych jeśli puste."""
    ing_name = ing.ingredient_name
    ing_unit = ing.unit
    if not ing_name or not ing_unit or ing_unit == "kg":
        db_ing = query_one("SELECT name, unit FROM ingredients WHERE id=%s", (ing.ingredient_id,))
        if db_ing:
            ing_name = db_ing['name']
            ing_unit = db_ing['unit']
    return ing_name, ing_unit

@app.get("/api/recipes")
def list_recipes():
    recipes = query_all("SELECT * FROM recipes WHERE active = true ORDER BY name")
    for r in recipes:
        # BUGFIX: JOIN z ingredients zeby pobrac is_unlimited (woda nieskonczona)
        r['ingredients'] = query_all("""
            SELECT ri.*, COALESCE(i.is_unlimited, false) as is_unlimited
            FROM recipe_ingredients ri
            LEFT JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = %s
        """, (r['id'],))
    return recipes

@app.post("/api/recipes")
def create_recipe(dto: RecipeCreate):
    # Uzysk = 100 kg mięsa + suma składników (woda, przyprawy, dodatki funkcyjne dodają masę)
    auto_output = round(100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3)
    row = execute_returning("""
        INSERT INTO recipes (id, name, product_type_id, product_type_name, total_output_per_100kg, active, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,true,%s,%s) RETURNING *
    """, (cuid(), dto.name, dto.product_type_id or None, dto.product_type_name,
          auto_output, dto.notes or None, now_iso()))
    for ing in dto.ingredients:
        ing_name, ing_unit = _enrich_ingredient(ing)
        execute("""
            INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (cuid(), row['id'], ing.ingredient_id, ing_name, ing_unit, ing.qty_per_100kg))
    row['ingredients'] = query_all("""
        SELECT ri.*, COALESCE(i.is_unlimited, false) as is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
    """, (row['id'],))
    return row

@app.put("/api/recipes/{id}")
def update_recipe(id: str, dto: RecipeCreate):
    # Uzysk przeliczany automatycznie przy każdej edycji receptury
    auto_output = round(100.0 + sum(float(ing.qty_per_100kg) for ing in dto.ingredients), 3)
    execute("""
        UPDATE recipes SET name=%s, product_type_id=%s, product_type_name=%s,
        total_output_per_100kg=%s, notes=%s, updated_at=%s WHERE id=%s
    """, (dto.name, dto.product_type_id or None, dto.product_type_name,
          auto_output, dto.notes or None, now_iso(), id))
    execute("DELETE FROM recipe_ingredients WHERE recipe_id=%s", (id,))
    for ing in dto.ingredients:
        ing_name, ing_unit = _enrich_ingredient(ing)
        execute("""
            INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, ingredient_name, unit, qty_per_100kg)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (cuid(), id, ing.ingredient_id, ing_name, ing_unit, ing.qty_per_100kg))
    row = query_one("SELECT * FROM recipes WHERE id=%s", (id,))
    row['ingredients'] = query_all("""
        SELECT ri.*, COALESCE(i.is_unlimited, false) as is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
    """, (id,))
    return row

@app.patch("/api/recipes/{id}/deactivate")
def deactivate_recipe(id: str):
    execute("UPDATE recipes SET active=false WHERE id=%s", (id,))
    return {"ok": True}

@app.get("/api/recipes/{id}/calculate")
def calculate_recipe(id: str, kg: float = 100):
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (id,))
    if not recipe: raise HTTPException(404)
    ingredients = query_all("SELECT * FROM recipe_ingredients WHERE recipe_id=%s", (id,))
    factor = kg / 100.0
    return {
        "recipe_id": id,
        "kg": kg,
        "ingredients": [
            {**ing, "qty_needed": round(ing['qty_per_100kg'] * factor, 3)}
            for ing in ingredients
        ]
    }

# ─── Składniki (przyprawy) ────────────────────────────────────
# BUGFIX: przyjmuj camelCase isUnlimited z frontendu
class IngredientCreate(BaseModel):
    model_config = {"populate_by_name": True}
    name: str = ""
    unit: str = "kg"
    is_unlimited: bool = Field(False, alias="isUnlimited")
    code: str = ""

@app.get("/api/ingredients")
def list_ingredients():
    return query_all("SELECT * FROM ingredients WHERE active = true ORDER BY name")

@app.get("/api/ingredients/stock")
def ingredient_stock():
    return query_all("""
        SELECT i.*, COALESCE(SUM(s.qty_available), 0) as qty_available_total
        FROM ingredients i
        LEFT JOIN ingredient_stock s ON s.ingredient_id = i.id
        GROUP BY i.id ORDER BY i.name
    """)

@app.post("/api/ingredients")
def create_ingredient(dto: IngredientCreate):
    row = execute_returning(
        "INSERT INTO ingredients (id, code, name, unit, is_unlimited, active, created_at) VALUES (%s,%s,%s,%s,%s,true,%s) RETURNING *",
        (cuid(), dto.code, dto.name, dto.unit, dto.is_unlimited, now_iso()))
    return row

@app.patch("/api/ingredients/{id}/deactivate")
def deactivate_ingredient(id: str):
    execute("UPDATE ingredients SET active=false WHERE id=%s", (id,))
    return {"ok": True}

@app.get("/api/ingredient-receipts")
def list_ingredient_receipts():
    return query_all("SELECT * FROM ingredient_stock ORDER BY created_at DESC")

@app.post("/api/ingredient-receipts")
def create_ingredient_receipt(body: dict):
    row = execute_returning("""
        INSERT INTO ingredient_stock (id, ingredient_id, qty_available, qty_initial, expiry_date, batch_no, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *
    """, (cuid(), _b(body,'ingredient_id'), _b(body,'qty', 0), _b(body,'qty', 0),
          _b(body,'expiry_date') or None, _b(body,'batch_no') or None, now_iso()))
    return row

# ─── Opakowania i tuleje ──────────────────────────────────────
class PackagingReceive(BaseModel):
    name: str; type: str = "tuleja"; unit: str = "szt"; qty: float = 0
    supplier_id: str = ""; expiry_date: str = ""; notes: str = ""

@app.get("/api/packaging")
def list_packaging():
    return query_all("SELECT * FROM packaging WHERE kg_available > 0 ORDER BY name")

@app.get("/api/packaging/all")
def list_all_packaging():
    return query_all("SELECT * FROM packaging ORDER BY created_at DESC")

@app.post("/api/packaging")
def receive_packaging(dto: PackagingReceive):
    existing = query_one("SELECT * FROM packaging WHERE LOWER(name) = LOWER(%s)", (dto.name,))
    if existing:
        execute("""
            UPDATE packaging SET kg_available = kg_available + %s, kg_initial = kg_initial + %s
            WHERE id = %s
        """, (dto.qty, dto.qty, existing['id']))
        return query_one("SELECT * FROM packaging WHERE id = %s", (existing['id'],))
    seq = next_seq('packaging_seq')
    row = execute_returning("""
        INSERT INTO packaging (id, code, name, type, unit, kg_initial, kg_available, kg_used,
        supplier_id, expiry_date, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s) RETURNING *
    """, (cuid(), f"PAK-{str(seq).zfill(3)}", dto.name, dto.type, dto.unit,
          dto.qty, dto.qty, dto.supplier_id or None,
          dto.expiry_date or None, dto.notes, now_iso()))
    return row

@app.patch("/api/packaging/{id}/use")
def use_packaging(id: str, body: dict):
    execute("UPDATE packaging SET kg_available=GREATEST(0,kg_available-%s), kg_used=kg_used+%s WHERE id=%s",
            (body.get('qty', 0), body.get('qty', 0), id))
    return {"ok": True}

# ─── Zamówienia od klientów ───────────────────────────────────
class OrderLineCreate(BaseModel):
    qty: int; kg_per_unit: float; product_type_id: str = ""; product_type_name: str = ""
    recipe_id: str; recipe_name: str = ""; packaging_id: str = ""; packaging_name: str = ""

class ClientOrderCreate(BaseModel):
    client_id: str; order_date: str; delivery_date: str = ""; notes: str = ""
    lines: List[OrderLineCreate]

@app.get("/api/client-orders")
def list_orders(status: str = ""):
    sql = "SELECT * FROM client_orders"
    params = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    orders = query_all(sql, params or None)
    for o in orders:
        o['lines'] = query_all(
            "SELECT * FROM client_order_lines WHERE order_id = %s", (o['id'],))
    return orders

@app.post("/api/client-orders")
def create_order(dto: ClientOrderCreate):
    seq = next_seq('client_order_seq')
    year = datetime.now().year
    client = query_one("SELECT * FROM clients WHERE id = %s", (dto.client_id,))
    if not client: raise HTTPException(404, "Klient nie znaleziony")

    total_kg    = sum(l.qty * l.kg_per_unit for l in dto.lines)
    total_units = sum(l.qty for l in dto.lines)

    order = execute_returning("""
        INSERT INTO client_orders
        (id, order_no, client_id, client_name, order_date, delivery_date,
         total_kg, total_units, status, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'draft',%s,%s) RETURNING *
    """, (cuid(), f"ZAM-{year}-{str(seq).zfill(3)}",
          dto.client_id, client['name'],
          dto.order_date, dto.delivery_date or None,
          round(total_kg, 3), total_units, dto.notes or None, now_iso()))

    for line in dto.lines:
        execute("""
            INSERT INTO client_order_lines
            (id, order_id, qty, kg_per_unit, total_kg,
             product_type_id, product_type_name, recipe_id, recipe_name,
             packaging_id, packaging_name)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (cuid(), order['id'], line.qty, line.kg_per_unit,
              round(line.qty * line.kg_per_unit, 3),
              line.product_type_id, line.product_type_name,
              line.recipe_id, line.recipe_name,
              line.packaging_id or None, line.packaging_name or None))

    order['lines'] = query_all(
        "SELECT * FROM client_order_lines WHERE order_id = %s", (order['id'],))
    return order

@app.patch("/api/client-orders/{id}/status")
def update_order_status(id: str, body: dict):
    row = execute_returning(
        "UPDATE client_orders SET status=%s WHERE id=%s RETURNING *",
        (body['status'], id))
    if not row: raise HTTPException(404)
    return row

@app.delete("/api/client-orders/{id}")
def delete_order(id: str):
    execute("DELETE FROM client_orders WHERE id=%s", (id,))
    return {"ok": True}

# ─── Plany produkcji ──────────────────────────────────────────
# BUGFIX: Frontend wysyla camelCase (recipeId, planDate, kgPerUnit).
class PlanLineCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    qty:               int        = 0
    kg_per_unit:       float      = Field(0,   alias="kgPerUnit")
    product_type_id:   str        = Field("",  alias="productTypeId")
    product_type_name: str        = Field("",  alias="productTypeName")
    recipe_id:         str        = Field("",  alias="recipeId")
    recipe_name:       str        = Field("",  alias="recipeName")
    packaging_id:      str        = Field("",  alias="packagingId")
    packaging_name:    str        = Field("",  alias="packagingName")
    seasoned_batch_id:  str       = Field("",  alias="seasonedBatchId")
    seasoned_batch_no:  str       = Field("",  alias="seasonedBatchNo")
    seasoned_batch_ids: List[str] = Field([],  alias="seasonedBatchIds")
    client_order_id:   str        = Field("",  alias="clientOrderId")
    client_order_no:   str        = Field("",  alias="clientOrderNo")
    client_name:       str        = Field("",  alias="clientName")

class ProductionPlanCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_date: str            = Field("", alias="planDate")
    notes:     str            = ""
    lines:     List[PlanLineCreate] = []

@app.get("/api/production-plans")
def list_plans():
    plans = query_all("SELECT * FROM production_plans ORDER BY created_at DESC")
    for p in plans:
        p['lines'] = query_all(
            "SELECT * FROM production_plan_lines WHERE plan_id = %s", (p['id'],))
    return plans

@app.post("/api/production-plans")
def create_plan(dto: ProductionPlanCreate):
    if not dto.plan_date:
        raise HTTPException(400, "Brak daty planu (planDate)")
    valid_lines = [l for l in dto.lines if l.recipe_id and l.qty > 0 and l.kg_per_unit > 0]
    if not valid_lines:
        raise HTTPException(400, "Brak poprawnych pozycji")

    seq = next_seq('production_plan_seq')
    year = datetime.now().year
    total_kg    = sum(l.qty * l.kg_per_unit for l in valid_lines)
    total_units = sum(l.qty for l in valid_lines)

    plan = execute_returning("""
        INSERT INTO production_plans
        (id, plan_no, plan_date, total_kg, total_units, status, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,'draft',%s,%s) RETURNING *
    """, (cuid(), f"PP-{year}-{str(seq).zfill(3)}",
          dto.plan_date, round(total_kg, 3), total_units,
          dto.notes or None, now_iso()))

    for line in valid_lines:
        line_kg = round(line.qty * line.kg_per_unit, 3)

        # Uzupelnij nazwy z bazy jezeli brak
        recipe_name = line.recipe_name
        product_type_name = line.product_type_name
        if not recipe_name and line.recipe_id:
            r = query_one("SELECT name, product_type_name FROM recipes WHERE id=%s", (line.recipe_id,))
            if r:
                recipe_name = r['name'] or ''
                if not product_type_name:
                    product_type_name = r.get('product_type_name') or ''

        packaging_name = line.packaging_name
        if not packaging_name and line.packaging_id:
            pkg = query_one("SELECT name FROM packaging WHERE id=%s", (line.packaging_id,))
            if pkg:
                packaging_name = pkg['name'] or ''

        # Obsluga wielu partii (seasonedBatchIds)
        all_batch_ids = line.seasoned_batch_ids if line.seasoned_batch_ids else (
            [line.seasoned_batch_id] if line.seasoned_batch_id else []
        )
        primary_batch_id = all_batch_ids[0] if all_batch_ids else None
        primary_batch_no = ""
        if primary_batch_id:
            sb = query_one("SELECT batch_no FROM seasoned_meat WHERE id=%s", (primary_batch_id,))
            if sb:
                primary_batch_no = sb['batch_no'] or ''

        # Zbierz batch_nos i oblicz batch_allocation (ile sztuk z której partii)
        all_batch_nos = []
        batch_allocation: dict = {}
        if all_batch_ids:
            remaining_qty = line.qty
            remaining_kg  = line_kg
            for bid in all_batch_ids:
                if remaining_qty <= 0:
                    break
                sb_row = query_one("SELECT batch_no, kg_available FROM seasoned_meat WHERE id=%s", (bid,))
                if not sb_row:
                    continue
                b_no = sb_row['batch_no']
                kg_av = float(sb_row.get('kg_available') or 0)
                # ile sztuk zmieści się z tego lota
                pcs_from_batch = int(min(remaining_qty, kg_av // line.kg_per_unit)) if line.kg_per_unit > 0 else remaining_qty
                pcs_from_batch = max(0, min(pcs_from_batch, remaining_qty))
                if pcs_from_batch > 0 or b_no not in batch_allocation:
                    all_batch_nos.append(b_no)
                    batch_allocation[b_no] = {
                        "pieces": pcs_from_batch,
                        "kg": round(pcs_from_batch * line.kg_per_unit, 3),
                        "batch_id": bid,
                    }
                    remaining_qty -= pcs_from_batch
                    remaining_kg  -= pcs_from_batch * line.kg_per_unit

        line_id = cuid()
        execute("""
            INSERT INTO production_plan_lines
            (id, plan_id, qty, kg_per_unit, total_kg,
             product_type_id, product_type_name, recipe_id, recipe_name,
             packaging_id, packaging_name, seasoned_batch_id, seasoned_batch_no,
             seasoned_batch_nos, batch_allocation,
             client_order_id, client_order_no, client_name, kg_assigned, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s)
        """, (line_id, plan['id'], line.qty, line.kg_per_unit, line_kg,
              line.product_type_id or None, product_type_name or None,
              line.recipe_id, recipe_name,
              line.packaging_id or None, packaging_name or None,
              primary_batch_id, primary_batch_no or None,
              all_batch_nos,
              json.dumps(batch_allocation),
              line.client_order_id or None, line.client_order_no or None,
              line.client_name or None,
              line_kg if primary_batch_id else 0,
              'assigned' if primary_batch_id else 'pending'))

        # Odejmuj kg ze WSZYSTKICH zaznaczonych partii proporcjonalnie
        if all_batch_ids:
            remaining_kg = line_kg
            for bid in all_batch_ids:
                if remaining_kg <= 0:
                    break
                batch = query_one("SELECT kg_available FROM seasoned_meat WHERE id=%s", (bid,))
                if not batch:
                    continue
                take = min(remaining_kg, float(batch['kg_available']))
                if take > 0:
                    execute("""
                        UPDATE seasoned_meat
                        SET kg_available = GREATEST(0, kg_available - %s),
                            kg_used = kg_used + %s
                        WHERE id = %s
                    """, (round(take, 3), round(take, 3), bid))
                    remaining_kg -= take

    plan['lines'] = query_all(
        "SELECT * FROM production_plan_lines WHERE plan_id = %s", (plan['id'],))
    return plan

@app.patch("/api/production-plans/{id}/status")
def update_plan_status(id: str, body: dict):
    execute("UPDATE production_plans SET status=%s WHERE id=%s", (body['status'], id))
    return {"ok": True}

# ─── Mięso przyprawione ───────────────────────────────────────
# BUGFIX #2: Usunięty duplikat endpointu GET /api/seasoned-meat
# (poprzednio definicja istniała dwukrotnie: linia 442 i 734 — FastAPI
# rejestrował TYLKO pierwszą, druga była martwym kodem).
@app.get("/api/seasoned-meat/all")
def list_all_seasoned():
    return query_all("SELECT * FROM seasoned_meat ORDER BY created_at DESC")

@app.get("/api/seasoned-meat")
def list_seasoned():
    rows = query_all("""
        SELECT * FROM seasoned_meat
        WHERE kg_available > 0 AND status != 'depleted'
        ORDER BY expiry_date ASC, batch_no ASC
    """)
    return {"data": rows}

@app.get("/api/seasoned-meat/{id}/trace")
def seasoned_trace(id: str):
    """Pełny łańcuch traceability dla partii mięsa przyprawionego."""
    batch = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (id,))
    if not batch: raise HTTPException(404)

    # Pobierz zlecenie masowania
    mixing_order = None
    if batch.get('mixing_order_no'):
        mixing_order = query_one("SELECT * FROM mixing_orders WHERE order_no=%s", (batch['mixing_order_no'],))

    # Pobierz loty mięsa (przez zlecenie masowania)
    meat_lots_detail = []
    if mixing_order:
        lots = query_all("""
            SELECT mol.*, ms.lot_no, ms.raw_batch_id, ms.raw_batch_no, ms.expiry_date,
                   ms.deboning_session_id
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
        """, (mixing_order['id'],))
        for lot in lots:
            rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (lot.get('raw_batch_id'),)) if lot.get('raw_batch_id') else None
            sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb['supplier_id'],)) if rb and rb.get('supplier_id') else None
            deb = query_one("SELECT * FROM deboning_entries WHERE id=%s", (lot.get('deboning_session_id'),)) if lot.get('deboning_session_id') else None
            meat_lots_detail.append({
                "meatStockId":   lot.get('meat_stock_id') or '',
                "meatLotNo":     lot.get('lot_no') or '',
                "kgPlanned":     float(lot.get('kg_planned') or 0),
                "kgActual":      float(lot.get('kg_actual') or 0),
                "expiryDate":    str(lot.get('expiry_date') or ''),
                "rawBatch":      rb,
                "supplier":      sup,
                "deboningEntry": _map_deboning_entry(deb) if deb else None,
            })

    # Fallback: stare partie bez mixing_order_lots → szukaj przez source_deboning_ids
    if not meat_lots_detail and batch.get('source_deboning_ids'):
        for deb_id in (batch.get('source_deboning_ids') or []):
            if not deb_id:
                continue
            deb = query_one("SELECT * FROM deboning_entries WHERE id=%s", (deb_id,))
            if not deb:
                continue
            rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (deb.get('raw_batch_id'),)) if deb.get('raw_batch_id') else None
            sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb['supplier_id'],)) if rb and rb.get('supplier_id') else None
            ms = query_one("SELECT * FROM meat_stock WHERE deboning_session_id=%s LIMIT 1", (deb_id,))
            meat_lots_detail.append({
                "meatStockId":   ms['id'] if ms else '',
                "meatLotNo":     ms.get('lot_no') if ms else (deb.get('raw_batch_no') or ''),
                "kgPlanned":     float(deb.get('kg_meat') or 0),
                "kgActual":      float(deb.get('kg_meat') or 0),
                "expiryDate":    str(ms.get('expiry_date') or '') if ms else '',
                "rawBatch":      rb,
                "supplier":      sup,
                "deboningEntry": _map_deboning_entry(deb),
            })

    # Fallback 3: MP{seq} → szukaj raw_batch po internal_batch_seq
    if not meat_lots_detail:
        import re as _re
        mp_match = _re.match(r'^MP(\d+)$', batch.get('batch_no') or '')
        if mp_match:
            raw_seq = int(mp_match.group(1))
            rb = query_one("SELECT * FROM raw_batches WHERE internal_batch_seq=%s", (raw_seq,))
            if rb:
                sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb['supplier_id'],)) if rb.get('supplier_id') else None
                ms = query_one("SELECT * FROM meat_stock WHERE raw_batch_id=%s ORDER BY created_at LIMIT 1", (rb['id'],))
                deb = query_one("SELECT * FROM deboning_entries WHERE raw_batch_id=%s ORDER BY created_at LIMIT 1", (rb['id'],))
                meat_lots_detail.append({
                    "meatStockId":   ms['id'] if ms else '',
                    "meatLotNo":     ms.get('lot_no') if ms else '',
                    "kgPlanned":     float(batch.get('kg_produced') or 0),
                    "kgActual":      float(batch.get('kg_produced') or 0),
                    "expiryDate":    str(ms.get('expiry_date') or '') if ms else '',
                    "rawBatch":      rb,
                    "supplier":      sup,
                    "deboningEntry": _map_deboning_entry(deb) if deb else None,
                })

    # Podsumowanie
    total_raw_kg  = sum(l['kgPlanned'] for l in meat_lots_detail)
    total_meat_kg = float(batch.get('kg_produced') or 0)

    return {
        "seasoned": {
            "id":            batch['id'],
            "batchNo":       batch.get('batch_no') or '',
            "recipeName":    batch.get('recipe_name') or '',
            "mixingOrderNo": batch.get('mixing_order_no') or '',
            "kgProduced":    float(batch.get('kg_produced') or 0),
            "kgAvailable":   float(batch.get('kg_available') or 0),
            "expiryDate":    str(batch.get('expiry_date') or ''),
            "status":        batch.get('status') or '',
            "sourceDeboning": batch.get('source_deboning_ids') or [],
        },
        "mixingOrder": mixing_order,
        "meatLots": meat_lots_detail,
        "summary": {
            "totalRawKg":  round(total_raw_kg, 3),
            "totalMeatKg": round(total_meat_kg, 3),
            "meatLotCount": len(meat_lots_detail),
        }
    }

# ─── Lineage resolver (używany przy zapisie — write-time) ─────
def _resolve_lineage(seasoned_batch_nos: list) -> dict:
    """
    Dla listy batch_no partii przyprawionych zwraca pełny łańcuch lineage:
    {mixing_order_ids, seasoned_meat_ids, deboning_entry_ids, raw_batch_ids, supplier_ids}
    Wywoływany PRZY ZAPISIE (finish_day, production_session), nie przy odczycie.
    """
    mixing_order_ids: list  = []
    seasoned_meat_ids: list = []
    deboning_entry_ids: list = []
    raw_batch_ids: list     = []
    supplier_ids: list      = []

    for bno in (seasoned_batch_nos or []):
        sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (bno,))
        if not sm:
            continue
        if sm['id'] not in seasoned_meat_ids:
            seasoned_meat_ids.append(sm['id'])

        # Źródłowe wpisy rozbioru już zapisane w seasoned_meat
        for did in (sm.get('source_deboning_ids') or []):
            if did not in deboning_entry_ids:
                deboning_entry_ids.append(did)

        # Zlecenie masowania → loty → mięso → rozbiór → surowiec
        mo = query_one("SELECT * FROM mixing_orders WHERE order_no=%s", (sm.get('mixing_order_no'),))
        if mo and mo['id'] not in mixing_order_ids:
            mixing_order_ids.append(mo['id'])
            lots = query_all("""
                SELECT mol.meat_stock_id, ms.raw_batch_id, ms.deboning_session_id
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                WHERE mol.order_id = %s
            """, (mo['id'],))
            for lot in lots:
                if lot.get('deboning_session_id') and lot['deboning_session_id'] not in deboning_entry_ids:
                    deboning_entry_ids.append(lot['deboning_session_id'])
                if lot.get('raw_batch_id') and lot['raw_batch_id'] not in raw_batch_ids:
                    raw_batch_ids.append(lot['raw_batch_id'])
                    rb = query_one("SELECT supplier_id FROM raw_batches WHERE id=%s", (lot['raw_batch_id'],))
                    if rb and rb.get('supplier_id') and rb['supplier_id'] not in supplier_ids:
                        supplier_ids.append(rb['supplier_id'])

    return {
        "mixing_order_ids":   mixing_order_ids,
        "seasoned_meat_ids":  seasoned_meat_ids,
        "deboning_entry_ids": deboning_entry_ids,
        "raw_batch_ids":      raw_batch_ids,
        "supplier_ids":       supplier_ids,
    }

# ─── Uzysk: oblicz kg wyjściowe na podstawie receptury ────────
def _calc_kg_output(recipe_id: str, kg_meat: float) -> float:
    """
    Oblicza uzysk: mięso + składniki w kg/L.
    Pomija składniki w g/ml (np. przyprawy) — te nie wpływają znacząco na masę.
    Woda (is_unlimited=true) zawsze wliczana.
    """
    if not recipe_id or kg_meat <= 0:
        return round(kg_meat, 3)
    ings = query_all("""
        SELECT ri.qty_per_100kg, ri.unit, COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
    """, (recipe_id,))
    additional = sum(
        float(ing.get('qty_per_100kg') or 0) * kg_meat / 100
        for ing in ings
        if (ing.get('unit') or '').lower() in ('kg', 'l') or ing.get('is_unlimited')
    )
    return round(kg_meat + additional, 3)

# ─── Write-time lineage: seasoned_meat ←→ mixing_order ────────
def _populate_seasoned_meat_lineage(batch_no: str, order_id: str) -> None:
    """
    Wywoływana ZAWSZE po utworzeniu/aktualizacji seasoned_meat.
    1. Pobiera source_deboning_ids z meat_stock przez mixing_order_lots.
    2. Zapisuje je na seasoned_meat.source_deboning_ids.
    3. Dodaje batch_no do mixing_orders.source_seasoned_batch_ids.
    Nie ma try/except — błąd tutaj oznacza zerwanie łańcucha i MUSI być widoczny.
    """
    lots = query_all("""
        SELECT mol.meat_stock_id, ms.deboning_session_id, ms.raw_batch_id
        FROM   mixing_order_lots mol
        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
        WHERE  mol.order_id = %s
    """, (order_id,))

    if not lots:
        logger.warning(
            f"_populate_seasoned_meat_lineage: brak lotów dla order_id={order_id} "
            f"(batch_no={batch_no}) — lineage będzie niepełna"
        )

    deboning_ids = list({lt['deboning_session_id'] for lt in lots if lt.get('deboning_session_id')})

    if deboning_ids:
        execute("""
            UPDATE seasoned_meat
            SET source_deboning_ids = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(source_deboning_ids, '{}') || %s::text[]
                ))
            )
            WHERE batch_no = %s
        """, (deboning_ids, batch_no))
    else:
        logger.warning(
            f"_populate_seasoned_meat_lineage: brak deboning_ids dla batch_no={batch_no} "
            f"— meat_stock.deboning_session_id może być NULL"
        )

    # Aktualizuj forward-reference na zleceniu masowania
    execute("""
        UPDATE mixing_orders
        SET source_seasoned_batch_ids = (
            SELECT ARRAY(SELECT DISTINCT unnest(
                COALESCE(source_seasoned_batch_ids, '{}') || ARRAY[%s]
            ))
        )
        WHERE id = %s
    """, (batch_no, order_id))

# ─── Traceability Engine ──────────────────────────────────────
@app.get("/api/traceability")
def traceability(batch_id: str, direction: str = "backward"):
    """
    Pełna traceability dla dowolnego batch_id.
    direction=backward: od gotowego produktu do surowca
    direction=forward:  od surowca do wszystkich produktów
    Nigdy nie zatrzymuje się na seasoned_meat.
    """
    if direction == "forward":
        return _trace_forward(batch_id)
    return _trace_backward(batch_id)

def _seen(lst: list) -> set:
    return {x.get('id') for x in lst if x.get('id')}

def _trace_backward(batch_id: str) -> dict:
    """Od finished_goods / seasoned_meat / raw_batch wstecz do surowca.
    Używa zarówno zapisanej lineage jak i dynamicznej rozdzielczości."""
    result = {
        "rawBatches": [], "deboning": [], "meatLots": [],
        "mixingOrders": [], "seasonedBatches": [], "production": [], "finishedGoods": [],
        "suppliers": [],
    }

    # ── Krok 1: identyfikuj punkt startowy ───────────────────
    fg = query_one("SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s", (batch_id, batch_id))
    if fg:
        if fg['id'] not in _seen(result["finishedGoods"]):
            result["finishedGoods"].append(fg)
        # Przejdź przez zapisane lineage (write-time)
        for mid in (fg.get('source_mixing_ids') or []):
            mo = query_one("SELECT * FROM mixing_orders WHERE id=%s", (mid,))
            if mo and mo['id'] not in _seen(result["mixingOrders"]):
                result["mixingOrders"].append(mo)
        for sid in (fg.get('source_seasoned_ids') or []):
            sm = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (sid,))
            if sm and sm['id'] not in _seen(result["seasonedBatches"]):
                result["seasonedBatches"].append(sm)
        for did in (fg.get('source_deboning_ids') or []):
            de = query_one("SELECT * FROM deboning_entries WHERE id=%s", (did,))
            if de and de['id'] not in _seen(result["deboning"]):
                result["deboning"].append(_map_deboning_entry(de))
        # Fallback: przez seasoned_batch_nos jeśli brak zapisanej lineage
        if not result["seasonedBatches"]:
            for sbn in (fg.get('seasoned_batch_nos') or []):
                sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (sbn,))
                if sm and sm['id'] not in _seen(result["seasonedBatches"]):
                    result["seasonedBatches"].append(sm)

    # ── Krok 2: od seasoned_meat cofnij się do surowca ───────
    # Zbierz seasoned_batches (z FG lub bezpośrednio)
    if not result["seasonedBatches"]:
        sm = query_one("SELECT * FROM seasoned_meat WHERE id=%s OR batch_no=%s", (batch_id, batch_id))
        if sm:
            result["seasonedBatches"].append(sm)

    for sm in list(result["seasonedBatches"]):
        # Mixing order
        mo = None
        if result["mixingOrders"]:
            mo_nos = [m.get('order_no') for m in result["mixingOrders"]]
            if sm.get('mixing_order_no') not in mo_nos:
                mo = query_one("SELECT * FROM mixing_orders WHERE order_no=%s", (sm.get('mixing_order_no'),))
        else:
            mo = query_one("SELECT * FROM mixing_orders WHERE order_no=%s", (sm.get('mixing_order_no'),))
        if mo and mo['id'] not in _seen(result["mixingOrders"]):
            result["mixingOrders"].append(mo)

    # ── Krok 3: od mixing_orders przez loty do surowca ───────
    for mo in list(result["mixingOrders"]):
        lots = query_all("""
            SELECT mol.*, ms.lot_no, ms.raw_batch_id, ms.raw_batch_no, ms.deboning_session_id
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            WHERE mol.order_id = %s
        """, (mo['id'],))
        existing_lot_ids = {x.get('meat_stock_id') for x in result["meatLots"]}
        for lot in lots:
            if lot.get('meat_stock_id') and lot['meat_stock_id'] not in existing_lot_ids:
                result["meatLots"].append(lot)
                existing_lot_ids.add(lot['meat_stock_id'])
            # Rozbiór
            if lot.get('deboning_session_id') and lot['deboning_session_id'] not in _seen(result["deboning"]):
                de = query_one("SELECT * FROM deboning_entries WHERE id=%s", (lot['deboning_session_id'],))
                if de:
                    result["deboning"].append(_map_deboning_entry(de))
            # Surowiec
            if lot.get('raw_batch_id') and lot['raw_batch_id'] not in _seen(result["rawBatches"]):
                rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (lot['raw_batch_id'],))
                if rb:
                    result["rawBatches"].append(rb)
                    sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb.get('supplier_id'),))
                    if sup and sup['id'] not in _seen(result["suppliers"]):
                        result["suppliers"].append(sup)

    return result

def _trace_forward(batch_id: str) -> dict:
    """Od surowca do wszystkich produktów. Nigdy nie zatrzymuje się na seasoned_meat."""
    result = {
        "rawBatches": [], "deboning": [], "meatLots": [],
        "mixingOrders": [], "seasonedBatches": [], "production": [], "finishedGoods": [],
        "suppliers": [],
    }

    # Punkt startowy — partia surowca (po ID lub numerze)
    rb = query_one(
        "SELECT * FROM raw_batches WHERE id=%s OR internal_batch_no=%s",
        (batch_id, batch_id))
    if not rb:
        # Może to być wpis rozbioru?
        de_start = query_one("SELECT * FROM deboning_entries WHERE id=%s", (batch_id,))
        if de_start:
            rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (de_start.get('raw_batch_id'),))
    if not rb:
        return result

    result["rawBatches"].append(rb)
    raw_batch_id = rb['id']

    # Supplier
    sup = query_one("SELECT * FROM suppliers WHERE id=%s", (rb.get('supplier_id'),))
    if sup:
        result["suppliers"].append(sup)

    # Wpisy rozbioru
    entries = query_all("SELECT * FROM deboning_entries WHERE raw_batch_id=%s", (raw_batch_id,))
    result["deboning"] = [_map_deboning_entry(e) for e in entries]

    # Stany mięsa z tej partii
    meat_stocks = query_all("SELECT * FROM meat_stock WHERE raw_batch_id=%s", (raw_batch_id,))
    for ms in meat_stocks:
        lots = query_all(
            "SELECT * FROM mixing_order_lots WHERE meat_stock_id=%s", (ms['id'],))
        for lot in lots:
            mo = query_one("SELECT * FROM mixing_orders WHERE id=%s", (lot.get('order_id'),))
            if not mo or mo['id'] in _seen(result["mixingOrders"]):
                continue
            result["mixingOrders"].append(mo)

            # Partie przyprawione (zapisane w mixing_order.source_seasoned_batch_ids)
            sbn_list = list(mo.get('source_seasoned_batch_ids') or [])
            # Fallback: szukaj seasoned_meat po mixing_order_no
            if not sbn_list:
                sms_fb = query_all(
                    "SELECT * FROM seasoned_meat WHERE mixing_order_no=%s",
                    (mo.get('order_no'),))
                sbn_list = [s.get('batch_no') for s in sms_fb if s.get('batch_no')]

            for sbn in sbn_list:
                sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (sbn,))
                if sm and sm['id'] not in _seen(result["seasonedBatches"]):
                    result["seasonedBatches"].append(sm)
                    # → Wyroby gotowe przez seasoned_batch_nos
                    fgs = query_all(
                        "SELECT * FROM finished_goods WHERE %s = ANY(seasoned_batch_nos)",
                        (sbn,))
                    for fg in fgs:
                        if fg['id'] not in _seen(result["finishedGoods"]):
                            result["finishedGoods"].append(fg)

            # Fallback: szukaj finished_goods przez source_mixing_ids
            if not result["finishedGoods"]:
                fgs_fb = query_all(
                    "SELECT * FROM finished_goods WHERE %s = ANY(source_mixing_ids)",
                    (mo['id'],))
                for fg in fgs_fb:
                    if fg['id'] not in _seen(result["finishedGoods"]):
                        result["finishedGoods"].append(fg)

    return result

# ─── Admin: naprawa lineage dla istniejących rekordów ─────────
@app.post("/api/admin/repair-lineage")
def repair_lineage():
    """
    Backfill source_deboning_ids na seasoned_meat oraz source_* na finished_goods
    dla rekordów stworzonych przed wdrożeniem traceability v3.
    Bezpieczne — nie nadpisuje istniejących danych, tylko uzupełnia puste.
    """
    fixed_seasoned = 0
    fixed_finished = 0
    errors = []

    # ── 1. Napraw seasoned_meat ───────────────────────────────
    batches = query_all(
        "SELECT * FROM seasoned_meat WHERE source_deboning_ids = '{}' OR source_deboning_ids IS NULL")
    for sm in batches:
        try:
            mo = query_one("SELECT * FROM mixing_orders WHERE order_no=%s",
                           (sm.get('mixing_order_no'),))
            if not mo:
                continue
            lots = query_all("""
                SELECT mol.meat_stock_id, ms.deboning_session_id, ms.raw_batch_id
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                WHERE mol.order_id = %s
            """, (mo['id'],))
            deboning_ids = list({lt['deboning_session_id']
                                 for lt in lots if lt.get('deboning_session_id')})
            if deboning_ids:
                execute("""
                    UPDATE seasoned_meat
                    SET source_deboning_ids = %s::text[]
                    WHERE id = %s AND (source_deboning_ids = '{}' OR source_deboning_ids IS NULL)
                """, (deboning_ids, sm['id']))
                fixed_seasoned += 1
            # Też zaktualizuj forward-ref na mixing_order
            execute("""
                UPDATE mixing_orders
                SET source_seasoned_batch_ids = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(source_seasoned_batch_ids,'{}') || ARRAY[%s]
                    ))
                )
                WHERE id = %s
            """, (sm['batch_no'], mo['id']))
        except Exception as e:
            errors.append(f"seasoned_meat {sm.get('batch_no')}: {e}")

    # ── 2. Napraw finished_goods ──────────────────────────────
    fgs = query_all("""
        SELECT * FROM finished_goods
        WHERE (source_mixing_ids = '{}' OR source_mixing_ids IS NULL)
          AND seasoned_batch_nos IS NOT NULL
          AND array_length(seasoned_batch_nos, 1) > 0
    """)
    for fg in fgs:
        try:
            lin = _resolve_lineage(fg.get('seasoned_batch_nos') or [])
            if not lin['mixing_order_ids'] and not lin['deboning_entry_ids']:
                continue
            execute("""
                UPDATE finished_goods
                SET source_mixing_ids   = %s::text[],
                    source_seasoned_ids = %s::text[],
                    source_deboning_ids = %s::text[]
                WHERE id = %s
            """, (lin['mixing_order_ids'], lin['seasoned_meat_ids'],
                  lin['deboning_entry_ids'], fg['id']))
            fixed_finished += 1
        except Exception as e:
            errors.append(f"finished_goods {fg.get('batch_no')}: {e}")

    return {
        "fixed_seasoned_meat": fixed_seasoned,
        "fixed_finished_goods": fixed_finished,
        "errors": errors,
        "total_seasoned_checked": len(batches),
        "total_finished_checked": len(fgs),
    }

# ─── Admin: przelicz total_output_per_100kg dla wszystkich receptur ───
@app.post("/api/admin/recalculate-recipe-yields")
def recalculate_recipe_yields():
    """
    Przelicza total_output_per_100kg dla wszystkich receptur na podstawie składników.
    Uruchom raz po wdrożeniu auto-yield.
    """
    recipes = query_all("SELECT * FROM recipes")
    updated = 0
    for r in recipes:
        ings = query_all("SELECT qty_per_100kg FROM recipe_ingredients WHERE recipe_id=%s", (r['id'],))
        auto_output = round(100.0 + sum(float(i.get('qty_per_100kg') or 0) for i in ings), 3)
        if abs(auto_output - float(r.get('total_output_per_100kg') or 100)) > 0.01:
            execute("UPDATE recipes SET total_output_per_100kg=%s WHERE id=%s",
                    (auto_output, r['id']))
            updated += 1
    return {"updated_recipes": updated, "total": len(recipes)}

# ─── Debug: weryfikacja pełnego łańcucha dla wyrobu gotowego ──
@app.get("/api/debug/trace/{finished_good_id}")
def debug_trace(finished_good_id: str):
    """
    Zwraca pełny łańcuch traceability dla wyrobu gotowego.
    Używaj do weryfikacji kompletności danych — nie do produkcji.
    Odpowiedź: {finished, deboning, seasoned, mixing, missing_links}
    """
    fg = query_one(
        "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s",
        (finished_good_id, finished_good_id))
    if not fg:
        raise HTTPException(404, "Wyrób gotowy nie znaleziony")

    # Rozbiór — ze stored lineage
    deboning: list = []
    for did in (fg.get('source_deboning_ids') or []):
        de = query_one("SELECT * FROM deboning_entries WHERE id=%s", (did,))
        if de:
            deboning.append(_map_deboning_entry(de))

    # Partie zamarynowane — ze stored lineage
    seasoned: list = []
    for sid in (fg.get('source_seasoned_ids') or []):
        sm = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (sid,))
        if sm:
            seasoned.append(sm)
    # Fallback: przez seasoned_batch_nos jeśli stored IDs brakuje
    if not seasoned and fg.get('seasoned_batch_nos'):
        for bno in (fg['seasoned_batch_nos'] or []):
            sm = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (bno,))
            if sm and sm['id'] not in {s['id'] for s in seasoned}:
                seasoned.append(sm)

    # Zlecenia masowania — ze stored lineage
    mixing: list = []
    for mid in (fg.get('source_mixing_ids') or []):
        mo = query_one("SELECT * FROM mixing_orders WHERE id=%s", (mid,))
        if mo:
            mixing.append(build_mixing_order(mo))

    # Partie surowca — przez deboning → raw_batches
    raw_batches: list = []
    seen_rb: set = set()
    for de in deboning:
        rb_id = de.get('rawBatchId') or de.get('raw_batch_id')
        if rb_id and rb_id not in seen_rb:
            seen_rb.add(rb_id)
            rb = query_one("SELECT * FROM raw_batches WHERE id=%s", (rb_id,))
            if rb:
                raw_batches.append(rb)

    missing_links = {
        "has_seasoned_batch_nos":    bool(fg.get('seasoned_batch_nos')),
        "has_source_seasoned_ids":   bool(fg.get('source_seasoned_ids')),
        "has_source_mixing_ids":     bool(fg.get('source_mixing_ids')),
        "has_source_deboning_ids":   bool(fg.get('source_deboning_ids')),
        "deboning_resolved":         bool(deboning),
        "seasoned_resolved":         bool(seasoned),
        "mixing_resolved":           bool(mixing),
        "raw_batches_resolved":      bool(raw_batches),
    }
    chain_complete = all([
        missing_links["has_seasoned_batch_nos"],
        missing_links["seasoned_resolved"],
        missing_links["deboning_resolved"],
    ])

    return {
        "finished":      fg,
        "deboning":      deboning,
        "seasoned":      seasoned,
        "mixing":        mixing,
        "raw_batches":   raw_batches,
        "chain_complete": chain_complete,
        "missing_links": missing_links,
    }

# ─── Recall (Wycofanie partii) ────────────────────────────────
@app.get("/api/recall/{batch_id}")
def recall(batch_id: str):
    """
    Pełny recall dla dowolnego batch_id.
    Zwraca ustrukturyzowaną odpowiedź z timeline i dokumentami.
    """
    # ── 1. Wykryj typ i zbuduj trace ─────────────────────────
    trace: dict = {
        "rawBatches": [], "deboning": [], "meatLots": [],
        "mixingOrders": [], "seasonedBatches": [], "production": [], "finishedGoods": [],
        "suppliers": [],
    }

    fg_direct = query_one(
        "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s", (batch_id, batch_id))
    if fg_direct:
        trace = _trace_backward(fg_direct['id'])
        if not trace["finishedGoods"]:
            trace["finishedGoods"] = [fg_direct]
    else:
        sm_direct = query_one(
            "SELECT * FROM seasoned_meat WHERE id=%s OR batch_no=%s", (batch_id, batch_id))
        if sm_direct:
            sbn = sm_direct.get('batch_no') or batch_id
            fgs = query_all(
                "SELECT * FROM finished_goods WHERE %s = ANY(seasoned_batch_nos)", (sbn,))
            if fgs:
                for fg in fgs:
                    sub = _trace_backward(fg['id'])
                    for k in trace:
                        seen = _seen(trace[k])
                        for item in sub[k]:
                            if item.get('id') not in seen:
                                trace[k].append(item)
                                seen.add(item.get('id'))
            else:
                trace = _trace_backward(sbn)
        else:
            rb_direct = query_one(
                "SELECT * FROM raw_batches WHERE id=%s OR internal_batch_no=%s",
                (batch_id, batch_id))
            if rb_direct:
                trace = _trace_forward(rb_direct['id'])
                if not trace["rawBatches"]:
                    trace["rawBatches"] = [rb_direct]
            else:
                # Może to lot_no z meat_stock?
                ms_direct = query_one(
                    "SELECT * FROM meat_stock WHERE lot_no=%s OR id=%s",
                    (batch_id, batch_id))
                if ms_direct and ms_direct.get('raw_batch_id'):
                    trace = _trace_forward(ms_direct['raw_batch_id'])

    # ── 2. Sumaryczne metryki ─────────────────────────────────
    total_kg    = round(sum(float(fg.get('total_kg') or 0)   for fg in trace["finishedGoods"]), 3)
    total_units = sum(int(fg.get('qty') or 0)                 for fg in trace["finishedGoods"])

    # Rozbiór — sumy kg_meat / kg_bones / kg_backs z wpisów rozbioru
    deboning_summary = {
        "totalKgMeat":  round(sum(float(d.get('kgMeat')  or 0) for d in trace["deboning"]), 3),
        "totalKgBones": round(sum(float(d.get('kgBones') or 0) for d in trace["deboning"]), 3),
        "totalKgBacks": round(sum(float(d.get('kgBacks') or 0) for d in trace["deboning"]), 3),
        "entryCount":   len(trace["deboning"]),
    }

    # ── 3. Klienci ────────────────────────────────────────────
    clients: list = []
    seen_c: set   = set()
    for fg in trace["finishedGoods"]:
        cn = fg.get('client_name')
        key = f"{cn}||{fg.get('client_order_no')}"
        if cn and key not in seen_c:
            seen_c.add(key)
            clients.append({
                "clientName":    cn,
                "clientOrderNo": fg.get('client_order_no'),
                "qty":           int(fg.get('qty') or 0),
                "totalKg":       float(fg.get('total_kg') or 0),
                "producedDate":  str(fg.get('produced_date') or ''),
                "batchNo":       fg.get('batch_no'),
            })

    # ── 4. Timeline (zdarzenia chronologicznie) ───────────────
    timeline: list = []
    for rb in trace["rawBatches"]:
        timeline.append({
            "stage":     "Przyjęcie surowca",
            "batchNo":   rb.get('internal_batch_no'),
            "date":      str(rb.get('received_date') or rb.get('created_at') or ''),
            "details":   f"{rb.get('supplier_name','?')} · {rb.get('kg_received',0)} kg",
        })
    for de in trace["deboning"]:
        timeline.append({
            "stage":   "Rozbiór",
            "batchNo": de.get('rawBatchNo'),
            "date":    str(de.get('createdAt') or ''),
            "details": f"Mięso: {de.get('kgMeat',0)} kg · Wydajność: {de.get('yieldPct',0)}%",
        })
    for sm in trace["seasonedBatches"]:
        timeline.append({
            "stage":   "Masowanie",
            "batchNo": sm.get('batch_no'),
            "date":    str(sm.get('created_at') or ''),
            "details": f"{sm.get('recipe_name','?')} · {sm.get('kg_produced',0)} kg",
        })
    for fg in trace["finishedGoods"]:
        timeline.append({
            "stage":   "Wyrób gotowy",
            "batchNo": fg.get('batch_no'),
            "date":    str(fg.get('produced_date') or fg.get('created_at') or ''),
            "details": f"{fg.get('qty',0)} szt · {fg.get('total_kg',0)} kg → {fg.get('client_name','?')}",
        })
    timeline.sort(key=lambda x: x.get('date') or '')

    # ── 5. Dokumenty (faktury, zamówienia) ────────────────────
    documents: list = []
    rb_ids = [rb['id'] for rb in trace["rawBatches"] if rb.get('id')]
    if rb_ids:
        invs = query_all(
            "SELECT invoice_no, invoice_date, total_gross, category FROM invoices "
            "WHERE raw_batch_id = ANY(%s::text[])",
            (rb_ids,))
        for inv in invs:
            if inv.get('invoice_no'):
                documents.append({
                    "type":   "Faktura zakupowa",
                    "number": inv.get('invoice_no'),
                    "date":   str(inv.get('invoice_date') or ''),
                    "value":  float(inv.get('total_gross') or 0),
                })
    for fg in trace["finishedGoods"]:
        if fg.get('client_order_no'):
            documents.append({
                "type":   "Zamówienie klienta",
                "number": fg.get('client_order_no'),
                "date":   str(fg.get('produced_date') or ''),
                "value":  float(fg.get('total_kg') or 0),
            })

    return {
        "batchId":         batch_id,
        # Dane szczegółowe wg etapu
        "raw_batches":     trace["rawBatches"],
        "deboning":        trace["deboning"],
        "deboning_summary": deboning_summary,
        "seasoned":        trace["seasonedBatches"],
        "mixing_orders":   trace["mixingOrders"],
        "production":      trace["production"],
        "finished":        trace["finishedGoods"],
        "clients":         clients,
        "suppliers":       trace["suppliers"],
        # Sumaryczne metryki
        "total_kg":        total_kg,
        "total_units":     total_units,
        # Chronologiczny przebieg
        "timeline":        timeline,
        # Dokumenty powiązane
        "documents":       documents,
    }

# ─── Wyroby gotowe ────────────────────────────────────────────
class FinishDayEntry(BaseModel):
    model_config = {"populate_by_name": True}
    plan_line_id:      str       = Field("",  alias="planLineId")
    qty:               int       = 0
    worker_names:      List[str] = Field([], alias="workerNames")
    kg_per_unit:       float     = Field(0,   alias="kgPerUnit")
    product_type_id:   str       = Field("",  alias="productTypeId")
    product_type_name: str       = Field("",  alias="productTypeName")
    recipe_id:         str       = Field("",  alias="recipeId")
    recipe_name:       str       = Field("",  alias="recipeName")
    packaging_id:      str       = Field("",  alias="packagingId")
    packaging_name:    str       = Field("",  alias="packagingName")
    client_order_id:   str       = Field("",  alias="clientOrderId")
    client_order_no:   str       = Field("",  alias="clientOrderNo")
    client_name:       str       = Field("",  alias="clientName")
    seasoned_batch_nos: List[str] = Field([], alias="seasonedBatchNos")

class FinishDayDto(BaseModel):
    model_config = {"populate_by_name": True}
    plan_id:  str               = Field("", alias="planId")
    entries:  List[FinishDayEntry] = []

@app.get("/api/finished-goods")
def list_finished():
    items = query_all("SELECT * FROM finished_goods ORDER BY created_at DESC")
    for item in items:
        item['sub_entries'] = query_all(
            "SELECT * FROM finished_goods_sessions WHERE goods_id = %s ORDER BY added_at",
            (item['id'],))
    return items

@app.post("/api/finished-goods")
def create_finished_good(body: dict):
    seq = next_seq('finished_goods_seq')
    default_batch_no = f"P{seq}"
    item = execute_returning("""
        INSERT INTO finished_goods
        (id, batch_no, plan_no, product_type_id, product_type_name,
         recipe_id, recipe_name, packaging_id, packaging_name,
         client_name, client_order_no, qty, kg_per_unit, total_kg,
         qty_available, qty_shipped, produced_date, produced_by,
         seasoned_batch_nos, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
        RETURNING *
    """, (cuid(), _b(body,'batch_no', default_batch_no), _b(body,'plan_no', ''),
          _b(body,'product_type_id', ''), _b(body,'product_type_name', ''),
          _b(body,'recipe_id', ''), _b(body,'recipe_name', ''),
          _b(body,'packaging_id') or None, _b(body,'packaging_name') or None,
          _b(body,'client_name') or None, _b(body,'client_order_no') or None,
          _b(body,'qty', 0), _b(body,'kg_per_unit', 0), _b(body,'total_kg', 0),
          _b(body,'qty', 0), _b(body,'produced_date', datetime.now().date().isoformat()),
          _b(body,'produced_by', []), _b(body,'seasoned_batch_nos', []), now_iso()))
    return item

@app.post("/api/finished-goods/finish-day")
def finish_day(dto: FinishDayDto):
    plan = query_one("SELECT * FROM production_plans WHERE id = %s", (dto.plan_id,))
    if not plan: raise HTTPException(404, "Plan nie znaleziony")

    today = datetime.now().date().isoformat()
    created = []

    for entry in dto.entries:
        if entry.qty <= 0: continue
        total_kg = round(entry.qty * entry.kg_per_unit, 3)

        # Walidacja lineage: wyrób gotowy musi być powiązany z partiami zamarynowanymi
        if not entry.seasoned_batch_nos:
            logger.warning(
                f"finish_day: entry plan_line_id={entry.plan_line_id} nie ma seasoned_batch_nos "
                f"— lineage będzie niepełna dla wyrobu gotowego"
            )

        # ── Pełny lineage zapisywany w momencie tworzenia rekordu ──
        lin = _resolve_lineage(entry.seasoned_batch_nos or [])
        src_mixing   = lin.get('mixing_order_ids') or []
        src_seasoned = lin.get('seasoned_meat_ids') or []
        src_deboning = lin.get('deboning_entry_ids') or []

        existing = query_one("""
            SELECT * FROM finished_goods
            WHERE produced_date = %s
              AND recipe_id = %s
              AND COALESCE(packaging_id,'') = %s
              AND COALESCE(client_name,'') = %s
              AND kg_per_unit = %s
        """, (today, entry.recipe_id,
              entry.packaging_id or '',
              entry.client_name or '',
              entry.kg_per_unit))

        if existing:
            execute("""
                UPDATE finished_goods
                SET qty = qty + %s,
                    total_kg = total_kg + %s,
                    qty_available = qty_available + %s,
                    produced_by = array_cat(produced_by, %s::text[]),
                    seasoned_batch_nos = (
                        SELECT ARRAY(SELECT DISTINCT unnest(
                            seasoned_batch_nos || %s::text[]
                        ))
                    ),
                    source_mixing_ids = (
                        SELECT ARRAY(SELECT DISTINCT unnest(
                            COALESCE(source_mixing_ids, '{}'::text[]) || %s::text[]
                        ))
                    ),
                    source_seasoned_ids = (
                        SELECT ARRAY(SELECT DISTINCT unnest(
                            COALESCE(source_seasoned_ids, '{}'::text[]) || %s::text[]
                        ))
                    ),
                    source_deboning_ids = (
                        SELECT ARRAY(SELECT DISTINCT unnest(
                            COALESCE(source_deboning_ids, '{}'::text[]) || %s::text[]
                        ))
                    )
                WHERE id = %s
            """, (entry.qty, total_kg, entry.qty,
                  entry.worker_names,
                  entry.seasoned_batch_nos,
                  src_mixing, src_seasoned, src_deboning,
                  existing['id']))

            execute("""
                INSERT INTO finished_goods_sessions
                (id, goods_id, plan_line_id, qty, total_kg, seasoned_batch_nos, worker_names, added_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (cuid(), existing['id'], entry.plan_line_id,
                  entry.qty, total_kg,
                  entry.seasoned_batch_nos, entry.worker_names, now_iso()))

            created.append(query_one("SELECT * FROM finished_goods WHERE id=%s", (existing['id'],)))
        else:
            seq = next_seq('finished_goods_seq')
            # P{raw_seq} jeśli z jednej ćwiartki, PP{seq} jeśli z wielu partii
            batch_no = f"PP{seq}"
            if entry.seasoned_batch_nos and len(entry.seasoned_batch_nos) == 1:
                sm_row = query_one("SELECT mixing_order_no FROM seasoned_meat WHERE batch_no=%s",
                                   (entry.seasoned_batch_nos[0],))
                if sm_row and sm_row.get('mixing_order_no'):
                    mo_row = query_one("SELECT id FROM mixing_orders WHERE order_no=%s",
                                       (sm_row['mixing_order_no'],))
                    if mo_row:
                        raw_seqs = query_all("""
                            SELECT DISTINCT rb.internal_batch_seq
                            FROM mixing_order_lots mol
                            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                            WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
                        """, (mo_row['id'],))
                        s = [r['internal_batch_seq'] for r in raw_seqs if r.get('internal_batch_seq')]
                        if len(s) == 1:
                            batch_no = f"P{s[0]}"

            item = execute_returning("""
                INSERT INTO finished_goods
                (id, batch_no, plan_no, product_type_id, product_type_name,
                 recipe_id, recipe_name, packaging_id, packaging_name,
                 client_name, client_order_no, qty, kg_per_unit, total_kg,
                 qty_available, qty_shipped, produced_date, produced_by,
                 seasoned_batch_nos, source_production_id,
                 source_mixing_ids, source_seasoned_ids, source_deboning_ids,
                 created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (cuid(), batch_no, plan['plan_no'],
                  entry.product_type_id, entry.product_type_name,
                  entry.recipe_id, entry.recipe_name,
                  entry.packaging_id or None, entry.packaging_name or None,
                  entry.client_name or None, entry.client_order_no or None,
                  entry.qty, entry.kg_per_unit, total_kg, entry.qty,
                  today, entry.worker_names,
                  entry.seasoned_batch_nos, dto.plan_id,
                  src_mixing, src_seasoned, src_deboning,
                  now_iso()))

            execute("""
                INSERT INTO finished_goods_sessions
                (id, goods_id, plan_line_id, qty, total_kg, seasoned_batch_nos, worker_names, added_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (cuid(), item['id'], entry.plan_line_id,
                  entry.qty, total_kg,
                  entry.seasoned_batch_nos, entry.worker_names, now_iso()))
            created.append(item)

    execute("UPDATE production_plans SET status='done' WHERE id=%s", (dto.plan_id,))
    return {"created": len(created), "items": created}

# ─── Faktury ──────────────────────────────────────────────────
# BUGFIX #1: InvoiceCreate przyjmuje camelCase z frontendu
class InvoiceCreate(BaseModel):
    model_config = {"populate_by_name": True}
    invoice_no:   str   = Field("", alias="invoiceNo")
    supplier_id:  str   = Field("", alias="supplierId")
    category:     str   = ""
    invoice_date: str   = Field("", alias="invoiceDate")
    due_date:     str   = Field("", alias="dueDate")
    qty:          float = 0
    unit_price:   float = Field(0, alias="unitPrice")
    vat_rate:     float = Field(0.05, alias="vatRate")
    notes:        str   = ""
    raw_batch_id: str   = Field("", alias="rawBatchId")
    ingredient_id: str  = Field("", alias="ingredientId")
    packaging_id: str   = Field("", alias="packagingId")
    create_wz:    bool  = Field(False, alias="createWZ")
    expiry_date:  str   = Field("", alias="expiryDate")
    batch_no:     str   = Field("", alias="batchNo")
    # Waluta EUR/PLN
    currency:      str   = "PLN"
    exchange_rate: Optional[float] = Field(None, alias="exchangeRate")
    amount_eur:    Optional[float] = Field(None, alias="amountEur")

@app.get("/api/invoices")
def list_invoices(category: str = ""):
    sql = """
        SELECT i.*, s.name as supplier_name
        FROM invoices i LEFT JOIN suppliers s ON s.id = i.supplier_id
    """
    params = []
    if category:
        sql += " WHERE i.category = %s"
        params.append(category)
    sql += " ORDER BY i.invoice_date DESC"
    return query_all(sql, params or None)

@app.post("/api/invoices")
def create_invoice(dto: InvoiceCreate):
    net   = round(dto.qty * dto.unit_price, 2)
    vat   = round(net * dto.vat_rate, 2)
    gross = round(net + vat, 2)
    amount_eur    = dto.amount_eur
    exchange_rate = dto.exchange_rate
    if dto.currency == 'EUR' and exchange_rate and not amount_eur:
        amount_eur = round(gross / exchange_rate, 2)

    row = execute_returning("""
        INSERT INTO invoices
        (id, invoice_no, supplier_id, category, invoice_date, due_date,
         qty, unit_price, vat_rate, total_net, total_vat, total_gross,
         raw_batch_id, notes, currency, exchange_rate, amount_eur, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
    """, (cuid(), dto.invoice_no, dto.supplier_id, dto.category,
          dto.invoice_date, dto.due_date or None,
          dto.qty, dto.unit_price, dto.vat_rate,
          net, vat, gross,
          dto.raw_batch_id or None, dto.notes or None,
          dto.currency or 'PLN', exchange_rate, amount_eur, now_iso()))

    if dto.create_wz:
        if dto.category == 'OPAKOWANIA_TULEJE' and dto.packaging_id:
            execute("""
                UPDATE packaging
                SET kg_available = kg_available + %s, kg_initial = kg_initial + %s
                WHERE id = %s
            """, (dto.qty, dto.qty, dto.packaging_id))
        elif dto.category == 'PRZYPRAWY_I_DODATKI' and dto.ingredient_id:
            execute("""
                INSERT INTO ingredient_stock
                (id, ingredient_id, qty_available, qty_initial, expiry_date, batch_no, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (cuid(), dto.ingredient_id, dto.qty, dto.qty,
                  dto.expiry_date or None, dto.batch_no or None, now_iso()))

    return row

@app.patch("/api/invoices/{id}")
def update_invoice(id: str, body: dict):
    execute("""
        UPDATE invoices SET invoice_no=%s, category=%s, invoice_date=%s,
        due_date=%s, qty=%s, unit_price=%s, notes=%s WHERE id=%s
    """, (body.get('invoiceNo'), body.get('category'), body.get('invoiceDate'),
          body.get('dueDate') or None, body.get('qty', 0), body.get('unitPrice', 0),
          body.get('notes'), id))
    return query_one("SELECT * FROM invoices WHERE id=%s", (id,))

@app.delete("/api/invoices/{id}")
def delete_invoice(id: str):
    execute("DELETE FROM invoices WHERE id=%s", (id,))
    return {"ok": True}

# ─── Pracownicy ───────────────────────────────────────────────
class WorkerCreate(BaseModel):
    name: str; role: str = "WORKER_PRODUCTION"; pin: str = ""

@app.get("/api/workers")
def list_workers():
    return query_all("SELECT * FROM workers WHERE active = true ORDER BY name")

@app.post("/api/workers")
def create_worker(dto: WorkerCreate):
    row = execute_returning("""
        INSERT INTO workers (id, name, role, pin, active, created_at)
        VALUES (%s,%s,%s,%s,true,%s) RETURNING *
    """, (cuid(), dto.name, dto.role, dto.pin or None, now_iso()))
    return row

# ─── Rodzaje produktów ────────────────────────────────────────
# BUGFIX: przyjmuj components (skład mięsny) i description z frontendu
class ProductTypeCreate(BaseModel):
    model_config = {"populate_by_name": True}
    name:        str  = ""
    description: str  = Field("", alias="description")
    components:  List[Any] = Field([], alias="components")

def _map_product_type(row: dict) -> dict:
    """Zwraca camelCase dla frontendu + zawsze tablicę components."""
    comps = row.get('components') or []
    if isinstance(comps, str):
        try: comps = json.loads(comps)
        except Exception: comps = []
    # Upewnij się że każdy component ma id
    result_comps = []
    for c in comps:
        if isinstance(c, dict):
            result_comps.append({
                "id":         c.get('id', cuid()),
                "name":       c.get('name', ''),
                "pct":        float(c.get('pct', 0)),
                "sourceType": c.get('sourceType', 'meat_stock'),
            })
    return {
        "id":          row['id'],
        "name":        row.get('name', ''),
        "description": row.get('description') or '',
        "components":  result_comps,
        "active":      row.get('active', True),
        "createdAt":   str(row.get('created_at', '')),
    }

@app.get("/api/product-types")
def list_product_types():
    rows = query_all("SELECT * FROM product_types WHERE active = true ORDER BY name")
    return [_map_product_type(r) for r in rows]

@app.post("/api/product-types")
def create_product_type(dto: ProductTypeCreate):
    comps_json = json.dumps([
        {"id": cuid(), "name": c.get('name',''), "pct": c.get('pct',0), "sourceType": c.get('sourceType','meat_stock')}
        for c in dto.components if isinstance(c, dict)
    ])
    row = execute_returning(
        "INSERT INTO product_types (id, name, description, components, active, created_at) VALUES (%s,%s,%s,%s::jsonb,true,%s) RETURNING *",
        (cuid(), dto.name, dto.description or None, comps_json, now_iso()))
    return _map_product_type(row)

@app.put("/api/product-types/{id}")
def update_product_type(id: str, dto: ProductTypeCreate):
    comps_json = json.dumps([
        {"id": c.get('id', cuid()), "name": c.get('name',''), "pct": c.get('pct',0), "sourceType": c.get('sourceType','meat_stock')}
        for c in dto.components if isinstance(c, dict)
    ])
    row = execute_returning(
        "UPDATE product_types SET name=%s, description=%s, components=%s::jsonb WHERE id=%s RETURNING *",
        (dto.name, dto.description or None, comps_json, id))
    if not row: raise HTTPException(404)
    return _map_product_type(row)

@app.patch("/api/product-types/{id}/deactivate")
def deactivate_product_type(id: str):
    execute("UPDATE product_types SET active=false WHERE id=%s", (id,))
    return {"ok": True}

# ─── Sesje produkcyjne (Production Sessions) ─────────────────
# WAŻNE: tabela production_sessions musi istnieć — uruchom: python init_db.py migrate

def _prod_date() -> str:
    """Data produkcyjna: jeśli przed 04:00, to poprzedni dzień."""
    import datetime as dt
    now = dt.datetime.now()
    if now.hour < 4:
        return (now.date() - dt.timedelta(days=1)).isoformat()
    return now.date().isoformat()

def _map_session(row: dict) -> dict:
    """snake_case → camelCase dla ProductionSession"""
    if not row:
        return row
    return {
        "id":          row["id"],
        "sessionDate": str(row["session_date"]) if row.get("session_date") else "",
        "processType": row.get("process_type", "deboning"),
        "status":      row.get("status", "open"),
        "startedAt":   row.get("started_at", "") or "",
        "endedAt":     row.get("ended_at"),
        "approvedBy":  row.get("approved_by"),
        "approvedAt":  row.get("approved_at"),
        "notes":       row.get("notes"),
        "createdAt":   row.get("created_at", "") or "",
    }

@app.get("/api/production-sessions")
def list_production_sessions(type: str = "deboning"):
    rows = query_all(
        "SELECT * FROM production_sessions WHERE process_type=%s ORDER BY created_at DESC",
        (type,))
    return [_map_session(r) for r in rows]

@app.get("/api/production-sessions/active")
def get_active_session(type: str = "deboning"):
    row = query_one(
        "SELECT * FROM production_sessions WHERE process_type=%s AND status='open' ORDER BY created_at DESC LIMIT 1",
        (type,))
    return _map_session(row) if row else None

@app.get("/api/production-sessions/{session_id}")
def get_session_by_id(session_id: str):
    row = query_one("SELECT * FROM production_sessions WHERE id=%s", (session_id,))
    if not row: raise HTTPException(404)
    return _map_session(row)

@app.post("/api/production-sessions")
def start_production_session(body: dict):
    prod_date = _prod_date()
    process_type = body.get("processType", body.get("process_type", "deboning"))
    # Sprawdź czy już jest otwarta sesja tego dnia
    existing = query_one(
        "SELECT * FROM production_sessions WHERE process_type=%s AND session_date=%s AND status='open'",
        (process_type, prod_date))
    if existing:
        return _map_session(existing)
    row = execute_returning("""
        INSERT INTO production_sessions (id, session_date, process_type, status, started_at, created_at)
        VALUES (%s,%s,%s,'open',%s,%s) RETURNING *
    """, (cuid(), prod_date, process_type, now_iso(), now_iso()))
    return _map_session(row)

@app.patch("/api/production-sessions/{session_id}/close")
def close_production_session(session_id: str, body: dict):
    row = execute_returning("""
        UPDATE production_sessions SET status='closed', ended_at=%s, notes=%s
        WHERE id=%s RETURNING *
    """, (now_iso(), body.get("notes"), session_id))
    if not row: raise HTTPException(404)
    return _map_session(row)

@app.patch("/api/production-sessions/{session_id}/approve")
def approve_production_session(session_id: str, body: dict):
    row = execute_returning("""
        UPDATE production_sessions SET status='approved', approved_by=%s, approved_at=%s
        WHERE id=%s RETURNING *
    """, (body.get("approvedBy", "office"), now_iso(), session_id))
    if not row: raise HTTPException(404)
    return _map_session(row)

# ─── Rozbiór (Deboning) ───────────────────────────────────────

def _map_deboning_entry(row: dict) -> dict:
    """snake_case → camelCase dla DeboningEntry"""
    if not row:
        return row
    kg_taken = float(row.get("kg_quarter") or 0)
    kg_meat  = float(row.get("kg_meat") or 0)
    yield_pct = (kg_meat / kg_taken * 100) if kg_taken > 0 else 0
    return {
        "id":          row["id"],
        "sessionId":   row.get("session_id", ""),
        "sessionDate": str(row.get("session_date") or ""),
        "sessionNo":   row.get("session_no", ""),
        "rawBatchId":  row.get("raw_batch_id", ""),
        "rawBatchNo":  row.get("raw_batch_no", ""),
        "workerId":    row.get("worker_id", ""),
        "workerName":  row.get("worker_name", ""),
        "kgTaken":     kg_taken,
        "kgMeat":      kg_meat,
        "kgBacks":     float(row.get("kg_backs") or 0),
        "kgBones":     float(row.get("kg_bones") or 0),
        "kgRemainder": float(row.get("kg_remainder") or 0),
        "yieldPct":    round(yield_pct, 2),
        "meatLotNo":   row.get("meat_lot_no"),
        "createdAt":   str(row.get("created_at") or ""),
    }

@app.get("/api/deboning/entries/trace/{batch_id}")
def deboning_trace(batch_id: str):
    entries = query_all(
        "SELECT * FROM deboning_entries WHERE raw_batch_id=%s ORDER BY created_at DESC",
        (batch_id,))
    return {"data": [_map_deboning_entry(e) for e in entries]}

# BUGFIX: Endpointy /api/deboning/entries/trace/{id} i /api/deboning/entries
# MUSZĄ być przed /api/deboning/{id} — inaczej "entries" jest łapane jako {id}.
@app.get("/api/deboning/entries")
def list_deboning_entries(session_id: str = None):
    if session_id:
        rows = query_all(
            "SELECT * FROM deboning_entries WHERE session_id=%s ORDER BY created_at DESC",
            (session_id,))
    else:
        rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return [_map_deboning_entry(r) for r in rows]

@app.post("/api/deboning/entries")
def create_deboning_entry(body: dict):
    batch = query_one("SELECT * FROM raw_batches WHERE id=%s", (_b(body,'raw_batch_id'),))
    if not batch: raise HTTPException(404, "Partia nie znaleziona")

    # Szukaj nazwy pracownika jezeli podano tylko workerId
    worker_name = _b(body,'worker_name')
    worker_id   = _b(body,'worker_id')
    if worker_id and not worker_name:
        worker = query_one("SELECT name FROM workers WHERE id=%s", (worker_id,))
        if worker:
            worker_name = worker['name']

    # kgTaken / kg_taken / kgQuarter / kg_quarter (różne nazwy historyczne)
    kg_taken = float(_b(body,'kg_taken') or _b(body,'kg_quarter') or 0)
    kg_meat  = float(_b(body,'kg_meat') or 0)
    session_id = _b(body,'session_id')

    # BUGFIX KRYTYCZNY: walidacja po stronie backendu
    # Frontend moze byc pominienty, wiec backend musi sam pilnowac stanow
    kg_available = float(batch.get('kg_available') or batch.get('kg_received') or 0)
    if kg_taken <= 0:
        raise HTTPException(400, "Ilosc pobranej cwwiartki musi byc > 0")
    if kg_meat <= 0:
        raise HTTPException(400, "Ilosc miesa musi byc > 0")
    if kg_meat > kg_taken:
        raise HTTPException(400, f"Mieso ({kg_meat} kg) nie moze przekraczac pobranej cwwiartki ({kg_taken} kg)")
    if kg_taken > kg_available + 0.01:
        raise HTTPException(400, f"Nie mozna pobrac {kg_taken} kg — dostepne tylko {round(kg_available, 2)} kg w partii {batch.get('internal_batch_no', '')}")
    yield_pct_val = (kg_meat / kg_taken) * 100
    if yield_pct_val > 95:
        raise HTTPException(400, f"Wydajnosc {round(yield_pct_val,1)}% jest nierealna — sprawdz dane")
    if yield_pct_val < 30:
        raise HTTPException(400, f"Wydajnosc {round(yield_pct_val,1)}% jest bardzo niska — sprawdz dane")

    kg_remainder = max(0, kg_taken - kg_meat)
    yield_pct    = round(yield_pct_val, 2)

    seq = next_seq('deboning_seq')
    entry_id   = cuid()
    session_no = f"RZB-{str(seq).zfill(3)}"
    meat_lot_no = f"M{batch['internal_batch_seq']}"
    # session_id already extracted above

    entry = execute_returning("""
        INSERT INTO deboning_entries
            (id, raw_batch_id, raw_batch_no, session_id, session_no,
             kg_quarter, kg_meat, kg_remainder, yield_pct, worker_id, worker_name, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
    """, (entry_id, batch['id'], batch['internal_batch_no'], session_id, session_no,
          kg_taken, kg_meat, kg_remainder, yield_pct,
          worker_id, worker_name, now_iso()))

    # Aktualizuj kg_available w partii
    execute("""
        UPDATE raw_batches
        SET kg_available = GREATEST(0, COALESCE(kg_available, kg_received) - %s)
        WHERE id = %s
    """, (kg_taken, batch['id']))

    # Utwórz/zaktualizuj MeatStock
    from datetime import timedelta
    recv = batch.get('received_date')
    if recv:
        exp = (datetime.fromisoformat(str(recv)) + timedelta(days=7)).date().isoformat()
    else:
        exp = batch.get('expiry_date')

    execute("""
        INSERT INTO meat_stock (id, lot_no, deboning_session_id, session_no,
          raw_batch_id, raw_batch_no, kg_initial, kg_available,
          production_date, expiry_date, status, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,CURRENT_DATE,%s,'AVAILABLE',%s)
        ON CONFLICT (lot_no) DO UPDATE
        SET kg_initial = meat_stock.kg_initial + EXCLUDED.kg_initial,
            kg_available = meat_stock.kg_available + EXCLUDED.kg_available
    """, (cuid(), meat_lot_no, entry_id, session_no,
          batch['id'], batch['internal_batch_no'],
          kg_meat, kg_meat, exp, now_iso()))

    return _map_deboning_entry(entry)

@app.patch("/api/deboning/entries/{id}")
def update_deboning_entry(id: str, body: dict):
    # Pobierz aktualny wpis
    existing = query_one("SELECT * FROM deboning_entries WHERE id=%s", (id,))
    if not existing: raise HTTPException(404)

    kg_taken = float(_b(body,'kg_taken') or _b(body,'kg_quarter') or existing.get('kg_quarter') or 0)
    kg_meat  = float(_b(body,'kg_meat')  or existing.get('kg_meat')  or 0)
    kg_backs = float(_b(body,'kg_backs') or existing.get('kg_backs') or 0)
    kg_bones = float(_b(body,'kg_bones') or existing.get('kg_bones') or 0)
    kg_remainder = max(0, kg_taken - kg_meat)
    yield_pct = round((kg_meat / kg_taken * 100) if kg_taken > 0 else 0, 2)

    row = execute_returning("""
        UPDATE deboning_entries
        SET kg_quarter=%s, kg_meat=%s, kg_backs=%s, kg_bones=%s, kg_remainder=%s, yield_pct=%s
        WHERE id=%s RETURNING *
    """, (kg_taken, kg_meat, kg_backs, kg_bones, kg_remainder, yield_pct, id))
    if not row: raise HTTPException(404)
    return _map_deboning_entry(row)

@app.get("/api/deboning")
def list_deboning_sessions():
    rows = query_all("SELECT * FROM deboning_entries ORDER BY created_at DESC")
    return {"data": [_map_deboning_entry(r) for r in rows]}

@app.post("/api/deboning")
def create_deboning_session_alias(body: dict):
    return create_deboning_entry(body)

# ─── Zlecenia masowania (Mixing Orders) ───────────────────────
# Pola dostosowane do frontendu: meat_kg, planned_output_kg, kg_done, kg_remaining
# order_no format: MAS-YYYY-NNN
# meat_lots: meat_lot_id, meat_lot_no, raw_batch_no, kg_planned, expiry_date
# steps: pobierane z recipe_ingredients (ingredient_id, ingredient_name, unit, qty_per_100kg)
# sessions: historia sesji masowania

class MixingLotDto(BaseModel):
    # Akceptuje camelCase (meatLotId) i snake_case (meat_lot_id)
    model_config = {"populate_by_name": True}
    meatLotId: str = Field("", alias="meat_lot_id")
    kgPlanned: float = Field(0, alias="kg_planned")

class MixingOrderCreate(BaseModel):
    # Akceptuje zarówno camelCase (frontend) jak i snake_case
    model_config = {"populate_by_name": True}
    recipe_id:       str = Field("", alias="recipeId")
    product_type_id: Optional[str] = Field(None, alias="productTypeId")
    meat_kg:         float = Field(0, alias="meatKg")
    notes:           Optional[str] = None
    meat_lots:       List[MixingLotDto] = Field([], alias="meatLots")

def build_mixing_order(o: dict) -> dict:
    """Buduje pełny obiekt zlecenia masowania z polami camelCase dla frontendu."""
    oid = o['id']
    meat_lots = query_all("""
        SELECT mol.*, ms.lot_no as meat_lot_no, ms.expiry_date,
               rb.internal_batch_no as raw_batch_no
        FROM mixing_order_lots mol
        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
        LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
        WHERE mol.order_id = %s
    """, (oid,))

    # Pobierz kroki z receptury (recipe_ingredients)
    recipe_id = o.get('recipe_id') or ''
    steps = []
    if recipe_id:
        ings = query_all("""
            SELECT ri.*, i.is_unlimited
            FROM recipe_ingredients ri
            LEFT JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = %s ORDER BY ri.id
        """, (recipe_id,))
        confirmed_steps = o.get('confirmed_steps') or {}
        if isinstance(confirmed_steps, str):
            try: confirmed_steps = json.loads(confirmed_steps)
            except: confirmed_steps = {}
        meat_kg = float(o.get('meat_kg') or 0)
        for idx, ing in enumerate(ings, start=1):
            qty_per = float(ing.get('qty_per_100kg') or 0)
            qty_required = round(qty_per * meat_kg / 100, 3) if meat_kg > 0 else qty_per
            step_key = str(idx)
            confirmed_qty = confirmed_steps.get(step_key)
            steps.append({
                'stepNo': idx,
                'ingredientId':   ing.get('ingredient_id') or '',
                'ingredientName': ing.get('ingredient_name') or '',
                'unit':           ing.get('unit') or 'kg',
                'qtyRequired':    qty_required,
                'qtyConfirmed':   float(confirmed_qty) if confirmed_qty is not None else None,
                'confirmed':      confirmed_qty is not None,
                'isUnlimited':    bool(ing.get('is_unlimited')),
            })

    # Pobierz sesje
    sessions = query_all("""
        SELECT * FROM mixing_sessions WHERE order_id = %s ORDER BY started_at
    """, (oid,))

    meat_kg      = float(o.get('meat_kg') or 0)
    kg_done      = float(o.get('kg_done') or 0)
    kg_remaining = max(0.0, meat_kg - kg_done)
    planned_out  = float(o.get('planned_output_kg') or 0)

    return {
        'id':              o['id'],
        'orderNo':         o.get('order_no') or '',
        'recipeId':        o.get('recipe_id') or '',
        'recipeName':      o.get('recipe_name') or '',
        'productTypeId':   o.get('product_type_id'),
        'productTypeName': o.get('product_type_name'),
        'meatKg':          meat_kg,
        'kgDone':          kg_done,
        'kgRemaining':     kg_remaining,
        'plannedOutputKg': planned_out,
        'machineId':       o.get('machine_id'),
        'status':          o.get('status') or 'planned',
        'notes':           o.get('notes'),
        'createdAt':       str(o.get('created_at') or ''),
        'startedAt':       str(o['started_at']) if o.get('started_at') else None,
        'completedAt':     str(o['completed_at']) if o.get('completed_at') else None,
        'meatLots': [{
            'meatLotId':  lot.get('meat_stock_id') or lot.get('id') or '',
            'meatLotNo':  lot.get('meat_lot_no') or lot.get('lot_no') or '',
            'rawBatchId': lot.get('raw_batch_id') or '',
            'rawBatchNo': lot.get('raw_batch_no') or '',
            'kgPlanned':  float(lot.get('kg_planned') or lot.get('kg_allocated') or 0),
            'kgActual':   float(lot.get('kg_actual') or 0),
            'expiryDate': str(lot['expiry_date']) if lot.get('expiry_date') else '',
        } for lot in meat_lots],
        'steps': steps,
        'sessions': [{
            'sessionId':   s.get('id') or '',
            'machineId':   s.get('machine_id'),
            'kgMeat':      float(s.get('kg_meat') or 0),
            'kgOutput':    float(s.get('kg_output') or 0),
            'startedAt':   str(s.get('started_at') or ''),
            'completedAt': str(s.get('completed_at') or ''),
            'batchNo':     s.get('batch_no'),
        } for s in sessions],
    }

@app.get("/api/mixing-orders")
def list_mixing_orders(status: str = ""):
    sql = "SELECT * FROM mixing_orders"
    params: list = []
    if status:
        sql += " WHERE status = %s"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    orders = query_all(sql, params or None)
    return [build_mixing_order(o) for o in orders]

@app.get("/api/mixing-orders/{id}")
def get_mixing_order(id: str):
    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (id,))
    if not order: raise HTTPException(404)
    return build_mixing_order(order)

@app.post("/api/mixing-orders")
def create_mixing_order(dto: MixingOrderCreate):
    if not dto.recipe_id: raise HTTPException(400, "recipe_id wymagane")
    recipe = query_one("SELECT * FROM recipes WHERE id=%s", (dto.recipe_id,))
    if not recipe: raise HTTPException(404, "Receptura nie znaleziona")
    # Walidacja lineage: zlecenie masowania musi mieć loty mięsa (rozbiór → masowanie)
    if not dto.meat_lots:
        raise HTTPException(400, "Zlecenie masowania wymaga co najmniej jednej partii mięsa (meat_lots). "
                                 "Wybierz partie z rozbioru przed utworzeniem zlecenia.")

    # Pobierz rodzaj produktu jeśli podany
    product_type = None
    if dto.product_type_id:
        product_type = query_one("SELECT * FROM product_types WHERE id=%s", (dto.product_type_id,))

    seq = next_seq('mixing_seq')
    year = datetime.now().year
    order_no = f"MAS-{year}-{str(seq).zfill(3)}"
    oid = cuid()

    planned_output_kg = _calc_kg_output(dto.recipe_id, dto.meat_kg)

    execute("""
        INSERT INTO mixing_orders
        (id, order_no, recipe_id, recipe_name, product_type_id, product_type_name,
         meat_kg, planned_output_kg, kg_done, machine_id,
         status, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,0,NULL,'planned',%s,%s)
    """, (oid, order_no,
          recipe['id'], recipe['name'],
          dto.product_type_id or None,
          product_type['name'] if product_type else None,
          dto.meat_kg, planned_output_kg,
          dto.notes or None, now_iso()))

    # Wstaw loty mięsa + rezerwuj kg w meat_stock
    # WALIDACJA: sprawdź dostępność i brak double-bookingu
    for lot_dto in dto.meat_lots:
        stock = query_one("SELECT * FROM meat_stock WHERE id=%s", (lot_dto.meatLotId,))
        if not stock:
            raise HTTPException(400, f"Partia mięsa nie znaleziona: {lot_dto.meatLotId}")

        available = float(stock.get('kg_available') or 0)
        if available < lot_dto.kgPlanned - 0.1:
            raise HTTPException(400,
                f"Niewystarczające kg w partii {stock.get('lot_no','?')}: "
                f"dostępne {available:.2f} kg, wymagane {lot_dto.kgPlanned:.2f} kg. "
                f"Partia może być już przypisana do innego zlecenia.")

        # Sprawdź double-booking — ta sama partia w innym aktywnym zleceniu
        existing = query_one("""
            SELECT mo.order_no FROM mixing_order_lots mol
            JOIN mixing_orders mo ON mo.id = mol.order_id
            WHERE mol.meat_stock_id = %s
              AND mo.id != %s
              AND mo.status NOT IN ('done', 'cancelled')
        """, (lot_dto.meatLotId, oid))
        if existing:
            raise HTTPException(400,
                f"Partia {stock.get('lot_no','?')} jest już przypisana "
                f"do aktywnego zlecenia {existing['order_no']}. "
                f"Anuluj tamto zlecenie lub użyj innej partii.")

        execute("""
            INSERT INTO mixing_order_lots
            (id, order_id, meat_stock_id, kg_planned, kg_actual)
            VALUES (%s,%s,%s,%s,0)
        """, (cuid(), oid, lot_dto.meatLotId, lot_dto.kgPlanned))
        # Rezerwuj kg w meat_stock — atomowe odjęcie z kontrolą dostępności
        execute("""
            UPDATE meat_stock
            SET kg_available = GREATEST(0, kg_available - %s)
            WHERE id = %s AND kg_available >= %s
        """, (lot_dto.kgPlanned, lot_dto.meatLotId, lot_dto.kgPlanned - 0.1))

    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (oid,))
    return build_mixing_order(order)

@app.patch("/api/mixing-orders/{id}/confirm")
def confirm_mixing_order(id: str):
    """Potwierdza zlecenie masowania — blokuje partie, uniemożliwia anulowanie."""
    row = execute_returning("""
        UPDATE mixing_orders SET status='confirmed'
        WHERE id=%s AND status='planned' RETURNING *
    """, (id,))
    if not row: raise HTTPException(404, "Zlecenie nie znalezione lub już potwierdzone")
    return build_mixing_order(row)

@app.patch("/api/mixing-orders/{id}/start")
def start_mixing_order(id: str, body: dict):
    machine_id = body.get('machineId') or body.get('machine_id')
    row = execute_returning("""
        UPDATE mixing_orders
        SET status='in_progress', started_at=%s, machine_id=%s
        WHERE id=%s RETURNING *
    """, (now_iso(), machine_id, id))
    if not row: raise HTTPException(404)
    return build_mixing_order(row)

@app.patch("/api/mixing-orders/{id}/allocate")
def allocate_to_machine(id: str, body: dict):
    machine_id = body.get('machine_id')
    row = execute_returning("""
        UPDATE mixing_orders SET machine_id=%s WHERE id=%s RETURNING *
    """, (machine_id, id))
    if not row: raise HTTPException(404)
    return build_mixing_order(row)

@app.patch("/api/mixing-orders/{id}/confirm-step")
def confirm_mixing_step(id: str, body: dict):
    """Zapisuje potwierdzenie kroku do JSONB confirmed_steps {stepNo: qty}"""
    step_no   = body.get('stepNo') or body.get('step_no') or 1
    qty_conf  = body.get('qtyConfirmed') or body.get('qty_confirmed') or 0
    # Atomowa aktualizacja JSONB
    row = execute_returning("""
        UPDATE mixing_orders
        SET confirmed_steps = COALESCE(confirmed_steps, '{}'::jsonb)
            || jsonb_build_object(%s::text, %s::numeric)
        WHERE id=%s RETURNING *
    """, (str(step_no), qty_conf, id))
    if not row: raise HTTPException(404)
    return build_mixing_order(row)

@app.patch("/api/mixing-orders/{id}/finish-session")
def finish_mixing_session(id: str, body: dict):
    """Kończy sesję masowania, dodaje do seasoned_meat, liczy kg_done/kg_remaining."""
    from datetime import timedelta
    kg_meat   = float(body.get('kg_actual') or 0)
    batch_no  = body.get('batch_no') or body.get('batchNo') or ''
    # Pobierz alokacje z body (lot_allocations: [{meatLotId, kg}])
    lot_allocations = body.get('lotAllocations') or body.get('lot_allocations') or []

    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (id,))
    if not order: raise HTTPException(404)

    meat_kg   = float(order.get('meat_kg') or 0)
    kg_done   = float(order.get('kg_done') or 0) + kg_meat
    kg_output = _calc_kg_output(order.get('recipe_id'), kg_meat)
    new_status = 'done' if kg_done >= meat_kg - 0.1 else 'planned'

    # Generuj numer partii jeśli pusty
    # Format: MP{raw_seq} jeśli z jednej ćwiartki, MPP{counter} jeśli z wielu
    if not batch_no:
        raw_seqs = query_all("""
            SELECT DISTINCT rb.internal_batch_seq
            FROM mixing_order_lots mol
            LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
            WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
        """, (id,))
        seqs = [r['internal_batch_seq'] for r in raw_seqs if r.get('internal_batch_seq')]
        if len(seqs) == 1:
            batch_no = f"MP{seqs[0]}"
        else:
            mixed_seq = next_seq('mixed_seq')
            batch_no = f"MPP{mixed_seq}"

    # Dodaj sesję do historii
    session_id = cuid()
    machine_id = order.get('machine_id')
    execute("""
        INSERT INTO mixing_sessions
        (id, order_id, machine_id, kg_meat, kg_output, batch_no, started_at, completed_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
    """, (session_id, id, machine_id, kg_meat, kg_output,
          batch_no, str(order.get('started_at') or now_iso()), now_iso()))

    expiry = (datetime.utcnow() + timedelta(days=5)).date().isoformat()
    # Dodaj lub zaktualizuj seasoned_meat
    execute("""
        INSERT INTO seasoned_meat
        (id, batch_no, recipe_id, recipe_name, mixing_order_no,
         kg_produced, kg_available, kg_used, machine_id,
         expiry_date, status, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s)
        ON CONFLICT (batch_no) DO UPDATE
        SET kg_produced  = seasoned_meat.kg_produced  + EXCLUDED.kg_produced,
            kg_available = seasoned_meat.kg_available + EXCLUDED.kg_available
    """, (cuid(), batch_no,
          order.get('recipe_id',''), order.get('recipe_name',''),
          order.get('order_no',''), kg_output, kg_output,
          machine_id, expiry, now_iso()))

    # Lineage — wymagana, nie opcjonalna
    _populate_seasoned_meat_lineage(batch_no, id)

    # BUG 3 FIX: Zaktualizuj kg_planned w lotach — odejmij ile faktycznie zużyto w tej sesji
    # Dzięki temu następna sesja widzi poprawne dostępne kg per lot
    if lot_allocations:
        for alloc in lot_allocations:
            lot_id = alloc.get('meatLotId') or alloc.get('meat_lot_id')
            kg_used = float(alloc.get('kg') or alloc.get('kg_used') or 0)
            if lot_id and kg_used > 0:
                execute("""
                    UPDATE mixing_order_lots
                    SET kg_planned = GREATEST(0, kg_planned - %s),
                        kg_actual  = COALESCE(kg_actual, 0) + %s
                    WHERE order_id = %s AND meat_stock_id = %s
                """, (kg_used, kg_used, id, lot_id))
    else:
        # Fallback: proporcjonalnie zmniejsz kg_planned we wszystkich lotach
        if kg_meat > 0 and meat_kg > 0:
            ratio = kg_meat / meat_kg
            lots = query_all("SELECT * FROM mixing_order_lots WHERE order_id=%s", (id,))
            for lot in lots:
                reduce_by = round(float(lot.get('kg_planned') or 0) * ratio, 3)
                execute("""
                    UPDATE mixing_order_lots
                    SET kg_planned = GREATEST(0, kg_planned - %s),
                        kg_actual  = COALESCE(kg_actual, 0) + %s
                    WHERE id = %s
                """, (reduce_by, reduce_by, lot['id']))

    # Zaktualizuj zlecenie — wyczyść confirmed_steps dla następnej sesji, ustaw kg_done
    completed_at = now_iso() if new_status == 'done' else None
    updated = execute_returning("""
        UPDATE mixing_orders
        SET kg_done=%s, status=%s, completed_at=%s,
            machine_id=NULL, confirmed_steps='{}'::jsonb
        WHERE id=%s RETURNING *
    """, (kg_done, new_status, completed_at, id))

    return build_mixing_order(updated)

@app.patch("/api/mixing-orders/{id}/auto-approve")
def auto_approve_mixing(id: str):
    row = execute_returning(
        "UPDATE mixing_orders SET status='done', completed_at=%s WHERE id=%s RETURNING *",
        (now_iso(), id))
    if not row: raise HTTPException(404)
    return build_mixing_order(row)

@app.patch("/api/mixing-orders/{id}/cancel")
def cancel_mixing_order(id: str):
    order = query_one("SELECT status FROM mixing_orders WHERE id=%s", (id,))
    if not order: raise HTTPException(404)

    # Zlecenia 'in_progress' NIE można anulować
    if order['status'] == 'in_progress':
        raise HTTPException(400, "Nie można anulować zlecenia w trakcie masowania. Zakończ sesję na tablecie.")

    # 'confirmed' można anulować TYLKO jeśli ma puste loty (zlecenie z bugiem)
    if order['status'] == 'confirmed':
        lots_count = query_one("SELECT COUNT(*) as cnt FROM mixing_order_lots WHERE order_id=%s", (id,))
        if lots_count and lots_count['cnt'] > 0:
            raise HTTPException(400, "Nie można anulować potwierdzonego zlecenia z przypisanymi partiami mięsa.")

    # Zwolnij zarezerwowane kg mięsa
    lots = query_all("SELECT * FROM mixing_order_lots WHERE order_id=%s", (id,))
    for lot in lots:
        execute("""
            UPDATE meat_stock
            SET kg_available = kg_available + %s
            WHERE id = %s
        """, (float(lot.get('kg_planned') or 0), lot.get('meat_stock_id')))

    row = execute_returning(
        "UPDATE mixing_orders SET status='cancelled' WHERE id=%s RETURNING *", (id,))
    if not row: raise HTTPException(404)
    return build_mixing_order(row)

# ─── Seasoned meat from-order (wymagane przez MixingTabletPage) ───────────────
@app.post("/api/seasoned-meat/from-order/{order_id}")
def seasoned_from_order(order_id: str, body: dict):
    from datetime import timedelta
    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (order_id,))
    if not order: raise HTTPException(404)
    # MP{raw_seq} jeśli z jednej ćwiartki, MPP{counter} jeśli z wielu
    raw_seqs = query_all("""
        SELECT DISTINCT rb.internal_batch_seq
        FROM mixing_order_lots mol
        LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
        LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
        WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
    """, (order_id,))
    seqs = [r['internal_batch_seq'] for r in raw_seqs if r.get('internal_batch_seq')]
    if len(seqs) == 1:
        batch_no = f"MP{seqs[0]}"
    else:
        mixed_seq = next_seq('mixed_seq')
        batch_no = f"MPP{mixed_seq}"
    kg_meat_raw = float(body.get('kg_produced') or 0)
    kg = _calc_kg_output(order.get('recipe_id'), kg_meat_raw)
    expiry = (datetime.utcnow() + timedelta(days=5)).date().isoformat()
    execute("""
        INSERT INTO seasoned_meat
        (id, batch_no, recipe_id, recipe_name, mixing_order_no,
         kg_produced, kg_available, kg_used, machine_id, expiry_date, status, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,'available',%s)
        ON CONFLICT (batch_no) DO UPDATE
        SET kg_produced  = seasoned_meat.kg_produced  + EXCLUDED.kg_produced,
            kg_available = seasoned_meat.kg_available + EXCLUDED.kg_available
    """, (cuid(), batch_no,
          order.get('recipe_id',''), order.get('recipe_name',''),
          order.get('order_no',''), kg, kg,
          order.get('machine_id'), expiry, now_iso()))
    # Lineage — wymagana, nie opcjonalna
    _populate_seasoned_meat_lineage(batch_no, order_id)
    row = query_one("SELECT * FROM seasoned_meat WHERE batch_no=%s", (batch_no,))
    return {'id': row['id'], 'batchNo': row['batch_no'], 'kgProduced': kg}

# ─── Blokady maszyn (Machine Locks) ───────────────────────────
# BUGFIX #5: Całkowicie brakujące endpointy /api/machine-locks
# Wymagane przez MixingTabletPage.tsx

@app.get("/api/machine-locks")
def list_machine_locks():
    return query_all("SELECT * FROM machine_locks WHERE expires_at > NOW() ORDER BY machine_id")

@app.post("/api/machine-locks")
def lock_machine(body: dict):
    from datetime import timedelta
    machine_id = body.get('machine_id')
    minutes    = body.get('minutes', 60)
    execute("DELETE FROM machine_locks WHERE machine_id=%s", (machine_id,))
    row = execute_returning("""
        INSERT INTO machine_locks (id, machine_id, order_id, order_no, locked_at, expires_at)
        VALUES (%s,%s,%s,%s,%s,%s) RETURNING *
    """, (cuid(), machine_id, body.get('order_id', ''), body.get('order_no', ''),
          now_iso(),
          (datetime.utcnow() + timedelta(minutes=minutes)).isoformat() + 'Z'))
    return row

@app.get("/api/machine-locks/{machine_id}")
def is_machine_locked(machine_id: int):
    row = query_one(
        "SELECT * FROM machine_locks WHERE machine_id=%s AND expires_at > NOW()",
        (machine_id,))
    return {"locked": row is not None, "lock": row}

@app.delete("/api/machine-locks/{machine_id}")
def unlock_machine(machine_id: int):
    execute("DELETE FROM machine_locks WHERE machine_id=%s", (machine_id,))
    return {"ok": True}

# ─── VIES API — wyszukiwanie zagranicznych płatników VAT-UE ──
VIES_API_ID  = "MyDWn3QuH2rJ"
VIES_API_KEY = "1cVi2cO97cKT"

@app.get("/api/vies/lookup")
def vies_lookup(vat: str):
    """Proxy do viesapi.eu — ukrywa klucz API przed frontendem"""
    import urllib.request, hmac, hashlib, time, base64
    vat = vat.strip().upper().replace(" ", "")
    if len(vat) < 4:
        raise HTTPException(400, "Za krótki numer VAT")

    try:
        # viesapi.eu REST endpoint
        url = f"https://www.viesapi.eu/api/get/vies/data/{vat}"
        ts  = str(int(time.time()))
        # HMAC-SHA256 signature: id + ts
        sig = hmac.new(VIES_API_KEY.encode(), (VIES_API_ID + ts).encode(), hashlib.sha256).hexdigest()

        req = urllib.request.Request(url)
        req.add_header("Authorization", f"HMAC-SHA256 id={VIES_API_ID}, ts={ts}, sig={sig}")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "KebabMES/1.0")

        with urllib.request.urlopen(req, timeout=10) as resp:
            import json as _json
            data = _json.loads(resp.read().decode())

        return {
            "vatNumber":     data.get("vatNumber") or vat,
            "countryCode":   data.get("countryCode") or vat[:2],
            "traderName":    data.get("traderName") or "",
            "traderAddress": data.get("traderAddress") or "",
            "valid":         bool(data.get("valid")),
        }
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise HTTPException(502, f"VIES API błąd {e.code}: {body[:200]}")
    except Exception as e:
        raise HTTPException(502, f"Błąd połączenia z VIES: {str(e)}")

# ─── Pomocnicze ───────────────────────────────────────────────
@app.get("/api/batch-history")
def all_history():
    return []

@app.get("/api/system-logs")
def system_logs():
    return []

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
