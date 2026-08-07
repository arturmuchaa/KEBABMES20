from typing import Optional

from pydantic import BaseModel


class WorkHoursDto(BaseModel):
    worker_id: str
    work_date: str
    #: 'work' | 'off' | 'vacation' | 'sick' | 'absent'
    status: str = "work"
    #: Sam `time_from` bez `time_to` to zmiana OTWARTA — zapis dozwolony.
    time_from: Optional[str] = None
    time_to: Optional[str] = None
    note: str = ""
    created_by: str = ""


class StampDto(BaseModel):
    """Stempel zbiorczy: 10 osób startuje o tej samej godzinie, więc
    wpisywanie tego ręcznie to 10 pól zamiast jednego kliknięcia."""

    work_date: str
    #: 'start' zakłada otwarte wpisy, 'end' domyka istniejące otwarte.
    mode: str
    time: str
