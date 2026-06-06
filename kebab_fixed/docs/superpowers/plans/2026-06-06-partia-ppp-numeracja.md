# Numeracja partii łączonej PP vs PPP — Plan wdrożenia (Faza 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozróżnić partię łączoną w mieszalniku (`PP{n}`) od łączonej na produkcji (`PPP{n}`), żeby z numeru było widać miejsce zmieszania.

**Architecture:** Dodajemy czystą funkcję `production_combined_batch_no` (PPP) obok istniejącej `combined_batch_no` (PP) w `app/utils/batch_numbers.py`. Jedyna zmiana logiki produkcji to `finished_goods_service._compute_kebab_batch_no`, gdzie gałąź „≥2 partie” przechodzi z PP na PPP (osobny licznik `ppp_seq`). Masowanie (mixer) zostaje na PP.

**Tech Stack:** Python 3, pytest (czyste testy logiczne, bez DB; zależność DB w teście mockowana przez monkeypatch).

Spec: `docs/superpowers/specs/2026-06-06-identyfikowalnosc-partii-pp-ppp-raport-wet-design.md`
Gałąź: `feat/partia-ppp-raport-wet`

---

### Task 1: Funkcje numeracji PPP w batch_numbers.py

**Files:**
- Modify: `backend/app/utils/batch_numbers.py`
- Test: `backend/tests/test_batch_numbers.py`

- [ ] **Step 1: Dopisz failing testy na końcu `backend/tests/test_batch_numbers.py`**

```python
# --- production_combined_batch_no / is_production_combined --------------------
def test_production_combined_batch_no():
    from app.utils.batch_numbers import production_combined_batch_no
    assert production_combined_batch_no(1) == "PPP1"
    assert production_combined_batch_no(7) == "PPP7"


def test_is_production_combined_true_for_ppp():
    from app.utils.batch_numbers import is_production_combined
    assert is_production_combined("PPP1") is True


def test_is_production_combined_false_for_pp_and_bare():
    from app.utils.batch_numbers import is_production_combined
    assert is_production_combined("PP1") is False
    assert is_production_combined("326") is False
    assert is_production_combined(None) is False


def test_pp_is_not_mistaken_for_ppp_by_is_combined():
    # PP (mieszalnik) nadal jest "combined", ale NIE "production_combined"
    from app.utils.batch_numbers import is_combined, is_production_combined
    assert is_combined("PP1") is True
    assert is_production_combined("PP1") is False
```

- [ ] **Step 2: Uruchom testy — mają NIE przejść (brak funkcji)**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -q`
Expected: FAIL/ERROR — `ImportError: cannot import name 'production_combined_batch_no'`

- [ ] **Step 3: Dodaj implementację w `backend/app/utils/batch_numbers.py`**

Obok istniejącego `_COMBINED_NO_RE` dodaj regex i funkcje. Wstaw po `is_combined`:

```python
_PROD_COMBINED_NO_RE = re.compile(r"^PPP\d+$")


def production_combined_batch_no(n: int) -> str:
    """Numer partii łączonej NA PRODUKCJI (marynowane mięso zmieszane przy
    formowaniu), w odróżnieniu od PP łączonej w mieszalniku."""
    return f"PPP{n}"


def is_production_combined(batch_no) -> bool:
    """Czy numer to partia łączona na produkcji (prefiks PPP + cyfry, np. PPP1)."""
    return bool(batch_no) and bool(_PROD_COMBINED_NO_RE.match(batch_no))
```

Uwaga: `is_combined` używa `_COMBINED_NO_RE = ^PP\d+$`, który NIE matchuje `PPP1`
(bo po `PP` wymaga cyfry, a tam jest `P`). Czyli `is_combined("PPP1")` == False —
to jest poprawne i pożądane; nie trzeba zmieniać `is_combined`.

- [ ] **Step 4: Uruchom testy — mają przejść**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -q`
Expected: PASS (wszystkie, łącznie z nowymi 4)

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/batch_numbers.py backend/tests/test_batch_numbers.py
git commit -m "feat(numeracja): production_combined_batch_no (PPP) + is_production_combined

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Produkcja łączona używa PPP zamiast PP

**Files:**
- Modify: `backend/app/services/finished_goods_service.py` (import w linii 29; `_compute_kebab_batch_no` ≈425-435)
- Test: `backend/tests/test_compute_kebab_batch_no.py` (nowy)

- [ ] **Step 1: Utwórz failing test `backend/tests/test_compute_kebab_batch_no.py`**

```python
import app.services.finished_goods_service as fg


def test_single_batch_keeps_bare_number():
    # 1 partia → 'ddmmrr <numer>' (bez prefiksu)
    out = fg._compute_kebab_batch_no("2026-06-06", ["326"])
    assert out == "060626 326"


def test_two_batches_get_ppp_not_pp(monkeypatch):
    # ≥2 partie zmieszane na produkcji → PPP (NIE PP)
    monkeypatch.setattr(fg, "next_seq", lambda key: 1)
    out = fg._compute_kebab_batch_no("2026-06-06", ["357", "358"])
    assert out == "060626 PPP1"
    assert out.split(" ")[1] == "PPP1"   # prefiks to PPP, nie PP


def test_two_batches_use_ppp_seq_counter(monkeypatch):
    # licznik musi być 'ppp_seq', nie 'pp_seq'
    seen = {}
    def fake_seq(key):
        seen["key"] = key
        return 3
    monkeypatch.setattr(fg, "next_seq", fake_seq)
    out = fg._compute_kebab_batch_no("2026-06-06", ["357", "358"])
    assert out == "060626 PPP3"
    assert seen["key"] == "ppp_seq"
```

- [ ] **Step 2: Uruchom test — ma NIE przejść**

Run: `cd backend && python3 -m pytest tests/test_compute_kebab_batch_no.py -q`
Expected: FAIL — `test_two_batches_get_ppp_not_pp` zwraca `060626 PP1`, oczekiwano `060626 PPP1`; `test_two_batches_use_ppp_seq_counter` widzi `pp_seq`.

- [ ] **Step 3: Zmień import w `backend/app/services/finished_goods_service.py` linia 29**

Z:
```python
from app.utils.batch_numbers import combined_batch_no, kebab_batch_no
```
Na:
```python
from app.utils.batch_numbers import (
    combined_batch_no,
    kebab_batch_no,
    production_combined_batch_no,
)
```

- [ ] **Step 4: Zmień gałąź łączoną w `_compute_kebab_batch_no` (≈434)**

Z:
```python
    pp = combined_batch_no(next_seq("pp_seq"))
    return kebab_batch_no(produced_date, pp)
```
Na:
```python
    # ≥2 partie fizycznie zmieszane na PRODUKCJI → PPP (PP zostaje dla mieszalnika).
    ppp = production_combined_batch_no(next_seq("ppp_seq"))
    return kebab_batch_no(produced_date, ppp)
```

Zaktualizuj też docstring funkcji (≈429-430): „>1 partii (fizycznie zmieszane na
produkcji) → nowa partia łączona PPP{n}, numer 'ddmmrr PP**P**{n}'.”

Uwaga: `combined_batch_no` pozostaje zaimportowane, ale jeśli nie jest już używane
w tym pliku — usuń je z importu, by uniknąć martwego importu. Sprawdź:
`grep -n "combined_batch_no" backend/app/services/finished_goods_service.py`
— jeśli jedyne trafienie to linia importu, usuń `combined_batch_no,` z importu.

- [ ] **Step 5: Uruchom test — ma przejść**

Run: `cd backend && python3 -m pytest tests/test_compute_kebab_batch_no.py -q`
Expected: PASS (3 testy)

- [ ] **Step 6: Pełny pytest — nic nie zepsute**

Run: `cd backend && python3 -m pytest -q`
Expected: PASS (wszystkie; było 92 + 4 (Task 1) + 3 (Task 2) = 99)

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/finished_goods_service.py backend/tests/test_compute_kebab_batch_no.py
git commit -m "feat(produkcja): partia łączona na produkcji = PPP (licznik ppp_seq)

Masowanie (mieszalnik) nadal PP; tylko _compute_kebab_batch_no (produkcja)
przechodzi na PPP, by z numeru było widać gdzie zmieszano partie.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Weryfikacja zasięgu — żadna inna ścieżka nie tworzy łączonej z pominięciem _compute_kebab_batch_no

**Files:** (tylko odczyt/weryfikacja)

- [ ] **Step 1: Potwierdź, że produkcyjne łączenie idzie wyłącznie przez _compute_kebab_batch_no**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
grep -rnE "combined_batch_no|_compute_kebab_batch_no" app/services/finished_goods_service.py
grep -rnE "combined_batch_no" app/services/mixing_service.py app/services/seasoned_meat_service.py
```
Expected: w `finished_goods_service` łączenie tylko w `_compute_kebab_batch_no`;
w `mixing_service`/`seasoned_meat_service` nadal `combined_batch_no` (PP) — to OK
(mieszalnik). Jeśli pojawi się inne miejsce w finished_goods tworzące PP dla wielu
partii — zgłoś (poza zakresem tego planu, odnotuj do osobnego zadania).

- [ ] **Step 2: (opcjonalnie) odczyt z bazy testowej, że nowe produkcje dają PPP**

Tylko jeśli ktoś wykona testową produkcję z ≥2 partii po wdrożeniu — sprawdzenie
read-only (NIE twórz danych testowych specjalnie):
```bash
set -a; . /opt/kebab/config/.env; set +a
psql "$DATABASE_URL" -c "SELECT batch_no FROM finished_goods WHERE batch_no LIKE '%PPP%' ORDER BY created_at DESC LIMIT 5;"
```
Expected: nowe wpisy produkcji z wielu partii mają `ddmmrr PPP{n}`.

---

## Faza 2 (osobny plan, po wdrożeniu Fazy 1)

Raport identyfikowalności partii dla weterynarii (endpoint + strona druku):
skład rodziców z kg, trasa ćwiartka→wyrób, bilans masy, rozwinięcie PP/PPP.
Zostanie rozpisany w `docs/superpowers/plans/` po zamknięciu Fazy 1.
