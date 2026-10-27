from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class PrepareLabelJob(BaseModel):
    model_config = ConfigDict(extra='forbid')
    idempotency_key: str = Field(min_length=8, max_length=128)
    printer_name: str = Field(min_length=1, max_length=256)
    printer_uid: str = Field(min_length=1, max_length=256)
    transport: Literal['browserprint', 'file', 'browser'] = 'browserprint'
    language: Literal['zpl', 'a4'] = 'zpl'
    org_code: str | None = Field(default=None, max_length=128)
    plan_line_id: str = Field(default='', max_length=128)
    client_id: str = Field(default='', max_length=256)
    recipe_id: str = Field(default='', max_length=128)
    unit_ids: list[str] | None = Field(default=None, max_length=1000)
    source_job_id: str | None = Field(default=None, min_length=1, max_length=128)
    acknowledge_uncertain: bool = False


class LabelJobAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['begin', 'cancel', 'submitted', 'exported', 'dialog_opened', 'uncertain', 'recover']
    attempt_token: str | None = Field(default=None, max_length=128)
    printer_uid: str | None = Field(default=None, max_length=256)
    acknowledge_uncertain: bool = False
