"""Endpointy szablonów etykiet."""
from fastapi import APIRouter

from app.models.label_templates import LabelTemplateUpsert
from app.services import label_templates_service as svc

router = APIRouter(prefix="/api/label-templates", tags=["label-templates"])


@router.put("")
def upsert(dto: LabelTemplateUpsert):
    return svc.upsert_template(dto.model_dump())


@router.get("")
def get(client_id: str = "", recipe_id: str = ""):
    tpl = svc.get_template(client_id, recipe_id)
    if tpl is None:
        return {"exists": False, "template": None}
    return {"exists": True, "template": tpl}


@router.get("/exists")
def exists(client_id: str = "", recipe_id: str = ""):
    return svc.template_exists(client_id, recipe_id)


@router.get("/resolve")
def resolve(client_id: str = "", recipe_id: str = ""):
    """Zwraca {kind: 'zebra'|'pdf'|'none'} — którą etykietę ma para klient+receptura."""
    return svc.resolve_label_kind(client_id, recipe_id)


@router.get("/all")
def list_all():
    return svc.list_templates()


@router.delete("/{template_id}")
def delete(template_id: str):
    return svc.delete_template(template_id)
