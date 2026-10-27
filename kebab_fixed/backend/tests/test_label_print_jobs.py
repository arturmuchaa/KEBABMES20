import zlib
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.services import label_print_jobs as jobs
from app.routes.labels_zebra import router
from app.routes.label_print_jobs import router as neutral_router
from app.services import label_unit_selection as selection


def test_neutral_job_routes_keep_office_permissions():
    from app.auth.permissions import permission_for_path
    for path, method in (
        ('/api/label-print-jobs', 'POST'), ('/api/label-print-jobs/by-key', 'GET'),
        ('/api/label-print-jobs/unit-history/u1', 'GET'), ('/api/label-print-jobs/job1/actions', 'POST'),
        ('/api/label-print-jobs/job1', 'GET'),
    ):
        assert permission_for_path(path, method) == 'office'


def test_unpack_rejects_corruption_and_compression_bombs(monkeypatch):
    good = b'^XA^FDoriginal^FS^XZ'
    item = {'payload_zlib': zlib.compress(good), 'payload_sha256': jobs.digest(good)}
    assert jobs.unpack(item) == good.decode()
    for bad in (b'bad', item['payload_zlib'] + b'extra', zlib.compress(b'other'), item['payload_zlib'][:-1]):
        with pytest.raises(HTTPException) as err:
            jobs.unpack({**item, 'payload_zlib': bad})
        assert err.value.status_code == 409
    monkeypatch.setattr(jobs, 'MAX_LABEL_BYTES', 100)
    with pytest.raises(HTTPException) as err:
        jobs.unpack({'payload_zlib': zlib.compress(b'A' * 10000), 'payload_sha256': ''})
    assert err.value.status_code == 409


def test_legacy_previews_are_bounded_too(monkeypatch):
    label = '^XA^FDtest^FS^XZ'
    assert selection.bounded_unit_zpl([label])['count'] == 1
    monkeypatch.setattr(selection, 'MAX_JOB_BYTES', 50)
    with pytest.raises(HTTPException) as err:
        selection.bounded_unit_zpl(label for _ in range(1000))
    assert err.value.status_code == 413
    monkeypatch.setattr(selection, 'MAX_JOB_BYTES', 10000)
    monkeypatch.setattr(selection, 'MAX_UNITS', 1)
    with pytest.raises(HTTPException) as err:
        selection.bounded_unit_zpl([label, label])
    assert err.value.status_code == 413


@pytest.mark.parametrize('test_router,base,lookup,history', [
    (router, '/api/labels/zebra/jobs', '/api/labels/zebra/job-by-key', '/api/labels/zebra/unit-history'),
    (neutral_router, '/api/label-print-jobs', '/api/label-print-jobs/by-key', '/api/label-print-jobs/unit-history'),
])
def test_history_routes_require_session_and_ignore_browser_actor(monkeypatch, test_router, base, lookup, history):
    app = FastAPI()
    app.include_router(test_router)
    calls = []
    monkeypatch.setattr(jobs, 'prepare', lambda dto, actor: calls.append(actor) or {'ok': True})
    dto = {'idempotency_key': 'operation-1', 'printer_name': 'Zebra', 'printer_uid': 'usb-1'}
    client = TestClient(app)
    assert client.post(base, json=dto).status_code == 401
    assert client.get(base + '/a').status_code == 401
    assert client.get(history + '/u1').status_code == 401
    assert client.get(lookup + '?key=operation-1').status_code == 401
    assert client.post(base + '/a/actions', json={'action': 'begin'}).status_code == 401
    app = FastAPI()
    app.include_router(test_router)
    @app.middleware('http')
    async def subject(request, call_next):
        request.state.subject = {'id': 'trusted-id', 'kind': 'office', 'name': 'Display name'}
        return await call_next(request)
    client = TestClient(app)
    assert client.post(base, json={**dto, 'actor': 'spoofed'}).status_code == 422
    assert client.post(base, json={**dto, 'source_job_id': ''}).status_code == 422
    assert client.post(base, json=dto).status_code == 200
    assert calls == ['office:trusted-id']
