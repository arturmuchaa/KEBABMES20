"""HDI — etykiety dwujęzyczne (PL + język klienta)."""

LABELS = {
    "pl": {
        "title": "HANDLOWY DOKUMENT IDENTYFIKACYJNY", "number": "Numer HDI",
        "issue_date": "Data wystawienia", "producer": "Producent",
        "vet_no": "Weterynaryjny numer identyfikacyjny", "market_domestic": "Krajowy",
        "market_eu": "Unii Europejskiej",
        "supervision": "Zakład posiada stały nadzór weterynaryjny i wprowadzony system HACCP.",
        "col_name": "NAZWA TOWARU", "col_qty": "SZT.", "col_net": "MASA NETTO",
        "col_batch": "NR PARTII", "col_exp": "TERMIN PRZYDATNOŚCI", "total": "RAZEM",
        "recipient": "Odbiorca", "unload": "Miejsce rozładunku", "reg_no": "Numer rejestracyjny",
        "load": "Miejsce załadunku", "seller": "Sprzedawca", "ship_date": "Data wysyłki",
        "signature": "Podpis Wystawiającego", "fridge": "Samochód zabudowany chłodnią -18°C",
        "remarks": "UWAGI / WARUNKI REKLAMACJI",
    },
    "de": {
        "title": "HANDELSIDENTIFIKATIONSDOKUMENT", "number": "HDI-Nummer",
        "issue_date": "Datum der Ausgabe", "producer": "Hersteller",
        "vet_no": "Veterinärkontrollnummer", "market_domestic": "National",
        "market_eu": "Europäische Union",
        "supervision": "Der Betrieb wird ständig tierärztlich überwacht und verfügt über ein HACCP-System.",
        "col_name": "WARENBEZEICHNUNG", "col_qty": "STÜCKZAHL", "col_net": "NETTOGEWICHT",
        "col_batch": "CHARGENNUMMER", "col_exp": "MHD", "total": "GESAMT",
        "recipient": "Empfänger", "unload": "Abladeort", "reg_no": "Registriernummer",
        "load": "Ladeort", "seller": "Verkäufer", "ship_date": "Datum des Versands",
        "signature": "Unterschrift des Ausstellers", "fridge": "Auto mit Kühlschrank -18°C",
        "remarks": "ANMERKUNGEN / VORAUSSETZUNGEN FÜR BESCHWERDEN",
    },
    "en": {
        "title": "COMMERCIAL IDENTIFICATION DOCUMENT", "number": "HDI No.",
        "issue_date": "Date of issue", "producer": "Producer",
        "vet_no": "Veterinary identification number", "market_domestic": "Domestic market",
        "market_eu": "European Union",
        "supervision": "The establishment is under permanent veterinary supervision and has a HACCP system.",
        "col_name": "PRODUCT NAME", "col_qty": "QTY", "col_net": "NET WEIGHT",
        "col_batch": "BATCH NO.", "col_exp": "BEST BEFORE", "total": "TOTAL",
        "recipient": "Recipient", "unload": "Unloading place", "reg_no": "Registration number",
        "load": "Loading place", "seller": "Seller", "ship_date": "Date of shipment",
        "signature": "Signature of the issuer", "fridge": "Refrigerated truck -18°C",
        "remarks": "COMMENTS / CONDITIONS REGARDING COMPLAINTS",
    },
    "sk": {
        "title": "OBCHODNÝ IDENTIFIKAČNÝ DOKLAD", "number": "Číslo HDI",
        "issue_date": "Dátum vystavenia", "producer": "Výrobca",
        "vet_no": "Veterinárne identifikačné číslo", "market_domestic": "Domáci trh",
        "market_eu": "Európska únia",
        "supervision": "Prevádzka je pod stálym veterinárnym dozorom a má zavedený systém HACCP.",
        "col_name": "NÁZOV TOVARU", "col_qty": "KS", "col_net": "ČISTÁ HMOTNOSŤ",
        "col_batch": "ČÍSLO ŠARŽE", "col_exp": "DÁTUM SPOTREBY", "total": "SPOLU",
        "recipient": "Príjemca", "unload": "Miesto vykládky", "reg_no": "Evidenčné číslo",
        "load": "Miesto nakládky", "seller": "Predávajúci", "ship_date": "Dátum odoslania",
        "signature": "Podpis vystaviteľa", "fridge": "Auto s chladiarňou -18°C",
        "remarks": "POZNÁMKY / PODMIENKY REKLAMÁCIE",
    },
    "cs": {
        "title": "OBCHODNÍ IDENTIFIKAČNÍ DOKLAD", "number": "Číslo HDI",
        "issue_date": "Datum vystavení", "producer": "Výrobce",
        "vet_no": "Veterinární identifikační číslo", "market_domestic": "Domácí trh",
        "market_eu": "Evropská unie",
        "supervision": "Provozovna je pod stálým veterinárním dozorem a má zaveden systém HACCP.",
        "col_name": "NÁZEV ZBOŽÍ", "col_qty": "KS", "col_net": "ČISTÁ HMOTNOST",
        "col_batch": "ČÍSLO ŠARŽE", "col_exp": "DATUM SPOTŘEBY", "total": "CELKEM",
        "recipient": "Příjemce", "unload": "Místo vykládky", "reg_no": "Evidenční číslo",
        "load": "Místo nakládky", "seller": "Prodávající", "ship_date": "Datum odeslání",
        "signature": "Podpis vystavitele", "fridge": "Auto s chladírnou -18°C",
        "remarks": "POZNÁMKY / PODMÍNKY REKLAMACE",
    },
}

_COMPLAINTS = {
    "pl": "Wszelkie zastrzeżenia co do jakości i ilości towaru należy zgłaszać w trakcie rozładunku i/lub do czasu podpisania dokumentów towarzyszących dostawie (faktura, WZ, CMR).",
    "de": "Beanstandungen der Qualität und Menge der Ware müssen während des Be-/Entladens und/oder bis zur Unterzeichnung der Lieferpapiere (Rechnung, Lieferschein, CMR) erfolgen.",
    "en": "Any objections to the quality or quantity of the goods must be reported during loading/unloading and/or until the documents accompanying the delivery (invoice, delivery note, CMR) have been signed.",
}


def labels(lang: str) -> dict:
    return LABELS.get(lang, LABELS["en"])


def complaints_text(lang: str) -> str:
    return _COMPLAINTS.get(lang, _COMPLAINTS["en"])
