from typing import Dict, List, Optional

from pydantic import BaseModel


class WorkerCreate(BaseModel):
    name: str
    role: str = "WORKER_PRODUCTION"
    pin: str = ""
    rate_per_kg: float = 0.0
    #: Podstawa pracowników ogólnych — rozliczają się z godzin, nie z kg.
    rate_per_hour: float = 0.0
    #: Dodatek do stawki za godziny przepracowane w NIEDZIELĘ.
    sunday_bonus_enabled: bool = False
    sunday_bonus_per_hour: float = 0.0
    contract_type: str = "zlecenie"
    employer_cost_amount: float = 0.0
    departments: List[str] = []
    #: Ile osób pracuje na tym stanowisku (2 = para rozbierająca na jedno
    #: nazwisko). Wpływa WYŁĄCZNIE na tempo kg/h w raporcie — nie na akord.
    crew_size: int = 1


class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    pin: Optional[str] = None
    rate_per_kg: Optional[float] = None
    rate_per_hour: Optional[float] = None
    sunday_bonus_enabled: Optional[bool] = None
    sunday_bonus_per_hour: Optional[float] = None
    contract_type: Optional[str] = None
    employer_cost_amount: Optional[float] = None
    active: Optional[bool] = None
    departments: Optional[List[str]] = None
    crew_size: Optional[int] = None


class SettlementDeductionDto(BaseModel):
    description: str
    amount: float


class KgAdjustmentDto(BaseModel):
    """Korekta kg liczona wyłącznie do płacy — bez wpływu na magazyn."""

    worker_id: str
    work_date: str
    kg_delta: float
    reason: str
    created_by: str = ""


class BulkSettleDto(BaseModel):
    """Rozliczenie całej grupy. Pola w snake_case, bo payrollApi przepuszcza
    DTO przez toSnake() — trasa czytająca camelCase dostawała puste daty
    i dry_run=True, więc zatwierdzenie nie zapisywało NICZEGO."""

    role: str
    date_from: str
    date_to: str
    dry_run: bool = True


class WorkerDeductionDto(BaseModel):
    """Potrącenie zapisane z wyprzedzeniem — czeka na rozliczenie."""

    worker_id: str
    deduction_date: str
    description: str
    amount: float
    #: 'manual' (biuro) albo 'wz' (zakup pracownika udokumentowany WZ)
    source_type: str = "manual"
    source_id: Optional[str] = None
    created_by: str = ""


class CreateSettlementDto(BaseModel):
    worker_id: str
    date_from: str
    date_to: str
    work_dates: List[str]
    #: Podstawa kilogramowa (rozbiór, produkcja).
    kg_per_date: Dict[str, float] = {}
    rate_per_kg: float
    #: Podstawa godzinowa (pracownicy ogólni) — wypełniona zamiast kg.
    hours_per_date: Dict[str, float] = {}
    rate_per_hour: float = 0.0
    deductions: List[SettlementDeductionDto] = []
    #: Potrącenia oczekujące z rejestru, wskazane do konsumpcji.
    deduction_ids: List[str] = []
    notes: str = ""
