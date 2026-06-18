# Etykiety Zebra — wklej ZPL + nakładka pól dynamicznych

Data: 2026-06-18 · Status: zatwierdzony (brainstorming)
Zastępuje kierunek: pełny natywny edytor (Z-Design-1) — zbyt pracochłonny + problem polskich fontów.

## Problem
Połowa klientów wymaga etykiet zaprojektowanych w Zebra Designer (złożone etykiety
spożywcze: skład, alergeny, tabela wartości odżywczych, HALAL, znak wet. — z polskimi
i francuskimi znakami). Zebra Designer eksportuje ZPL **zrasteryzowany** (^GF), bez pól.
Natywne fonty Zebry nie mają ł/ż/ó/é/à. PDF działa idealnie; Zebra ma działać tak samo.

## Kluczowy wniosek
Na realnej etykiecie (GOLD KEBAB) wszystkie **diacrytyki są w części STATYCZNEJ**.
Pola **DYNAMICZNE są ASCII**: N° lot (cyfry), daty (cyfry.kropki), POIDS (np. „10KG"), QR.
→ Statyka jako wklejona grafika ZPL (diacrytyki OK); dynamika natywnym ZPL (ASCII → fonty OK).

## Podejście
1. Statyczną etykietę projektujesz w **Zebra Designer**, eksportujesz ZPL, **wklejasz** do
   creatora (tło). Wgrywasz też obraz tej etykiety (do wizualnego pozycjonowania).
2. W creatorze przeciągasz pola dynamiczne (`[[PARTIA]] [[DATA_PROD]] [[BEST_BEFORE]]
   [[WAGA]] [[QR]]` + dowolny tekst) na obraz.
3. Generator składa **ZPL z placeholderami** = wklejony ZPL (bez `^XZ`) + natywne komendy
   pól na pozycjach (`^FO x,y ^A0N,h ^FD…^FS`, QR `^BQ`) + `^XZ`.
4. Druk: istniejący `render_zebra_labels` podstawia wartości i wysyła na Zebrę (BrowserPrint).

## Generator ZPL (czysta logika, TDD — TS/vitest)
`composeZpl({ backgroundZpl, fields, dpi })` → string z [[placeholderami]].
- dots(mm) = round(mm * dpi / 25.4).
- text: `^FO{x},{y}^A0N,{h},{h}^FD{value}^FS`.
- qr: `^FO{x},{y}^BQN,2,{mag}^FDQA,{value}^FS`.
- tło: usuń końcowe `^XZ`, doklej pola, dodaj `^XZ`. Brak tła → owiń `^XA…^XZ`.
- escape `^`/`~` w wartościach statycznych pól (dynamiczne [[..]] zostają do merge_zpl).

Model pola: `{ id, type:'text'|'qr', value, xMm, yMm, fontMm?(text), mag?(qr) }`.

## Persystencja (reużycie label_templates, kind='zpl')
- `zpl` = złożony szablon (z placeholderami) — czyta render.
- `field_positions` = stan edytora Zebra `{ backgroundZpl, fields, dpi, widthMm, heightMm }` (re-edycja).
- `background_data` = obraz podglądu (pozycjonowanie), jak przy PDF.
Kluczowane (client_id, recipe_id) — etykieta per klient+produkt.

## Creator (frontend)
- Tryb Zebra: pole „Wklej ZPL z Zebra Designer", wgranie obrazu podglądu, paleta pól
  dynamicznych, przeciąganie/pozycje (reużycie wzorca LabelTemplateSetupPage), wybór DPI (203/300),
  rozmiar mm. Podgląd składu + „Test druku" (sendZpl). Zapis → label_templates.
- Render/druk per sztuka/opakowanie: istniejący ZebraPrintPage / render_zebra_labels.

## Plan etapami
- Faza 1 (odblokowuje): generator `composeZpl` (TDD) + minimalny creator (wklej ZPL + lista
  pól z pozycją mm + DPI) + zapis + test druku. Działa: wklej, ustaw pola, drukuj.
- Faza 2 (UX): wizualne przeciąganie pól po obrazie podglądu (jak PDF), nudge, podgląd na żywo.

## Testy
- `composeZpl` (pure): text/qr → ^FO/^FD/^BQ z poprawną konwersją mm→dots; strip ^XZ; escape;
  zachowanie [[placeholderów]]; brak tła → ^XA/^XZ.
- backend render: bez zmian (merge_zpl) — istniejące testy.

## Poza zakresem (YAGNI / później)
- Pełne odtwarzanie etykiety element-po-elemencie u nas (Z-Design-1) — odrzucone.
- Rasteryzacja dynamicznych pól z diacrytykami — tylko gdyby zaszła potrzeba (na razie ASCII).
- Render podglądu ZPL→obraz w przeglądarce (używamy wgranego obrazu; ew. Labelary później).
