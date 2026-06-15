from typing import List, Optional
from pydantic import BaseModel


class LoginDto(BaseModel):
    login: str
    password: str


class LoginPinDto(BaseModel):
    worker_id: str
    pin: str
    label: str = ""


class ChangePasswordDto(BaseModel):
    old_password: str
    new_password: str


class AppUserCreate(BaseModel):
    login: str
    password: str
    role: str = "office"      # 'admin' | 'office'
    display_name: str = ""


class AppUserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    new_password: Optional[str] = None
