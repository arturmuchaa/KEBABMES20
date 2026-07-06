@echo off
rem ============================================================
rem  Zapisuje scale.json dla wagi RS232 — bez pulapek Notatnika
rem  (zla nazwa .txt, kodowanie UTF-8 z BOM).
rem
rem  URUCHOM ZALOGOWANY NA KONCIE, NA KTORYM DZIALA HMI (np. rozbior)
rem  — zapisuje do AppData TEGO konta. ZWYKLY dwuklik, bez administratora.
rem ============================================================

net session >nul 2>&1
if not errorlevel 1 (
  echo [BLAD] Uruchomiono przez "Uruchom jako administrator".
  echo Wtedy plik trafi do AppData ADMINA, a nie konta kioskowego.
  echo Zamknij i odpal ZWYKLYM dwuklikiem, zalogowany jako konto HMI.
  pause
  exit /b 1
)

set "DIR=%LOCALAPPDATA%\Rozbior HMI"
if not exist "%DIR%" (
  echo [BLAD] Nie znaleziono folderu HMI:
  echo   %DIR%
  echo HMI nie jest zainstalowane na koncie %USERNAME%.
  echo Zaloguj sie na konto, na ktorym dziala HMI, i sprobuj ponownie.
  pause
  exit /b 1
)

echo Konto: %USERNAME%
echo Folder HMI: %DIR%
echo.
set /p PORT=Numer portu wagi (np. COM1):
if "%PORT%"=="" (echo [BLAD] Nie podano portu. & pause & exit /b 1)

rem Zapis przez > tworzy plik ANSI BEZ BOM (dokladnie tego chce HMI).
> "%DIR%\scale.json" echo { "enabled": true, "port": "%PORT%", "baud": 9600, "stabilityTolKg": 0.5 }

echo.
echo [OK] Zapisano:
type "%DIR%\scale.json"
echo.
echo Sciezka: %DIR%\scale.json
echo.
echo Teraz ZAMKNIJ i URUCHOM HMI PONOWNIE (plik czytany tylko przy starcie).
echo Waga powinna sie pojawic — zniknie "WAGA NIEPODLACZONA".
pause
