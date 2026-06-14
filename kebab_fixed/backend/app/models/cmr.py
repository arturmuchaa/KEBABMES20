from typing import List
from pydantic import BaseModel


class CmrGoodsLine(BaseModel):
    name: str
    qty: int = 0
    kg: float = 0.0


class CmrForm(BaseModel):
    carrier_id: str = ""
    plate: str = ""
    invoice_no: str = ""
    instructions: str = "TRANSPORT MROŻNICZY -22"
    goods_manual: List[CmrGoodsLine] = []
