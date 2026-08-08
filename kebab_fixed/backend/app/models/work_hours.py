from typing import Optional

from pydantic import BaseModel


class WorkHoursDto(BaseModel):
    worker_id: str
    work_date: str
    #: Numer zmiany w dniu. 1 = zwykła zmiana; 2+ to powrót po południu
    #: (6-15, potem 18-20) — sporadyczny, więc nie pokazujemy go domyślnie.
    seq: int = 1
    #: 'work' | 'off' | 'vacation' | 'sick' | 'absent'
    status: str = "work"
    #: Sam `time_from` bez `time_to` to zmiana OTWARTA — zapis dozwolony.
    time_from: Optional[str] = None
    time_to: Optional[str] = None
    note: str = ""
    created_by: str = ""
