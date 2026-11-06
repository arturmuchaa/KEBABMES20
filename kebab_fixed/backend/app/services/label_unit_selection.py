"""Shared unit selection for Zebra render and reprint; never creates units."""
import re
from collections.abc import Iterable
from fastapi import HTTPException

MAX_LABEL_BYTES = 4 * 1024 * 1024
MAX_JOB_BYTES = 64 * 1024 * 1024
MAX_UNITS = 1000


def selected_unit_ids(unit_ids: str | None) -> list[str] | None:
    if unit_ids is None:
        return None
    ids = [value.strip() for value in unit_ids.split(',')]
    if not ids or len(ids) > MAX_UNITS or any(not value or len(value) > 128 for value in ids) or len(ids) != len(set(ids)):
        raise HTTPException(422, 'Nieprawidłowa lista sztuk do dodruku')
    return ids


def bounded_unit_zpl(blocks: Iterable[str]) -> dict:
    """Legacy preview endpoints must not allocate an unbounded batch either."""
    payloads, total = [], 0
    for block in blocks:
        payload = one_copy(block)
        size = len(payload.encode('utf-8'))
        total += size + 1
        if len(payloads) >= MAX_UNITS or size > MAX_LABEL_BYTES or total > MAX_JOB_BYTES:
            raise HTTPException(413, 'Seria przekracza limit pamięci. Wybierz mniejszą paczkę sztuk; nic nie wysłano.')
        payloads.append(payload)
    return {'ok': True, 'zpl': '\n'.join(payloads), 'count': len(payloads)}


def select_existing_units(units: list[dict], unit_ids: str | None) -> list[dict]:
    if unit_ids is None:
        return units
    ids = selected_unit_ids(unit_ids)
    requested = set(ids)
    selected = [unit for unit in units if unit["id"] in requested]
    if len(selected) != len(requested):
        raise HTTPException(422, "Wybrane sztuki nie należą do wskazanej linii planu")
    return selected


def has_unit_qr(zpl: str) -> bool:
    """Require the unchanged MES token inside a QR field, not mere plain text."""
    return any("^FX" not in field and "^BQ" in field and re.search(r"\^FD[HLMQ]A,\[\[QR\]\]\s*$", field)
               for field in zpl.split("^FS"))


def unique_unit_qrs(units: list[dict]) -> bool:
    codes = [unit.get("qr_code") for unit in units]
    return all(isinstance(code, str) and code.startswith("U|") and len(code) > 2 for code in codes) and len(set(codes)) == len(codes)


def validate_template_binding(units: list[dict], client_keys: list[str], recipe_id: str) -> None:
    if any(unit.get("recipe_id") != recipe_id or unit.get("client_name") not in client_keys for unit in units):
        raise HTTPException(422, "Szablon klienta/receptury nie pasuje do wybranych sztuk")


def one_copy(zpl: str) -> str:
    """One existing unit = one label; never inherit Designer's print quantity."""
    validate_print_zpl(zpl)
    if zpl.count("^XA") != 1 or zpl.count("^XZ") != 1 or not zpl.strip().startswith("^XA") or not zpl.strip().endswith("^XZ"):
        raise HTTPException(422, "Szablon musi zawierać dokładnie jedną etykietę ZPL")
    body = re.sub(r"\^PQ[^\^~]*", "", zpl.strip()[:-3]).rstrip()
    return body + "\n^PQ1,0,0,Y\n^XZ"


def validate_print_zpl(zpl: str) -> None:
    """Bounded page-only ZPL subset. No device/storage/network commands.

    This is NOT a full ZPL interpreter. Unknown commands and compressed/binary
    graphics must go through a dedicated importer instead of raw passthrough.
    """
    if not zpl or len(zpl) > 4 * 1024 * 1024 or "~" in zpl or any(ord(c) < 32 and c not in "\r\n\t" for c in zpl):
        raise HTTPException(422, "Nieprawidłowy ZPL lub niedozwolone polecenia urządzenia")
    allowed = {"XA", "XZ", "FO", "FT", "FS", "FD", "FH", "PW", "LL", "LH", "LS", "LT", "CI", "CF",
               "A0", "GB", "GF", "BQ", "BC", "BY", "FB", "FR", "FW", "FX", "PQ"}
    cursor = 0
    for match in re.finditer(r"\^([A-Z0-9]{2})([^\^]*)", zpl):
        if zpl[cursor:match.start()].strip():
            raise HTTPException(422, "Nieprawidłowa składnia ZPL")
        cursor = match.end()
        cmd, value = match.group(1), match.group(2).strip()
        if cmd not in allowed:
            raise HTTPException(422, f"Nieobsługiwana instrukcja wydruku ZPL: ^{cmd}")
        if cmd == "GF":
            graphic = re.fullmatch(r"A,(\d{1,7}),(\d{1,7}),(\d{1,4}),([0-9A-Fa-f\r\n]+)", value)
            if not graphic:
                raise HTTPException(422, "Wydruk wymaga nieskompresowanej grafiki ^GFA (HEX)")
            total, used, width = map(int, graphic.groups()[:3])
            if not width or total != used or total % width or total > 1_000_000 or total <= 0:
                raise HTTPException(422, "Nieprawidłowy rozmiar grafiki ZPL")
            if len(re.sub(r"[\r\n]", "", graphic.group(4))) != total * 2:
                raise HTTPException(422, "Uszkodzona grafika ZPL")
    if cursor != len(zpl) or zpl.count("^XA") != 1 or zpl.count("^XZ") != 1:
        raise HTTPException(422, "Wymagana jedna kompletna etykieta ZPL")
