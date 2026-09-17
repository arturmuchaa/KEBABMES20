"""Lista działów w kartotece pracownika musi zgadzać się z RBAC-em backendu.

POWÓD ISTNIENIA: 17.09.2026 panel masowni pojechał na produkcję z własnym
działem `masowanie` w uprawnieniach, ale kartoteka pracownika w biurze miała
listę działów zaszytą na sztywno — bez masowni. Efekt: dział istniał, a biuro
nie miało jak nikogo do niego przypisać, więc ekran PIN-u panelu był pusty
i stanowisko było nie do uruchomienia.

Rozjazd w drugą stronę (dział w biurze bez uprawnień w backendzie) jest równie
zły: operator dostaje przypisanie, loguje się i widzi „Brak dostępu".
"""
import re
from pathlib import Path

from app.auth.permissions import DEPARTMENT_PREFIXES

WORKERS_PAGE = (
    Path(__file__).resolve().parents[2] / "src" / "pages" / "office" / "WorkersPage.tsx"
)


def _dzialy_z_biura() -> set[str]:
    tresc = WORKERS_PAGE.read_text(encoding="utf-8")
    m = re.search(r"const ALL_DEPTS = \[(.*?)\]", tresc, re.DOTALL)
    assert m, "nie znalazłem ALL_DEPTS w WorkersPage.tsx — zmieniła się nazwa?"
    return set(re.findall(r"'([a-z0-9\-]+)'", m.group(1)))


def test_kartoteka_pracownika_zna_wszystkie_dzialy_z_rbac():
    brakujace = set(DEPARTMENT_PREFIXES) - _dzialy_z_biura()
    assert not brakujace, (
        f"działy {sorted(brakujace)} mają uprawnienia w backendzie, ale biuro nie "
        f"umie do nich nikogo przypisać (ALL_DEPTS w WorkersPage.tsx)"
    )


def test_biuro_nie_oferuje_dzialu_bez_uprawnien():
    nadmiarowe = _dzialy_z_biura() - set(DEPARTMENT_PREFIXES)
    assert not nadmiarowe, (
        f"biuro oferuje działy {sorted(nadmiarowe)}, których backend nie zna — "
        f"operator dostanie 'Brak dostępu' po zalogowaniu"
    )


def test_masownia_jest_na_obu_listach():
    assert "masowanie" in DEPARTMENT_PREFIXES
    assert "masowanie" in _dzialy_z_biura()
