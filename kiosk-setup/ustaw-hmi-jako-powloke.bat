@echo off
rem ============================================================
rem  Rozbior HMI — krok 1: HMI jako powloka (shell) konta kiosk
rem  Uruchom ZALOGOWANY na koncie kioskowym (np. "rozbior").
rem  NIE wymaga administratora. Dziala dla biezacego konta.
rem ============================================================

rem BLOKADA: skrypt NIE MOZE byc odpalony przez "Uruchom jako administrator" —
rem wtedy dziala w kontekscie konta ADMINA (jego AppData i jego rejestr),
rem a nie konta kioskowego, na ktorym siedzisz.
net session >nul 2>&1
if not errorlevel 1 (
  echo [BLAD] Ten skrypt uruchomiono przez "Uruchom jako administrator".
  echo Wtedy Windows wykonuje go NA KONCIE ADMINISTRATORA - powloka
  echo ustawilaby sie adminowi, nie kontu kioskowemu.
  echo.
  echo Zamknij to okno i uruchom plik ZWYKLYM DWUKLIKIEM,
  echo zalogowany jako konto kioskowe. Zadne uprawnienia nie sa potrzebne.
  pause
  exit /b 1
)
echo Konto, dla ktorego ustawiam powloke: %USERNAME%
echo.

rem UWAGA: binarka w instalatorze nazywa sie "kebab-mes.exe" (nazwa z Cargo),
rem folder instalacji to "Rozbior HMI" (productName). Sprawdzamy obie nazwy.
set "EXE="
for %%N in ("kebab-mes.exe" "Rozbior HMI.exe") do (
  if not defined EXE if exist "%LOCALAPPDATA%\Rozbior HMI\%%~N" set "EXE=%LOCALAPPDATA%\Rozbior HMI\%%~N"
  if not defined EXE if exist "%LOCALAPPDATA%\Programs\Rozbior HMI\%%~N" set "EXE=%LOCALAPPDATA%\Programs\Rozbior HMI\%%~N"
)

rem Nie znaleziono w typowych miejscach — przeszukaj caly profil (moze potrwac
rem chwile). Filtr "Rozbior" odsiewa kebab-mes.exe z ewentualnej instalacji
rem pelnego MES biurowego na tym samym koncie.
if not defined EXE (
  echo Szukam kebab-mes.exe / "Rozbior HMI.exe" w %LOCALAPPDATA% ...
  for /f "delims=" %%F in ('where /r "%LOCALAPPDATA%" "kebab-mes.exe" 2^>nul ^| findstr /i "Rozbior"') do if not defined EXE set "EXE=%%F"
  for /f "delims=" %%F in ('where /r "%LOCALAPPDATA%" "Rozbior HMI.exe" 2^>nul') do if not defined EXE set "EXE=%%F"
)
if not defined EXE (
  echo Szukam w %APPDATA% ...
  for /f "delims=" %%F in ('where /r "%APPDATA%" "kebab-mes.exe" 2^>nul ^| findstr /i "Rozbior"') do if not defined EXE set "EXE=%%F"
)

if defined EXE goto :found

rem Diagnoza: stara instalacja per-machine albo instalacja na innym koncie
if exist "%ProgramFiles%\Rozbior HMI\kebab-mes.exe" set "PMEXE=1"
if exist "%ProgramFiles%\Rozbior HMI\Rozbior HMI.exe" set "PMEXE=1"
if defined PMEXE (
  echo [BLAD] HMI jest zainstalowane w "%ProgramFiles%\Rozbior HMI" - to STARA
  echo instalacja per-machine ^(instalator sprzed 1.0.27 albo odpalony jako
  echo administrator^). Na niej ciche auto-aktualizacje NIE dzialaja.
  echo.
  echo Napraw tak:
  echo  1. Odinstaluj "Rozbior HMI" w Ustawienia -^> Aplikacje.
  echo  2. Zaloguj sie na konto kioskowe i uruchom NAJNOWSZY instalator
  echo     Rozbior.HMI_x64-setup.exe ZWYKLYM dwuklikiem ^(BEZ "jako administrator"^).
  echo  3. Uruchom ten skrypt ponownie.
  pause
  exit /b 1
)

echo [BLAD] Nie znaleziono HMI (kebab-mes.exe) w profilu uzytkownika %USERNAME%.
echo.
echo Najczestsze przyczyny:
echo  - instalator odpalony przez "Uruchom jako administrator" -^> program
echo    wyladowal w profilu ADMINISTRATORA, nie tego konta. Zainstaluj
echo    ponownie ZWYKLYM dwuklikiem, zalogowany jako %USERNAME%.
echo  - instalacja przerwana / nieukonczona - odpal setup jeszcze raz.
echo.
echo Podpowiedz: sprawdz we wlasciwosciach skrotu "Rozbior HMI" w menu Start
echo ^(prawy klawisz -^> Otworz lokalizacje pliku^), gdzie naprawde jest exe.
pause
exit /b 1

:found
reg add "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d "%EXE%" /f >nul
if errorlevel 1 (
  echo [BLAD] Nie udalo sie zapisac rejestru.
  pause
  exit /b 1
)

echo [OK] Powloka tego konta ustawiona na:
echo      %EXE%
echo.
echo Od nastepnego zalogowania konto startuje PROSTO w HMI
echo (bez pulpitu, paska zadan i Eksploratora).
echo.
echo Powrot do normalnego pulpitu:
echo  - w HMI: przytrzymaj "." 3 sekundy, kod 0099, "Wyjdz do Windows",
echo    zaloguj sie na administratora, albo
echo  - na tym koncie uruchom przywroc-pulpit.bat
echo    (awaryjnie: Ctrl+Alt+Del - Menedzer zadan - Uruchom nowe zadanie).
pause
