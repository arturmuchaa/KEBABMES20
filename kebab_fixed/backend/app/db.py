"""Database layer.

Provides a thread-safe connection pool, explicit transaction context
managers, and low-level query helpers. All services must use these
primitives — direct ``psycopg2.connect`` calls are forbidden.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Sequence

import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import HTTPException

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)

_pool_lock = threading.Lock()
_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None


def init_pool() -> None:
    """Initialise the process-wide connection pool. Idempotent."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            return
        logger.info(
            "db.pool.init",
            extra={
                "minconn": settings.db_pool_min,
                "maxconn": settings.db_pool_max,
            },
        )
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=settings.db_pool_min,
            maxconn=settings.db_pool_max,
            dsn=settings.database_url,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            logger.info("db.pool.close")
            _pool.closeall()
            _pool = None


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    if _pool is None:
        init_pool()
    assert _pool is not None
    return _pool


@contextmanager
def raw_connection() -> Iterator[psycopg2.extensions.connection]:
    """Acquire a raw pooled connection. Caller owns commit/rollback.

    Prefer :func:`transaction` unless you need fine-grained control.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        if settings.db_statement_timeout_ms > 0:
            with conn.cursor() as cur:
                cur.execute(
                    "SET LOCAL statement_timeout = %s",
                    (settings.db_statement_timeout_ms,),
                )
        yield conn
    finally:
        try:
            if conn.closed == 0 and not conn.autocommit:
                conn.rollback()
        except Exception:
            pass
        pool.putconn(conn)


@contextmanager
def transaction() -> Iterator[psycopg2.extensions.connection]:
    """Context-managed transaction.

    Commits on clean exit, rolls back on any exception, and always
    releases the connection back to the pool.
    """
    pool = _get_pool()
    conn = pool.getconn()
    committed = False
    try:
        conn.autocommit = False
        if settings.db_statement_timeout_ms > 0:
            with conn.cursor() as cur:
                cur.execute(
                    "SET LOCAL statement_timeout = %s",
                    (settings.db_statement_timeout_ms,),
                )
        yield conn
        conn.commit()
        committed = True
    except HTTPException:
        try:
            conn.rollback()
        except Exception:
            logger.exception("db.tx.rollback_failed")
        raise
    except Exception:
        try:
            conn.rollback()
        except Exception:
            logger.exception("db.tx.rollback_failed")
        logger.exception("db.tx.error")
        raise
    finally:
        if not committed:
            try:
                conn.rollback()
            except Exception:
                pass
        pool.putconn(conn)


# ── Connection-scoped helpers (use inside a transaction) ───────────────

def cx_execute(conn, sql: str, params: Optional[Sequence[Any]] = None) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params or ())


def cx_execute_rowcount(conn, sql: str, params: Optional[Sequence[Any]] = None) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.rowcount


def cx_query_one(conn, sql: str, params: Optional[Sequence[Any]] = None) -> Optional[Dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row else None


def cx_query_all(conn, sql: str, params: Optional[Sequence[Any]] = None) -> List[Dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        return [dict(r) for r in cur.fetchall()]


def cx_execute_returning(
    conn, sql: str, params: Optional[Sequence[Any]] = None
) -> Optional[Dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params or ())
        row = cur.fetchone()
        return dict(row) if row else None


# ── Auto-transaction convenience helpers (single-statement queries) ───

def query_all(sql: str, params: Optional[Sequence[Any]] = None) -> List[Dict]:
    with transaction() as conn:
        return cx_query_all(conn, sql, params)


def query_one(sql: str, params: Optional[Sequence[Any]] = None) -> Optional[Dict]:
    with transaction() as conn:
        return cx_query_one(conn, sql, params)


def execute(sql: str, params: Optional[Sequence[Any]] = None) -> None:
    with transaction() as conn:
        cx_execute(conn, sql, params)


def execute_returning(
    sql: str, params: Optional[Sequence[Any]] = None
) -> Optional[Dict]:
    with transaction() as conn:
        return cx_execute_returning(conn, sql, params)


def healthcheck() -> bool:
    try:
        with transaction() as conn:
            cx_execute(conn, "SELECT 1")
        return True
    except Exception:
        logger.exception("db.healthcheck.failed")
        return False
