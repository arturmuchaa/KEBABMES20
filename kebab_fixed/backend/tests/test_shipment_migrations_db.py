"""Fresh and repeated DDL must work before shipment services are enabled."""
from uuid import uuid4
import os
import pytest

from app.db import raw_connection
from app.migrations import _DDL
from init_db import SCHEMA


def test_fresh_and_repeated_migrations_have_all_shipment_columns_and_indexes():
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    assert "kebab_mes_test" in url
    # Private schema, rolled back on exit. Never use a production database.
    with raw_connection() as conn:
        with conn.cursor() as cur:
            schema = "migration_" + uuid4().hex
            cur.execute(f'CREATE SCHEMA "{schema}"')
            cur.execute(f'SET LOCAL search_path TO "{schema}"')
            cur.execute(SCHEMA)
            for _ in range(2):
                for statement in _DDL:
                    cur.execute(statement)
            for table in ("wz_documents", "hdi_documents", "cmr_documents"):
                cur.execute(f'SELECT loading_id FROM {table} LIMIT 0')
            cur.execute('SELECT document_snapshot FROM loading_orders LIMIT 0')
            cur.execute("SELECT indexname FROM pg_indexes WHERE schemaname=%s", (schema,))
            indexes = {r["indexname"] for r in cur.fetchall()}
            assert {"ux_wz_shipment_scope", "ux_hdi_shipment_scope"} <= indexes
