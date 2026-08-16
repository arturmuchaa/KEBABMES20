---
description: Wydanie desktopu Kebab MES — tag v<wersja> (CI buduje + publikuje latest.json).
---

# /release — wydanie desktopu

Wersja jest **źródłem prawdy w `src-tauri/Cargo.toml`** (obecnie zgodna z `package.json`).

## Kroki
1. **Odczytaj wersję:** `grep -m1 '^version' src-tauri/Cargo.toml`. Sprawdź, że `package.json` ma tę samą wartość (jeśli nie — zatrzymaj się i ustal, którą wydajemy).
2. **Potwierdź gałąź wydania.** NIE zakładaj na sztywno — sprawdź, z której gałęzi CI buduje release (`.github/workflows/`) i upewnij się, że jesteś na właściwej oraz że jest wypchnięta. Jeśli niejasne — zapytaj usera.
3. **Zielone `/verify`** przed tagiem.
4. **Tag:** `git tag v<wersja> && git push origin v<wersja>`. Tag `v*` uruchamia build i publikację `latest.json` (auto-update jest cichy).
5. Po publikacji potwierdź, że release/`latest.json` pojawił się tam, gdzie pobiera go aplikacja.

> Uwaga: szczegóły gałęzi z pamięci bywają nieaktualne — zawsze zweryfikuj z `git`/CI zanim otagujesz.
