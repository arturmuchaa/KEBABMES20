# Kebab MES — Rozbiór HMI · kiosk w przeglądarce (Windows 7+)

Wariant dla **starszych paneli** (np. Windows 7), gdzie natywny instalator Tauri v2
nie działa (`GetPackagesByPackageFamily` — Tauri v2 wymaga Windows 10+). Tu HMI
uruchamia się w przeglądarce w trybie kiosk — to ta sama aplikacja web co na 8080,
ze wszystkimi wersjami i motywami (Klasyczny / HMI v2 / HMI v3 / HMI v4 light+dark).

> Nowsze panele (Windows 10/11): używaj natywnego instalatora
> `Kebab.Rozbior.HMI_2.5.35_x64-setup.exe` (Release `kiosk-v2.5.35`).

## Wymagania
- **Google Chrome** (zalecane na Win7 — ostatnia wersja 109) lub Microsoft Edge.
- Sieć do serwera: `http://204.168.166.34:8080`.

## Uruchomienie
1. Skopiuj `rozbior-kiosk.bat` na panel (np. `C:\Kiosk\`).
2. Kliknij dwukrotnie. Otworzy się **pełny ekran** z panelem rozbioru.
3. Watchdog: jeśli okno zostanie zamknięte, launcher uruchamia je **ponownie**
   (operator nie „wyjdzie" z kiosku).

Adres można zmienić edytując `set "URL=..."` na początku pliku.

## Autostart po włączeniu komputera
Skrót do `.bat` w folderze Autostartu:
1. `Win + R` → wpisz `shell:startup` → Enter.
2. Wklej tam skrót do `rozbior-kiosk.bat`.

## Pełny lockdown (zalecane na produkcji)
- Osobne **konto operatora** bez uprawnień administratora.
- Zablokuj Menedżer zadań i zmianę ustawień przez zasady grupy (`gpedit.msc`)
  lub rejestr (`DisableTaskMgr`).
- Opcjonalnie ustaw `.bat` jako powłokę (Winlogon `Shell`) na koncie operatora —
  wtedy nie ma pulpitu ani paska, tylko kiosk.
- Do twardej blokady klawiszy (Alt+Tab, Win, Alt+F4) można dodać AutoHotkey.

## Wyjście serwisowe
`Ctrl + Alt + Del` → Menedżer zadań → zakończ `chrome.exe`/`msedge.exe`,
potem okno `cmd` (watchdog). Albo zaloguj się na konto administratora.

## Aktualizacje
Brak instalacji — przy zmianie HMI wystarczy redeploy weba na serwerze (8080)
i odświeżenie/restart kiosku. Nic nie trzeba wgrywać na panel.
