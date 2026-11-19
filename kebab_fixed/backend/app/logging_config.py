"""Structured logging setup for the MES backend.

All modules should obtain loggers via ``logging.getLogger(__name__)`` after
``configure_logging()`` has been called exactly once at process start.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from app.config import settings


#: Atrybuty, które ma KAŻDY LogRecord — wszystko inne przyszło z ``extra=``.
_STANDARDOWE = frozenset(
    logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None).__dict__
) | {"message", "asctime"}


def _extra(record: logging.LogRecord) -> dict[str, Any]:
    return {k: v for k, v in record.__dict__.items()
            if k not in _STANDARDOWE and not k.startswith("_")}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in _extra(record).items():
            try:
                json.dumps(value)
                payload[key] = value
            except Exception:
                payload[key] = repr(value)
        return json.dumps(payload, ensure_ascii=False)


def _wartosc(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False) if (not value or any(c in value for c in ' "=')) else value
    try:
        return json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        return repr(value)


class PlainFormatter(logging.Formatter):
    """Linia dla ludzi + pola z ``extra`` jako ``klucz=wartość``.

    Bez pól journal mówił tylko „pallet.scan" — bez numeru palety, zamówienia
    i auta (śledztwo TRUVA/Z/2/11/26, 19.11.2026).
    """

    def __init__(self) -> None:
        super().__init__(
            fmt="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )

    def format(self, record: logging.LogRecord) -> str:
        linia = super().format(record)
        pola = _extra(record)
        if not pola:
            return linia
        dopisek = " ".join(f"{k}={_wartosc(v)}" for k, v in pola.items())
        # Ślad wyjątku zostaje na końcu, pola idą do pierwszej linii.
        glowna, sep, reszta = linia.partition("\n")
        return f"{glowna} {dopisek}{sep}{reszta}"


_CONFIGURED = False


def configure_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    level = getattr(logging, settings.log_level, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_json else PlainFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Quiet noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)
