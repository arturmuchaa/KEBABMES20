from typing import Dict, List, Optional

from pydantic import BaseModel


class WorkerCreate(BaseModel):
    name: str
    role: str = "WORKER_PRODUCTION"
    pin: str = ""
    rate_per_kg: float = 0.0
    contract_type: str = "zlecenie"
    employer_cost_amount: float = 0.0
    departments: List[str] = []


class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    rate_per_kg: Optional[float] = None
    contract_type: Optional[str] = None
    employer_cost_amount: Optional[float] = None
    active: Optional[bool] = None
    departments: Optional[List[str]] = None


class SettlementDeductionDto(BaseModel):
    description: str
    amount: float


class CreateSettlementDto(BaseModel):
    worker_id: str
    date_from: str
    date_to: str
    work_dates: List[str]
    kg_per_date: Dict[str, float] = {}
    rate_per_kg: float
    deductions: List[SettlementDeductionDto] = []
    notes: str = ""
