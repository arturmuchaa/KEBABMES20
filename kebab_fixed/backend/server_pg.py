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

def log_event(action: str, entity_type: str, entity_id: str,
              metadata: dict = None, user_id: str = None) -> None:
    """Zapisz zdarzenie do globalnego logu audytu (event_log)."""
    try:
        execute("""
            INSERT INTO event_log (id, user_id, action, entity_type, entity_id, metadata, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (cuid(), user_id, action, entity_type, entity_id,
              json.dumps(metadata or {}), now_iso()))
    except Exception as e:
        logger.warning(f"log_event error: {e}")

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
        """CREATE TABLE IF NOT EXISTS event_log (
            id TEXT PRIMARY KEY, timestamp TIMESTAMPTZ DEFAULT NOW(),
            user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL, metadata JSONB DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )""",
        """CREATE TABLE IF NOT EXISTS byproduct_batches (
            id TEXT PRIMARY KEY, type TEXT NOT NULL,
            source_deboning_entry_id TEXT, weight NUMERIC(10,3) DEFAULT 0,
            timestamp TIMESTAMPTZ DEFAULT NOW(), notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )""",
        "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_backs NUMERIC(10,3) DEFAULT 0",
        "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_bones NUMERIC(10,3) DEFAULT 0",
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
    batch_id = cuid()
    row = execute_returning("""
        INSERT INTO raw_batches
        (id, internal_batch_no, internal_batch_seq, supplier_id, supplier_name,
         supplier_batch_no, slaughter_date, received_date, kg_received, kg_available,
         price_per_kg, expiry_date, status, notes, invoice_no, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s,%s,%s) RETURNING *
    """, (batch_id, f"R{seq}", seq, dto.supplier_id, sup['name'] if sup else '',
          dto.supplier_batch_no,
          dto.slaughter_date or None, dto.received_date or None,
          dto.kg_received, dto.kg_received,
          dto.price_per_kg,
          dto.expiry_date or None, dto.notes,
          dto.invoice_no or None, now_iso()))
    log_event(
        action='CREATE', entity_type='RawBatch', entity_id=batch_id,
        metadata={
            'batchNo': f"R{seq}", 'kgReceived': dto.kg_received,
            'supplierId': dto.supplier_id, 'invoiceNo': dto.invoice_no,
        }
    )
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
    """, (body.get('supplierBatchNo'), body.get('slaughterDate') or None,
          body.get('receivedDate') or None, body.get('kgReceived', 0),
          body.get('pricePerKg', 0), body.get('expiryDate') or None,
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
    row = execute_returning("""
        INSERT INTO recipes (id, name, product_type_id, product_type_name, total_output_per_100kg, active, notes, created_at)
        VALUES (%s,%s,%s,%s,%s,true,%s,%s) RETURNING *
    """, (cuid(), dto.name, dto.product_type_id or None, dto.product_type_name,
          dto.total_output_per_100kg, dto.notes or None, now_iso()))
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
    execute("""
        UPDATE recipes SET name=%s, product_type_id=%s, product_type_name=%s,
        total_output_per_100kg=%s, notes=%s, updated_at=%s WHERE id=%s
    """, (dto.name, dto.product_type_id or None, dto.product_type_name,
          dto.total_output_per_100kg, dto.notes or None, now_iso(), id))
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
    """, (cuid(), body.get('ingredientId'), body.get('qty', 0), body.get('qty', 0),
          body.get('expiryDate') or None, body.get('batchNo') or None, now_iso()))
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

        execute("""
            INSERT INTO production_plan_lines
            (id, plan_id, qty, kg_per_unit, total_kg,
             product_type_id, product_type_name, recipe_id, recipe_name,
             packaging_id, packaging_name, seasoned_batch_id, seasoned_batch_no,
             client_order_id, client_order_no, client_name, kg_assigned, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (cuid(), plan['id'], line.qty, line.kg_per_unit, line_kg,
              line.product_type_id or None, product_type_name or None,
              line.recipe_id, recipe_name,
              line.packaging_id or None, packaging_name or None,
              primary_batch_id, primary_batch_no or None,
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
def _enrich_seasoned_lots(rows: list) -> list:
    """Wzbogaca rekordy seasoned_meat o meatLots i rawBatchNos z mixing_order_lots."""
    for row in rows:
        mixing_no = row.get('mixing_order_no')
        if mixing_no:
            order = query_one("SELECT id FROM mixing_orders WHERE order_no=%s", (mixing_no,))
            if order:
                lots = query_all("""
                    SELECT mol.*, ms.lot_no AS meat_lot_no, ms.expiry_date,
                           ms.id AS meat_stock_id,
                           rb.internal_batch_no AS raw_batch_no,
                           ms.raw_batch_id
                    FROM mixing_order_lots mol
                    LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                    LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                    WHERE mol.mixing_order_id = %s
                """, (order['id'],))
                row['meat_lots'] = [{
                    'meatLotId':  l.get('meat_stock_id') or l.get('id') or '',
                    'meatLotNo':  l.get('meat_lot_no') or '',
                    'rawBatchId': l.get('raw_batch_id') or '',
                    'rawBatchNo': l.get('raw_batch_no') or '',
                    'kgPlanned':  float(l.get('kg_planned') or l.get('kg_allocated') or 0),
                    'expiryDate': str(l['expiry_date']) if l.get('expiry_date') else '',
                } for l in lots]
                row['raw_batch_nos'] = list({l.get('raw_batch_no') for l in lots if l.get('raw_batch_no')})
            else:
                row['meat_lots'] = []
                row['raw_batch_nos'] = []
        else:
            row['meat_lots'] = []
            row['raw_batch_nos'] = []
    return rows

@app.get("/api/seasoned-meat/all")
def list_all_seasoned():
    rows = query_all("SELECT * FROM seasoned_meat ORDER BY created_at DESC")
    return _enrich_seasoned_lots(rows)

@app.get("/api/seasoned-meat")
def list_seasoned():
    rows = query_all("""
        SELECT * FROM seasoned_meat
        WHERE kg_available > 0 AND status != 'depleted'
        ORDER BY expiry_date ASC, batch_no ASC
    """)
    return {"data": _enrich_seasoned_lots(rows)}

@app.get("/api/seasoned-meat/{id}/trace")
def seasoned_trace(id: str):
    batch = query_one("SELECT * FROM seasoned_meat WHERE id=%s", (id,))
    if not batch: raise HTTPException(404)
    return batch

# ─── Wyroby gotowe ────────────────────────────────────────────
class FinishDayEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_line_id:    str       = Field("",  alias="planLineId")
    qty:             int       = 0
    worker_names:    List[str] = Field(default=[], alias="workerNames")
    kg_per_unit:     float     = Field(0.0, alias="kgPerUnit")
    product_type_id: str       = Field("",  alias="productTypeId")
    product_type_name: str     = Field("",  alias="productTypeName")
    recipe_id:       str       = Field("",  alias="recipeId")
    recipe_name:     str       = Field("",  alias="recipeName")
    packaging_id:    str       = Field("",  alias="packagingId")
    packaging_name:  str       = Field("",  alias="packagingName")
    client_order_id: str       = Field("",  alias="clientOrderId")
    client_order_no: str       = Field("",  alias="clientOrderNo")
    client_name:     str       = Field("",  alias="clientName")
    seasoned_batch_nos: List[str] = Field(default=[], alias="seasonedBatchNos")

class FinishDayDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    plan_id: str = Field(..., alias="planId")
    entries: List[FinishDayEntry]

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
    item = execute_returning("""
        INSERT INTO finished_goods
        (id, batch_no, plan_no, product_type_id, product_type_name,
         recipe_id, recipe_name, packaging_id, packaging_name,
         client_name, client_order_no, qty, kg_per_unit, total_kg,
         qty_available, qty_shipped, produced_date, produced_by,
         seasoned_batch_nos, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
        RETURNING *
    """, (cuid(), body.get('batchNo', f"P{seq}"), body.get('planNo', ''),
          body.get('productTypeId', ''), body.get('productTypeName', ''),
          body.get('recipeId', ''), body.get('recipeName', ''),
          body.get('packagingId') or None, body.get('packagingName') or None,
          body.get('clientName') or None, body.get('clientOrderNo') or None,
          body.get('qty', 0), body.get('kgPerUnit', 0), body.get('totalKg', 0),
          body.get('qty', 0), body.get('producedDate', datetime.now().date().isoformat()),
          body.get('producedBy', []), body.get('seasonedBatchNos', []), now_iso()))
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
                    )
                WHERE id = %s
            """, (entry.qty, total_kg, entry.qty,
                  entry.worker_names,
                  entry.seasoned_batch_nos,
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
            first_batch = entry.seasoned_batch_nos[0] if entry.seasoned_batch_nos else ''
            batch_no = first_batch if first_batch.startswith('P') else f"P{seq}"

            item = execute_returning("""
                INSERT INTO finished_goods
                (id, batch_no, plan_no, product_type_id, product_type_name,
                 recipe_id, recipe_name, packaging_id, packaging_name,
                 client_name, client_order_no, qty, kg_per_unit, total_kg,
                 qty_available, qty_shipped, produced_date, produced_by,
                 seasoned_batch_nos, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s)
                RETURNING *
            """, (cuid(), batch_no, plan['plan_no'],
                  entry.product_type_id, entry.product_type_name,
                  entry.recipe_id, entry.recipe_name,
                  entry.packaging_id or None, entry.packaging_name or None,
                  entry.client_name or None, entry.client_order_no or None,
                  entry.qty, entry.kg_per_unit, total_kg, entry.qty,
                  today, entry.worker_names,
                  entry.seasoned_batch_nos, now_iso()))

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
    batch = query_one("SELECT * FROM raw_batches WHERE id=%s", (body.get('rawBatchId'),))
    if not batch: raise HTTPException(404, "Partia nie znaleziona")

    # Szukaj nazwy pracownika jezeli podano tylko workerId
    worker_name = body.get('workerName')
    worker_id   = body.get('workerId')
    if worker_id and not worker_name:
        worker = query_one("SELECT name FROM workers WHERE id=%s", (worker_id,))
        if worker:
            worker_name = worker['name']

    # kgTaken (camelCase z frontu) lub kgQuarter (legacy)
    kg_taken = float(body.get('kgTaken') or body.get('kgQuarter') or 0)
    kg_meat  = float(body.get('kgMeat') or 0)
    kg_backs = float(body.get('kgBacks') or 0)
    kg_bones = float(body.get('kgBones') or 0)

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
    session_id  = body.get('sessionId')

    entry = execute_returning("""
        INSERT INTO deboning_entries
            (id, raw_batch_id, raw_batch_no, session_id, session_no,
             kg_quarter, kg_meat, kg_backs, kg_bones, kg_remainder,
             yield_pct, worker_id, worker_name, created_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *
    """, (entry_id, batch['id'], batch['internal_batch_no'], session_id, session_no,
          kg_taken, kg_meat, kg_backs, kg_bones, kg_remainder, yield_pct,
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

    # ── Produkty uboczne (kości / grzbiety) ─────────────────────
    if kg_bones > 0:
        execute("""
            INSERT INTO byproduct_batches
            (id, type, source_deboning_entry_id, weight, timestamp, created_at)
            VALUES (%s, 'BONES', %s, %s, %s, %s)
        """, (cuid(), entry_id, kg_bones, now_iso(), now_iso()))

    if kg_backs > 0:
        execute("""
            INSERT INTO byproduct_batches
            (id, type, source_deboning_entry_id, weight, timestamp, created_at)
            VALUES (%s, 'BACKS', %s, %s, %s, %s)
        """, (cuid(), entry_id, kg_backs, now_iso(), now_iso()))

    # ── Event log ────────────────────────────────────────────────
    log_event(
        action='CREATE', entity_type='DeboningEntry', entity_id=entry_id,
        metadata={
            'rawBatchNo': batch['internal_batch_no'],
            'kgTaken': kg_taken, 'kgMeat': kg_meat,
            'kgBacks': kg_backs, 'kgBones': kg_bones,
            'kgRemainder': kg_remainder, 'yieldPct': yield_pct,
            'workerName': worker_name, 'sessionId': session_id,
        },
        user_id=worker_id,
    )

    return _map_deboning_entry(entry)

@app.patch("/api/deboning/entries/{id}")
def update_deboning_entry(id: str, body: dict):
    # Pobierz aktualny wpis
    existing = query_one("SELECT * FROM deboning_entries WHERE id=%s", (id,))
    if not existing: raise HTTPException(404)

    kg_taken = float(body.get('kgTaken') or body.get('kgQuarter') or existing.get('kg_quarter') or 0)
    kg_meat  = float(body.get('kgMeat') or existing.get('kg_meat') or 0)
    kg_backs = float(body.get('kgBacks') or existing.get('kg_backs') or 0)
    kg_bones = float(body.get('kgBones') or existing.get('kg_bones') or 0)
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
    # Akceptuje camelCase z frontendu
    meatLotId: str = ""
    kgPlanned: float = 0

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
    # Oblicz planowane wyjście z receptury: mięso + suma składników (woda/przyprawy dodają wagę)
    if recipe_id:
        ing_rows = query_all(
            "SELECT COALESCE(qty_per_100kg, 0) AS qty FROM recipe_ingredients WHERE recipe_id=%s",
            (recipe_id,))
        total_ing_pct = sum(float(r.get('qty', 0)) for r in ing_rows)
        planned_out = round((100.0 + total_ing_pct) * meat_kg / 100, 2)
    else:
        planned_out = meat_kg

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

    # Pobierz rodzaj produktu jeśli podany
    product_type = None
    if dto.product_type_id:
        product_type = query_one("SELECT * FROM product_types WHERE id=%s", (dto.product_type_id,))

    seq = next_seq('mixing_seq')
    year = datetime.now().year
    order_no = f"MAS-{year}-{str(seq).zfill(3)}"
    oid = cuid()

    total_output_per_100kg = float(recipe.get('total_output_per_100kg') or 100)
    planned_output_kg = round(total_output_per_100kg * dto.meat_kg / 100, 2)

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
    for lot_dto in dto.meat_lots:
        stock = query_one("SELECT * FROM meat_stock WHERE id=%s", (lot_dto.meatLotId,))
        if not stock: continue
        execute("""
            INSERT INTO mixing_order_lots
            (id, order_id, meat_stock_id, kg_planned, kg_actual)
            VALUES (%s,%s,%s,%s,0)
        """, (cuid(), oid, lot_dto.meatLotId, lot_dto.kgPlanned))
        # Rezerwuj kg w meat_stock
        execute("""
            UPDATE meat_stock
            SET kg_available = GREATEST(0, kg_available - %s)
            WHERE id = %s
        """, (lot_dto.kgPlanned, lot_dto.meatLotId))

    # Rezerwuj składniki (przyprawy) z ingredient_stock — FEFO
    _reserve_ingredient_stock(dto.recipe_id, dto.meat_kg)

    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (oid,))
    return build_mixing_order(order)


def _reserve_ingredient_stock(recipe_id: str, meat_kg: float):
    """Rezerwuje składniki z ingredient_stock FEFO przy tworzeniu zlecenia masowania."""
    ings = query_all("""
        SELECT ri.ingredient_id, ri.qty_per_100kg, ri.ingredient_name, ri.unit,
               COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
    """, (recipe_id,))
    for ing in ings:
        if ing.get('is_unlimited'):
            continue  # woda i podobne — bez limitu, nie rezerwujemy
        qty_needed = round(float(ing.get('qty_per_100kg') or 0) * meat_kg / 100, 3)
        if qty_needed <= 0:
            continue
        stocks = query_all("""
            SELECT * FROM ingredient_stock
            WHERE ingredient_id = %s AND qty_available > 0
            ORDER BY expiry_date ASC NULLS LAST, created_at ASC
        """, (ing['ingredient_id'],))
        remaining = qty_needed
        for stock in stocks:
            if remaining <= 0:
                break
            take = min(float(stock.get('qty_available') or 0), remaining)
            if take <= 0:
                continue
            execute("""
                UPDATE ingredient_stock
                SET qty_available = GREATEST(0, qty_available - %s)
                WHERE id = %s
            """, (take, stock['id']))
            remaining -= take


def _release_ingredient_stock(recipe_id: str, meat_kg: float):
    """Przywraca składniki do ingredient_stock po anulowaniu zlecenia."""
    ings = query_all("""
        SELECT ri.ingredient_id, ri.qty_per_100kg,
               COALESCE(i.is_unlimited, false) AS is_unlimited
        FROM recipe_ingredients ri
        JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = %s
    """, (recipe_id,))
    for ing in ings:
        if ing.get('is_unlimited'):
            continue
        qty_to_restore = round(float(ing.get('qty_per_100kg') or 0) * meat_kg / 100, 3)
        if qty_to_restore <= 0:
            continue
        stock = query_one("""
            SELECT id FROM ingredient_stock
            WHERE ingredient_id = %s
            ORDER BY expiry_date ASC NULLS LAST
            LIMIT 1
        """, (ing['ingredient_id'],))
        if stock:
            execute("""
                UPDATE ingredient_stock
                SET qty_available = qty_available + %s
                WHERE id = %s
            """, (qty_to_restore, stock['id']))

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
    # Oblicz rzeczywistą wagę wyjściową: mięso + wszystkie składniki (woda, przyprawy zwiększają wagę)
    if order.get('recipe_id'):
        ing_rows = query_all(
            "SELECT COALESCE(qty_per_100kg, 0) AS qty FROM recipe_ingredients WHERE recipe_id=%s",
            (order.get('recipe_id'),))
        total_ing_pct = sum(float(r.get('qty', 0)) for r in ing_rows)
        total_out_pct = 100.0 + total_ing_pct  # np. mięso 100% + składniki 25% = 125% wyjście
    else:
        total_out_pct = 100.0
    kg_output = round(total_out_pct * kg_meat / 100, 2)
    new_status = 'done' if kg_done >= meat_kg - 0.1 else 'planned'

    # Generuj numer partii jeśli pusty
    if not batch_no:
        seq = next_seq('seasoned_seq')
        year = datetime.now().year
        batch_no = f"PW-{year}-{str(seq).zfill(3)}"

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
    order = query_one("SELECT * FROM mixing_orders WHERE id=%s", (id,))
    if not order: raise HTTPException(404)
    # Zwolnij zarezerwowane kg mięsa
    lots = query_all("SELECT * FROM mixing_order_lots WHERE order_id=%s", (id,))
    for lot in lots:
        execute("""
            UPDATE meat_stock
            SET kg_available = kg_available + %s
            WHERE id = %s
        """, (float(lot.get('kg_planned') or 0), lot.get('meat_stock_id')))
    # Zwolnij zarezerwowane składniki (przyprawy) z ingredient_stock
    _release_ingredient_stock(order['recipe_id'], float(order.get('meat_kg') or 0))
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
    seq = next_seq('seasoned_seq')
    year = datetime.now().year
    batch_no = f"PW-{year}-{str(seq).zfill(3)}"
    kg = float(body.get('kg_produced') or 0)
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

# ─── VIES API — oficjalny SOAP serwis Komisji Europejskiej ────
@app.get("/api/vies/lookup")
def vies_lookup(vat: str):
    """
    Weryfikacja VAT-UE przez oficjalny SOAP endpoint EC VIES.
    URL: https://ec.europa.eu/taxation_customs/vies/services/checkVatService
    Bezplatne, bez klucza, niezawodne od lat.
    """
    import urllib.request
    import re

    vat = vat.strip().upper().replace(" ", "").replace("-", "")
    if len(vat) < 4:
        raise HTTPException(400, "Za krotki numer VAT")

    country_code = vat[:2]
    vat_number   = vat[2:]

    if not country_code.isalpha() or len(vat_number) < 2:
        raise HTTPException(400, "Nieprawidlowy format VAT-UE (np. DE123456789)")

    soap = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soapenv:Body>'
        '<checkVat xmlns="urn:ec.europa.eu:taxud:vies:services:checkVat:types">'
        f'<countryCode>{country_code}</countryCode>'
        f'<vatNumber>{vat_number}</vatNumber>'
        '</checkVat>'
        '</soapenv:Body>'
        '</soapenv:Envelope>'
    )

    try:
        req = urllib.request.Request(
            "https://ec.europa.eu/taxation_customs/vies/services/checkVatService",
            data=soap.encode("utf-8"),
            method="POST",
        )
        req.add_header("Content-Type", "text/xml; charset=UTF-8")
        req.add_header("SOAPAction", "")
        req.add_header("User-Agent", "KebabMES/2.3")

        with urllib.request.urlopen(req, timeout=15) as resp:
            xml = resp.read().decode("utf-8")

        def tag(name):
            m = re.search(rf'<(?:ns2:)?{name}>(.*?)</(?:ns2:)?{name}>', xml, re.DOTALL)
            return m.group(1).strip() if m else ""

        valid       = tag("valid") == "true"
        trader_name = tag("traderName")
        trader_addr = tag("traderAddress")

        # VIES zwraca "---" gdy dane nie sa publiczne
        if trader_name == "---":
            trader_name = ""
        if trader_addr == "---":
            trader_addr = ""

        return {
            "vatNumber":     country_code + vat_number,
            "countryCode":   country_code,
            "traderName":    trader_name,
            "traderAddress": trader_addr,
            "valid":         valid,
        }

    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise HTTPException(502, f"VIES SOAP blad HTTP {e.code}: {body[:200]}")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"Brak polaczenia z VIES: {str(e.reason)}")
    except Exception as e:
        raise HTTPException(502, f"Blad VIES: {str(e)}")

# ─── Pomocnicze ───────────────────────────────────────────────
@app.get("/api/batch-history")
def all_history():
    return []

@app.get("/api/system-logs")
def system_logs(limit: int = 100):
    return query_all("""
        SELECT * FROM event_log ORDER BY created_at DESC LIMIT %s
    """, (limit,))

# ─── Produkty uboczne (kości / grzbiety) ─────────────────────

@app.get("/api/byproducts")
def list_byproducts(type: str = ""):
    sql = """
        SELECT b.*, de.raw_batch_no, de.worker_name, de.session_id,
               rb.supplier_name, rb.slaughter_date
        FROM byproduct_batches b
        LEFT JOIN deboning_entries de ON de.id = b.source_deboning_entry_id
        LEFT JOIN raw_batches rb ON rb.internal_batch_no = de.raw_batch_no
    """
    params: list = []
    if type:
        sql += " WHERE b.type = %s"
        params.append(type.upper())
    sql += " ORDER BY b.created_at DESC"
    return query_all(sql, params or None)

@app.get("/api/byproducts/summary")
def byproducts_summary():
    return query_all("""
        SELECT type, COUNT(*) as count,
               SUM(weight) as total_kg,
               DATE(created_at) as date
        FROM byproduct_batches
        GROUP BY type, DATE(created_at)
        ORDER BY date DESC, type
    """)

# ─── Traceability ─────────────────────────────────────────────

def _build_trace_from_raw_batch(raw_batch_id: str) -> dict:
    """Buduje pełny łańcuch traceability dla partii surowca."""
    raw_batch = query_one("SELECT * FROM raw_batches WHERE id=%s", (raw_batch_id,))
    if not raw_batch:
        return {}

    # Faktura zakupu
    invoice = None
    if raw_batch.get('invoice_no'):
        invoice = query_one(
            "SELECT * FROM invoices WHERE invoice_no=%s LIMIT 1",
            (raw_batch['invoice_no'],))

    # Dostawca
    supplier = None
    if raw_batch.get('supplier_id'):
        supplier = query_one("SELECT * FROM suppliers WHERE id=%s", (raw_batch['supplier_id'],))

    # Wpisy rozbioru
    deboning_entries_list = query_all(
        "SELECT * FROM deboning_entries WHERE raw_batch_id=%s ORDER BY created_at",
        (raw_batch_id,))
    entry_ids = [e['id'] for e in deboning_entries_list]

    # Produkty uboczne
    byproducts: List[dict] = []
    if entry_ids:
        ph = ','.join(['%s'] * len(entry_ids))
        byproducts = query_all(
            f"SELECT * FROM byproduct_batches WHERE source_deboning_entry_id IN ({ph}) ORDER BY created_at",
            entry_ids)

    # Partie mięsa (meat_stock)
    meat_lots = query_all(
        "SELECT * FROM meat_stock WHERE raw_batch_id=%s ORDER BY created_at",
        (raw_batch_id,))
    meat_lot_ids = [m['id'] for m in meat_lots]

    # Zlecenia masowania
    mixing_orders_list: List[dict] = []
    seasoned_meat_list: List[dict] = []
    if meat_lot_ids:
        ph = ','.join(['%s'] * len(meat_lot_ids))
        mol_rows = query_all(
            f"SELECT DISTINCT order_id FROM mixing_order_lots WHERE meat_stock_id IN ({ph})",
            meat_lot_ids)
        order_ids = [r['order_id'] for r in mol_rows]
        for oid in order_ids:
            mo_row = query_one("SELECT * FROM mixing_orders WHERE id=%s", (oid,))
            if mo_row:
                mixing_orders_list.append(build_mixing_order(mo_row))

        # Mięso przyprawione z tych zleceń
        if order_ids:
            ph2 = ','.join(['%s'] * len(order_ids))
            order_nos_rows = query_all(
                f"SELECT order_no FROM mixing_orders WHERE id IN ({ph2})", order_ids)
            order_nos = [r['order_no'] for r in order_nos_rows]
            for ono in order_nos:
                sm_rows = query_all(
                    "SELECT * FROM seasoned_meat WHERE mixing_order_no=%s", (ono,))
                seasoned_meat_list.extend(sm_rows)

    # Wyroby gotowe ze wszystkich partii przyprawionego mięsa
    finished_goods_list: List[dict] = []
    seasoned_batch_nos = [sm['batch_no'] for sm in seasoned_meat_list]
    if seasoned_batch_nos:
        fg_rows = query_all("""
            SELECT DISTINCT fg.* FROM finished_goods fg
            WHERE EXISTS (
                SELECT 1 FROM unnest(fg.seasoned_batch_nos) sbn
                WHERE sbn = ANY(%s::text[])
            )
            ORDER BY fg.created_at
        """, (seasoned_batch_nos,))
        finished_goods_list = fg_rows

    # Historia zdarzeń — zbieramy entity_id ze wszystkich obiektów
    all_ids = [raw_batch_id] + entry_ids + meat_lot_ids
    if mixing_orders_list:
        ph = ','.join(['%s'] * len(mixing_orders_list))
        mo_ids_rows = query_all(
            f"SELECT id FROM mixing_orders WHERE order_no IN ({ph})",
            [mo.get('orderNo','') for mo in mixing_orders_list])
        all_ids.extend([r['id'] for r in mo_ids_rows])

    events: List[dict] = []
    if all_ids:
        ph = ','.join(['%s'] * len(all_ids))
        events = query_all(
            f"SELECT * FROM event_log WHERE entity_id IN ({ph}) ORDER BY created_at DESC",
            all_ids)

    return {
        "rawBatch": dict(raw_batch),
        "supplier": dict(supplier) if supplier else None,
        "invoice": dict(invoice) if invoice else None,
        "deboningEntries": [_map_deboning_entry(e) for e in deboning_entries_list],
        "byproducts": byproducts,
        "meatLots": meat_lots,
        "mixingOrders": mixing_orders_list,
        "seasonedMeat": seasoned_meat_list,
        "finishedGoods": finished_goods_list,
        "events": events,
    }


@app.get("/api/traceability/{batch_id}")
def get_traceability(batch_id: str):
    """
    Pełne end-to-end traceability dla dowolnej partii.
    Akceptuje: id lub numer (internal_batch_no, lot_no, batch_no).
    Zwraca łańcuch: zakup → magazyn → rozbiór → mięso → masowanie → produkt.
    """
    entity_type = None
    root_raw_batch_id = None

    # 1. Szukaj partii surowca (raw_batch)
    rb = query_one(
        "SELECT * FROM raw_batches WHERE id=%s OR internal_batch_no=%s",
        (batch_id, batch_id))
    if rb:
        entity_type = 'raw_batch'
        root_raw_batch_id = rb['id']

    # 2. Szukaj partii mięsa (meat_stock)
    if not entity_type:
        ms = query_one(
            "SELECT * FROM meat_stock WHERE id=%s OR lot_no=%s",
            (batch_id, batch_id))
        if ms:
            entity_type = 'meat_lot'
            root_raw_batch_id = ms.get('raw_batch_id')

    # 3. Szukaj mięsa przyprawionego (seasoned_meat)
    if not entity_type:
        sm = query_one(
            "SELECT * FROM seasoned_meat WHERE id=%s OR batch_no=%s",
            (batch_id, batch_id))
        if sm:
            entity_type = 'seasoned_meat'
            # Wstecz: zlecenie → lot → surowiec
            mo_row = query_one(
                "SELECT * FROM mixing_orders WHERE order_no=%s",
                (sm.get('mixing_order_no'),))
            if mo_row:
                lot_row = query_one(
                    "SELECT * FROM mixing_order_lots WHERE order_id=%s LIMIT 1",
                    (mo_row['id'],))
                if lot_row:
                    ms2 = query_one(
                        "SELECT * FROM meat_stock WHERE id=%s",
                        (lot_row['meat_stock_id'],))
                    if ms2:
                        root_raw_batch_id = ms2.get('raw_batch_id')

    # 4. Szukaj wyrobu gotowego (finished_goods)
    if not entity_type:
        fg = query_one(
            "SELECT * FROM finished_goods WHERE id=%s OR batch_no=%s",
            (batch_id, batch_id))
        if fg:
            entity_type = 'finished_goods'
            seasoned_nos = fg.get('seasoned_batch_nos') or []
            if seasoned_nos:
                sm2 = query_one(
                    "SELECT * FROM seasoned_meat WHERE batch_no=%s LIMIT 1",
                    (seasoned_nos[0],))
                if sm2:
                    mo_row2 = query_one(
                        "SELECT * FROM mixing_orders WHERE order_no=%s",
                        (sm2.get('mixing_order_no'),))
                    if mo_row2:
                        lot_row2 = query_one(
                            "SELECT * FROM mixing_order_lots WHERE order_id=%s LIMIT 1",
                            (mo_row2['id'],))
                        if lot_row2:
                            ms3 = query_one(
                                "SELECT * FROM meat_stock WHERE id=%s",
                                (lot_row2['meat_stock_id'],))
                            if ms3:
                                root_raw_batch_id = ms3.get('raw_batch_id')

    if not entity_type:
        raise HTTPException(404, f"Partia '{batch_id}' nie znaleziona w żadnym magazynie")

    if not root_raw_batch_id:
        raise HTTPException(404, "Nie można ustalić partii surowca dla podanego ID")

    chain = _build_trace_from_raw_batch(root_raw_batch_id)
    chain["batchId"]    = batch_id
    chain["entityType"] = entity_type
    return chain


@app.get("/api/traceability/{batch_id}/recall")
def recall_simulation(batch_id: str):
    """
    Symulacja odwołania partii (recall).
    Zwraca wszystkie produkty końcowe powiązane z daną partią.
    """
    trace = get_traceability(batch_id)

    finished = trace.get("finishedGoods", [])
    seasoned  = trace.get("seasonedMeat", [])

    total_kg    = sum(float(fg.get('total_kg') or 0) for fg in finished)
    total_units = sum(int(fg.get('qty_available') or fg.get('qty') or 0) for fg in finished)
    seasoned_kg = sum(float(sm.get('kg_available') or 0) for sm in seasoned)

    return {
        "batchId":         batch_id,
        "entityType":      trace.get("entityType"),
        "rawBatch":        trace.get("rawBatch"),
        "supplier":        trace.get("supplier"),
        "affectedFinishedGoods":  finished,
        "affectedSeasonedMeat":   seasoned,
        "summary": {
            "totalAffectedFinishedKg":    round(total_kg, 3),
            "totalAffectedFinishedUnits": total_units,
            "totalSeasonedMeatKgStillAvailable": round(seasoned_kg, 3),
            "deboningEntries":  len(trace.get("deboningEntries", [])),
            "meatLots":         len(trace.get("meatLots", [])),
            "seasonedBatches":  len(seasoned),
            "finishedProducts": len(finished),
        },
        "events": trace.get("events", []),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
