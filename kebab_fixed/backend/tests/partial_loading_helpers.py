"""Operator confirmation for legacy integration scenarios that permit shortages.

Tests of the confirmation contract itself call the service directly. This helper
models TWO explicit requests; it never disables or mocks production validation.
"""
from fastapi import HTTPException
from app.services.loading_service import finalize_loading as submit


def finalize_loading(*args, **kwargs):
    try:
        return submit(*args, **kwargs)
    except HTTPException as exc:
        if not isinstance(exc.detail, dict) or exc.detail.get("code") != "PARTIAL_LOADING_CONFIRMATION_REQUIRED":
            raise
        return submit(*args, **kwargs, partial_confirmation=exc.detail["confirmation_token"])
