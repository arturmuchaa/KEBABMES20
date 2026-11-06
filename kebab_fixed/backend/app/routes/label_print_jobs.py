"""Language-neutral entry point; existing Zebra URLs remain compatible aliases."""
from fastapi import APIRouter
from app.routes.labels_zebra import prepare_job, get_job, job_by_key, job_action, unit_history

router = APIRouter(prefix='/api/label-print-jobs', tags=['label-print-jobs'])
router.add_api_route('', prepare_job, methods=['POST'])
router.add_api_route('/by-key', job_by_key, methods=['GET'])
router.add_api_route('/unit-history/{unit_id}', unit_history, methods=['GET'])
router.add_api_route('/{job_id}', get_job, methods=['GET'])
router.add_api_route('/{job_id}/actions', job_action, methods=['POST'])
