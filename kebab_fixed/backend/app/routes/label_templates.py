"""Endpointy szablonów etykiet."""
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from typing import Literal

from app.models.label_templates import LabelTemplateUpsert
from app.services import label_templates_service as svc

router = APIRouter(prefix="/api/label-templates", tags=["label-templates"])


@router.post("/import-raster")
async def import_raster_file(file: UploadFile = File(...), dpi: int = Query(...)):
    """Offline, bounded import. No printer access, DB writes or external service."""
    from app.services.label_raster_import import MAX_SOURCE_BYTES, LabelImportError, import_raster
    from starlette.concurrency import run_in_threadpool

    try:
        source = await file.read(MAX_SOURCE_BYTES + 1)
        return await run_in_threadpool(lambda: import_raster(source, dpi).as_import())
    except LabelImportError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        await file.close()


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


@router.get('/history/{source}/{template_id}')
def history(source: Literal['label_templates', 'zebra_label_designs'], template_id: str):
    from app.db import query_all
    from app.services.label_print_jobs import SCOPE
    rows = query_all('''SELECT id,revision,operation,created_at FROM label_template_revisions
        WHERE scope_key=%s AND source=%s AND template_id=%s ORDER BY revision DESC LIMIT 100''',
        (SCOPE, source, template_id))
    return [{'id': r['id'], 'revision': r['revision'], 'operation': r['operation'], 'createdAt': str(r['created_at'])} for r in rows]


@router.get('/revisions/{revision_id}')
def revision(revision_id: int):
    from app.db import query_one
    from app.services.label_print_jobs import SCOPE
    row = query_one('SELECT * FROM label_template_revisions WHERE id=%s AND scope_key=%s', (revision_id, SCOPE))
    if not row:
        raise HTTPException(404, 'Nie znaleziono rewizji szablonu')
    return {'id': row['id'], 'revision': row['revision'], 'source': row['source'],
            'templateId': row['template_id'], 'operation': row['operation'], 'document': row['document'], 'createdAt': str(row['created_at'])}


@router.delete("/{template_id}")
def delete(template_id: str):
    return svc.delete_template(template_id)
