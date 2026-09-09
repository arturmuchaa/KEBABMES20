"""Podział zamówienia na część fakturowaną i część wydawaną na WZ.

Właściciel (2026-09-09): „system równomiernie odejmuje sztuki, chcę aby
wszystkie pozycje były, ale mniej" ORAZ „jeżeli chcę 8000 kg i 5005 kg, to
musi się dać tak dzielić, wtedy trzeba usunąć jakąś sztukę, tak aby trafić
w ten podział".

Stąd dwa wymagania naraz: rozkład ma być równomierny, a suma ma trafiać
DOKŁADNIE. Realizujemy to w trzech krokach:

  1. równomiernie — każda pozycja oddaje ten sam procent sztuk,
  2. dobicie do celu NAJMNIEJSZYM ruchem (1 sztuka, potem wymiana dwóch —
     +1/-1 albo obie w tę samą stronę —, potem wymiana trzech: dwie sztuki
     w górę za jedną w dół albo jedna w górę za dwie w dół) — żeby nie
     zepsuć równomierności z kroku 1 mocniej, niż potrzeba,
  3. gdy krok 2 nie trafia z punktu równomiernego — SPRAWDZAMY to (nie
     ufamy po cichu), liczymy PRAWDZIWĄ najbliższą osiągalną sumę bitsetem
     (patrz `_bitset_prefiksy`) i jeśli trzeba, dobieramy sztuki wprost do
     niej, żeby nigdy nie zwrócić po cichu rozminiętego wyniku.

Fix po review (2026-09-09, runda 1): oryginalna wersja zakładała, że wagi
sztuk leżą na siatce 5 kg (typowe w zakładzie), ale niczego takiego nie
wymuszała. Dwie konsekwencje, obie naprawione tutaj:
  - `_osiagalne_sumy` (poprzednio: pełne wyliczenie zbioru sum przez pętlę
    po KAŻDEJ sztuce) eksplodowało kombinatorycznie przy wagach spoza
    siatki — zamienione na bitset (liczba całkowita w Pythonie, bit i =
    "suma i setnych kg da się złożyć") z dokładaniem `qty` sztuk przez
    PODWAJANIE (rozkład binarny ilości), więc czas nie zależy od tego, czy
    waga jest "ładna";
  - drugie dobicie do najbliższej sumy nie sprawdzało własnego wyniku, więc
    przy ruchu 4+ sztuk po cichu zwracało rozminiętą sumę. Teraz `trafiono`
    liczymy na końcu z PRAWDZIWEJ sumy vs cel, a gdy dobicie zawiedzie —
    bierzemy rozkład sztuk odtworzony wprost z bitseta (gwarantowanie
    dokładny), zamiast ufać wynikowi lokalnego przeszukania.

Wagi sztuk w zakładzie są zwykle wielokrotnościami 5 kg, więc osiągalna
jest każda wielokrotność 5 kg i cel poza tą siatką (np. połowa nieparzystej
sumy: 13 005 / 2 = 6502,5) jest nieosiągalny. Dla innych wag osiągalność
liczymy dokładnie DLA WAG BĘDĄCYCH WIELOKROTNOŚCIĄ 0,01 KG — bitset ma
granulację `SKALA` (setne kg), więc dokładniejsze wagi (np. 13,9885 kg)
zaokrąglamy do tej granulacji przy liczeniu osiągalności; sam wynik
(`kg_fv`) i tak wraca policzony z PRAWDZIWYCH, niezaokrąglonych wag.

Fix po review (2026-09-09, runda 2): `limit_scaled` liczony z niezaokrąglonej
sumy (`round(calosc * SKALA)`) mógł wypaść O JEDNĄ JEDNOSTKĘ SKALI za mały
względem sumy wag ZAOKRĄGLONYCH, których bitset naprawdę używa (np. dla
4 × 13,9885 kg: `round(13.9885*100)*4 = 1399*4 = 5596`, a
`round(4*13.9885*100) = 5595`). Maska wtedy po cichu ucinała bit „wszystkie
sztuki" — sumę, która z definicji ZAWSZE musi być osiągalna. Fix: liczymy
`limit_scaled` z TYCH SAMYCH zaokrąglonych wag co bitset (`_limit_scaled`),
nie z niezaokrąglonej sumy — wtedy suma „bierzemy wszystko" z definicji
mieści się w masce.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Tuple

#: Poniżej tej różnicy uznajemy kilogramy za równe (błąd zmiennoprzecinkowy).
EPS = 1e-9

#: Granulacja bitseta osiągalności — setne kilograma (wagi zaokrąglamy do niej).
SKALA = 100


def _suma_fv(stan: List[Dict[str, Any]]) -> float:
    return sum(x["qty_invoice"] * x["kg_per_unit"] for x in stan)


def _rownomiernie(linie: List[Dict[str, Any]], cel: float, calosc: float) -> List[Dict[str, Any]]:
    """Krok 1: każda pozycja oddaje ten sam procent sztuk."""
    udzial = min(1.0, cel / calosc) if calosc > 0 else 0.0
    stan = []
    for l in linie:
        qty = int(l.get("qty") or 0)
        dokladnie = qty * udzial
        baza = int(dokladnie)
        stan.append({"id": l.get("id"), "qty": qty,
                     "kg_per_unit": float(l.get("kg_per_unit") or 0),
                     "qty_invoice": baza, "_reszta": dokladnie - baza})
    for w in sorted(stan, key=lambda w: -w["_reszta"]):
        if w["qty_invoice"] >= w["qty"]:
            continue
        if abs(_suma_fv(stan) + w["kg_per_unit"] - cel) < abs(_suma_fv(stan) - cel):
            w["qty_invoice"] += 1
    return stan


def _ruch(*pary: Tuple[int, int]) -> Dict[int, int]:
    """Złóż listę (indeks_pozycji, znak) w słownik indeks->delta sztuk.

    Sumuje powtórzenia tego samego indeksu (np. dwie sztuki tej samej
    pozycji), żeby wymiany mogły swobodnie trafiać w tę samą linię bez
    osobnej obsługi każdego przypadku identyczności.
    """
    c: Counter = Counter()
    for i, znak in pary:
        c[i] += znak
    return dict(c)


def _zastosuj_ruch(stan: List[Dict[str, Any]], delty: Dict[int, int]) -> bool:
    """Sprawdza wykonalność ruchu (indeks->delta) i — jeśli można — go stosuje."""
    for i, delta in delty.items():
        nowe = stan[i]["qty_invoice"] + delta
        if nowe < 0 or nowe > stan[i]["qty"]:
            return False
    for i, delta in delty.items():
        stan[i]["qty_invoice"] += delta
    return True


def _dobij(stan: List[Dict[str, Any]], cel: float) -> bool:
    """Krok 2: najmniejszy ruch trafiający DOKŁADNIE w cel. True = trafiono.

    Ruchy w kolejności rosnącej liczby przełożonych sztuk, żeby nie zepsuć
    równomierności z kroku 1 mocniej, niż potrzeba: 1 sztuka -> wymiana
    dwóch (+1/-1 albo obie w tę samą stronę) -> wymiana trzech (dwie sztuki
    w górę za jedną w dół albo jedna w górę za dwie w dół).
    """
    d = cel - _suma_fv(stan)
    if abs(d) < EPS:
        return True

    n = len(stan)
    kg = [w["kg_per_unit"] for w in stan]

    # 1 sztuka w górę albo w dół.
    for i in range(n):
        if abs(kg[i] - d) < EPS and _zastosuj_ruch(stan, _ruch((i, 1))):
            return True
        if abs(-kg[i] - d) < EPS and _zastosuj_ruch(stan, _ruch((i, -1))):
            return True

    # Wymiana dwóch: +1 na jednej pozycji, -1 na drugiej.
    for i in range(n):
        for j in range(n):
            if i != j and abs(kg[i] - kg[j] - d) < EPS \
                    and _zastosuj_ruch(stan, _ruch((i, 1), (j, -1))):
                return True

    # Dwie sztuki w tę samą stronę (także dwie sztuki jednej pozycji).
    for i in range(n):
        for j in range(i, n):
            if abs(kg[i] + kg[j] - d) < EPS and _zastosuj_ruch(stan, _ruch((i, 1), (j, 1))):
                return True
            if abs(-kg[i] - kg[j] - d) < EPS and _zastosuj_ruch(stan, _ruch((i, -1), (j, -1))):
                return True

    # Wymiana trzech: dwie sztuki w górę za jedną w dół.
    for i in range(n):
        for j in range(i, n):
            for k in range(n):
                if abs(kg[i] + kg[j] - kg[k] - d) < EPS \
                        and _zastosuj_ruch(stan, _ruch((i, 1), (j, 1), (k, -1))):
                    return True

    # Wymiana trzech: jedna sztuka w górę za dwie w dół.
    for i in range(n):
        for j in range(n):
            for k in range(j, n):
                if abs(kg[i] - kg[j] - kg[k] - d) < EPS \
                        and _zastosuj_ruch(stan, _ruch((i, 1), (j, -1), (k, -1))):
                    return True

    return False


def _limit_scaled(linie: List[Dict[str, Any]]) -> int:
    """Suma WSZYSTKICH sztuk (w setnych kg), licząc z TYCH SAMYCH
    zaokrąglonych wag, których używa bitset — nie z niezaokrąglonej sumy.

    To jest kluczowe: „bierzemy wszystko" to zawsze legalny podział, więc ta
    suma MUSI być osiągalna. Gdyby limit liczyć z niezaokrąglonej sumy kg,
    zaokrąglenie POSZCZEGÓLNYCH wag mogłoby dać sumę o jedną jednostkę
    skali WIĘKSZĄ niż limit — maska ucinałaby wtedy bit „wszystko" po cichu.
    """
    total = 0
    for l in linie:
        waga = round(float(l.get("kg_per_unit") or 0) * SKALA)
        qty = int(l.get("qty") or 0)
        if waga > 0 and qty > 0:
            total += waga * qty
    return total


def _bitset_prefiksy(linie: List[Dict[str, Any]], limit_scaled: int) -> List[int]:
    """Bitsety osiągalnych sum (w setnych kg) dla KAŻDEGO prefiksu pozycji.

    `wynik[k]` to zbiór sum osiągalnych z pierwszych `k` pozycji (bit `i`
    ustawiony = suma `i` setnych kg da się złożyć); `wynik[0]` = {0}.
    Dokładanie `qty` sztuk tej samej wagi robimy przez PODWAJANIE (rozkład
    binarny ilości: kawałki 1, 2, 4, 8… sztuk), a nie pętlą po każdej
    sztuce — to jest kluczowa różnica względem starej, wykładniczej wersji:
    czas nie zależy od tego, czy waga leży na jakiejś "ładnej" siatce.
    Po każdym kroku przycinamy maską do `limit_scaled`, żeby liczba całkowita
    (Python int) nie rosła bez końca.
    """
    maska = (1 << (limit_scaled + 1)) - 1
    wynik = [1]  # bit 0 = suma 0,00 kg — zawsze osiągalna (zero sztuk).
    mozliwe = 1
    for l in linie:
        waga = round(float(l.get("kg_per_unit") or 0) * SKALA)
        qty = int(l.get("qty") or 0)
        if waga > 0 and qty > 0:
            pozostaje = qty
            krok = 1
            while pozostaje > 0:
                k = min(krok, pozostaje)
                przesuniecie = k * waga
                if przesuniecie <= limit_scaled:
                    mozliwe |= (mozliwe << przesuniecie) & maska
                pozostaje -= k
                krok *= 2
        wynik.append(mozliwe)
    return wynik


def _dobierz_bitsetem(linie: List[Dict[str, Any]], cel: float) -> Tuple[float, List[Dict[str, Any]]]:
    """Krok 3: PRAWDZIWA najbliższa osiągalna suma + gwarantowany rozkład sztuk.

    Wywoływane tylko wtedy, gdy `_rownomiernie` + `_dobij` nie trafiły w cel
    z równomiernego punktu startowego. Bitset liczy się raz; służy i do
    znalezienia najbliższej sumy, i — przez przeszukanie prefiksów od
    ostatniej pozycji do pierwszej — do odtworzenia KONKRETNYCH sztuk, które
    tę sumę dają. Odtworzenie jest dokładne z definicji (sprawdzane przy
    każdym kroku przez bitset prefiksu), więc nie ma szans na rozminięcie.

    `limit_scaled` liczymy z `_limit_scaled` (zaokrąglone wagi — to samo
    źródło, którego używa `_bitset_prefiksy`), NIE z niezaokrąglonego
    `calosc` — inaczej suma „wszystkie sztuki" mogłaby wypaść poza maskę
    i zostać po cichu ucięta (runda 2 review). `cel_scaled` przycinamy do
    tego samego zakresu, bo `cel` (parametr, niezaokrąglony) może się od
    niego różnić o ułamek jednostki skali.
    """
    limit_scaled = _limit_scaled(linie)
    cel_scaled = max(0, min(round(cel * SKALA), limit_scaled))
    prefiksy = _bitset_prefiksy(linie, limit_scaled)
    nbytes = limit_scaled // 8 + 1
    bufory = [p.to_bytes(nbytes, "little") for p in prefiksy]

    def osiagalna(bufor: bytes, i: int) -> bool:
        return 0 <= i <= limit_scaled and (bufor[i // 8] >> (i % 8)) & 1 == 1

    docelowy_scaled = 0  # 0 jest zawsze osiągalne (nic na fakturę) — bezpieczny domyślny wynik.
    for r in range(limit_scaled + 1):
        if osiagalna(bufory[-1], cel_scaled - r):
            docelowy_scaled = cel_scaled - r
            break
        if r > 0 and osiagalna(bufory[-1], cel_scaled + r):
            docelowy_scaled = cel_scaled + r
            break

    stan = [{"id": l.get("id"), "qty": int(l.get("qty") or 0),
             "kg_per_unit": float(l.get("kg_per_unit") or 0), "qty_invoice": 0}
            for l in linie]
    rem = docelowy_scaled
    for idx in range(len(stan) - 1, -1, -1):
        waga = round(stan[idx]["kg_per_unit"] * SKALA)
        qty = stan[idx]["qty"]
        if waga <= 0 or qty <= 0:
            continue
        maxj = min(qty, rem // waga)
        for j in range(maxj, -1, -1):
            if osiagalna(bufory[idx], rem - j * waga):
                stan[idx]["qty_invoice"] = j
                rem -= j * waga
                break
    return docelowy_scaled / SKALA, stan


def podziel_pozycje(linie: List[Dict[str, Any]], cel_kg: float) -> Dict[str, Any]:
    """Rozdziela sztuki na część fakturowaną i resztę.

    Zwraca `{"lines": [...], "kg_fv": float, "kg_calosc": float,
    "trafiono": bool}`. `trafiono=False` znaczy, że celu nie da się złożyć
    z całych sztuk — `kg_fv` jest wtedy najbliższą osiągalną sumą.
    `trafiono` liczymy na końcu z PRAWDZIWEJ sumy w wyniku vs żądany cel —
    nie z tego, czy pierwsze/drugie dobicie "twierdziło", że mu się udało.
    """
    if not linie:
        return {"lines": [], "kg_fv": 0.0, "kg_calosc": 0.0, "trafiono": True}

    calosc = sum(float(l.get("kg_per_unit") or 0) * int(l.get("qty") or 0) for l in linie)
    cel = max(0.0, min(float(cel_kg or 0), calosc))

    stan = _rownomiernie(linie, cel, calosc)
    if not _dobij(stan, cel):
        # Punkt równomierny nie dobił do celu małym ruchem — sprawdzamy
        # PRAWDZIWĄ najbliższą osiągalną sumę (bitset), nie zgadujemy.
        docelowy, stan_bitset = _dobierz_bitsetem(linie, cel)
        stan = _rownomiernie(linie, docelowy, calosc)
        if not _dobij(stan, docelowy):
            # Nawet dobicie do najbliższej osiągalnej sumy nie wyszło z
            # równomiernego punktu startowego (potrzebny ruch 4+ sztuk) —
            # bierzemy rozkład wprost z bitseta: gwarantowanie dokładny,
            # zamiast po cichu zwrócić rozminiętą sumę.
            stan = stan_bitset

    for w in stan:
        w.pop("_reszta", None)
    suma = _suma_fv(stan)
    trafiono = abs(suma - cel) < 1e-6
    return {"lines": stan, "kg_fv": round(suma, 3),
            "kg_calosc": round(calosc, 3), "trafiono": trafiono}
