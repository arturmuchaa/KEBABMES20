"""Endpoint renderu etykiet Zebra (ZPL)."""
from fastapi import APIRouter, HTTPException, Query, Request

from app.services import zebra_labels_service as svc
from app.services import label_print_jobs as jobs
from app.models.label_print_jobs import PrepareLabelJob, LabelJobAction

router = APIRouter(prefix="/api/labels/zebra", tags=["labels-zebra"])


@router.get("/render")
def render(plan_line_id: str = Query(...), client_id: str = Query(""), recipe_id: str = Query(""), unit_ids: str | None = Query(None)):
    return svc.render_zebra_labels(plan_line_id, client_id, recipe_id, unit_ids)


def _actor(request: Request) -> str:
    subject = getattr(request.state, 'subject', None) or {}
    actor = subject.get('id')
    if not actor:
        raise HTTPException(401, 'Wymagane zalogowanie operatora wydruku')
    return f"{subject.get('kind') or 'user'}:{actor}"


@router.post('/jobs')
def prepare_job(dto: PrepareLabelJob, request: Request):
    return jobs.prepare(dto.model_dump(), _actor(request))


@router.get('/jobs/{job_id}')
def get_job(job_id: str, request: Request, unit_ids: str | None = Query(None)):
    _actor(request)
    return jobs.get_job(job_id, None if unit_ids is None else unit_ids.split(','))


@router.get('/job-by-key')
def job_by_key(request: Request, key: str = Query(..., min_length=8, max_length=128)):
    _actor(request)
    return jobs.find_by_key(key)


@router.post('/jobs/{job_id}/actions')
def job_action(job_id: str, dto: LabelJobAction, request: Request):
    return jobs.transition(job_id, dto.action, _actor(request), dto.attempt_token,
                           dto.printer_uid, dto.acknowledge_uncertain)


@router.get('/unit-history/{unit_id}')
def unit_history(unit_id: str, request: Request):
    _actor(request)
    return jobs.unit_history(unit_id)
