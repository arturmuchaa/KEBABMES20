"""Arytmetyka rozrachunków z odbiorcami — bez bazy, na samych liczbach.

Wydzielone z serwisu celowo: saldo jest jedyną liczbą w tym module, której
biuro nie sprawdzi na oko, więc musi dać się przetestować na wymyślonych
danych, bez stawiania dokumentów i zamówień.

ZNAK: ujemne = klient jest nam winien. Tak jest w arkuszu biura
(`SALDO W € = -15649` to dług YBM GASTRO), a zmiana tej konwencji przy
przepisywaniu sald otwarcia byłaby źródłem cichych pomyłek — liczba
wyglądałaby sensownie w obie strony.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

#: Domyślne terminy płatności w dniach. Właściciel 24.09.2026: „termin FV
#: 14 dni od daty wydania, a WZ wymagany przy odbiorze, czyli +1 dzień,
#: bo wyjeżdża do klientów zawsze dzień wcześniej".
TERMINY_DOMYSLNE = {"invoice": 14, "wz": 1}

#: Próg groszowy — zaokrąglenia nie mogą robić z zera długu ani odwrotnie.
GROSZ = 0.005


def policz_saldo(otwarcie: Optional[Dict[str, Any]],
                 obciazenia: List[Dict[str, Any]],
                 wplaty: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Saldo = otwarcie + obciążenia − wpłaty, wszystko w walucie klienta.

    `skonfigurowane` odróżnia „saldo wynosi zero" od „nikt nie wpisał salda
    otwarcia". Bez tego rozróżnienia ekran pokazywałby 0,00 dla kontrahenta,
    którego nikt jeszcze nie rozliczył, a biuro uznałoby, że nic nie jest
    winien — cicho i bez żadnego sygnału.
    """
    o = float((otwarcie or {}).get("amount") or 0.0)
    suma_obc = sum(float(x.get("amount") or 0.0) for x in obciazenia or [])
    suma_wpl = sum(float(x.get("amount") or 0.0) for x in wplaty or [])
    return {
        "otwarcie": round(o, 2),
        "obciazenia": round(suma_obc, 2),
        "wplaty": round(suma_wpl, 2),
        "saldo": round(o + suma_obc - suma_wpl, 2),
        "skonfigurowane": otwarcie is not None,
    }


def po_odcieciu(pozycje: List[Dict[str, Any]], as_of: Optional[date],
                pole: str) -> List[Dict[str, Any]]:
    """REGUŁA NADRZĘDNA modułu: liczą się WYŁĄCZNIE dokumenty o dacie PO
    dacie salda otwarcia.

    Właściciel 24.09.2026: „historycznie nie patrz — ja zrobię saldo na dany
    dzień i już będziemy szli od nowa na nowym systemie".

    Odcięcie jest ZAMKNIĘTE OD DOŁU: saldo „na dzień 1.09" zawiera wszystko
    do 1.09 włącznie, więc dokument z tą datą już się nie liczy.

    Bez tego obciążenia zaciągnęłyby się ze 177 historycznych WZ leżących
    w bazie i doliczyły NA WIERZCHU salda otwarcia. Błąd byłby cichy, bo
    kwoty wyglądałyby sensownie.

    Brak daty odcięcia (klient bez salda otwarcia) przepuszcza wszystko —
    ukrycie dokumentów dałoby pustą kartę i nikt by nie wiedział, że czegoś
    brakuje.
    """
    if as_of is None:
        return list(pozycje or [])
    return [p for p in (pozycje or []) if p.get(pole) and p[pole] > as_of]


def termin_platnosci(doc_date: date, kind: str,
                     terminy: Optional[Dict[str, int]] = None) -> date:
    """Termin liczony od daty DOSTAWY, nie od daty wystawienia dokumentu —
    tak jak w arkuszu biura, gdzie kolumna faktur ma nagłówek „DATA DOSTAWY".

    Nieznany rodzaj dostaje termin natychmiastowy: lepiej pokazać pozycję
    jako wymagalną od razu niż zgubić ją w saldzie przez brak wpisu
    w słowniku.
    """
    t = terminy or TERMINY_DOMYSLNE
    return doc_date + timedelta(days=int(t.get(kind, 0)))


def dni_po_terminie(termin: date, na_dzien: date) -> int:
    """Zero przed terminem, nie liczba ujemna: „-5 dni po terminie" na
    papierze dla klienta nic nie znaczy."""
    return max(0, (na_dzien - termin).days)
