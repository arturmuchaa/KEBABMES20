# Kiosk Rozbiór HMI — konfiguracja Windows 11 IoT

Skrypty robią z komputera kiosk: po włączeniu zasilania **jedyne, co widać, to
logo płyty głównej → krótki spinner Windows → splash HMI**. Bez ekranu logowania,
bez pulpitu, bez paska zadań.

> Kreator „Skonfiguruj kiosk" w Ustawieniach Windows pokazuje tylko aplikacje
> UWP ze Sklepu — HMI (aplikacja desktopowa) nigdy się tam nie pojawi. Dlatego
> kiosk robimy przez powłokę per-user w rejestrze (tak samo jak na dotychczasowym
> panelu), pod co zaprojektowane są ciche auto-aktualizacje i menu serwisowe.

## Kolejność

1. **Utwórz lokalne konto** kioskowe (standardowe, bez admina), np. `rozbior`
   (zalecana nazwa bez polskich znaków; pełna nazwa wyświetlana może być „Rozbiór").
2. **Zaloguj się na to konto** i zainstaluj `Rozbior.HMI_x64-setup.exe`
   (GitHub Releases, najnowszy tag `rozbior-v10-*`). Instalator jest per-user —
   musi być odpalony na koncie kioskowym, inaczej auto-update nie działa.
3. Na tym samym koncie uruchom **`ustaw-hmi-jako-powloke.bat`**
   (sam znajdzie exe w AppData — działa też przy nazwie konta z „ó").
4. Wyloguj się, zaloguj na administratora i uruchom **jako administrator**
   **`kiosk-autologon-admin.bat`** — poda się nazwę i hasło konta kioskowego.
   Skrypt włącza autologon i wyłącza: ekran blokady, animację pierwszego
   logowania, pytania o prywatność (OOBE) oraz ekrany „naprawy automatycznej"
   po zaniku prądu.
5. **Restart** — komputer sam loguje się na konto kioskowe i startuje prosto
   w splash HMI.

## Wyjście serwisowe / powrót

- W HMI: przytrzymaj klawisz **„."** (albo tytuł ekranu logowania) **3 sekundy**
  → kod **0099** → „Wyjdź do Windows (wyloguj)" → logowanie na administratora.
- Chwilowe pominięcie autologonu przy starcie: przytrzymaj **Shift**.
- Awaryjnie na koncie kioskowym: `Ctrl+Alt+Del` → Menedżer zadań → „Uruchom nowe
  zadanie" → `przywroc-pulpit.bat` (usuwa wpis Shell) albo `explorer`.

## Uwagi

- Hasło autologonu trafia do rejestru jawnym tekstem
  (`HKLM\...\Winlogon\DefaultPassword`). Bezpieczniejsza alternatywa:
  [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)
  (trzyma hasło zaszyfrowane jako LSA secret) — wtedy krok 4 ogranicz do
  pozostałych wpisów rejestru.
- Loga producenta przy bootowaniu (UEFI) nie da się podmienić z poziomu Windows.
- Auto-update HMI: cichy, sprawdza co godzinę i przy starcie — nic nie trzeba robić.
