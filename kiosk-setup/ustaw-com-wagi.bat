@echo off
rem ============================================================
rem  Zapisuje scale.json dla wagi RS232 do WSPOLNEJ lokalizacji
rem  (ProgramData) - widocznej ze WSZYSTKICH kont Windows.
rem
rem  Rozwiazuje problem "dziala na Adminie, nie dziala na rozbior":
rem  AppData jest osobne dla kazdego konta, ProgramData jest wspolne.
rem
rem  URUCHOM JAKO ADMINISTRATOR (prawy klawisz -> Uruchom jako administrator).
rem  Wymaga HMI w wersji 1.0.32 lub nowszej.
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo [BLAD] Uruchom ten skrypt JAKO ADMINISTRATOR.
  echo (prawy klawisz na pliku -> Uruchom jako administrator)
  echo ProgramData jest zapisywalne tylko z uprawnieniami administratora.
  pause
  exit /b 1
)

set "DIR=%ProgramData%\Rozbior HMI"
if not exist "%DIR%" mkdir "%DIR%"

echo.
set /p PORT=Numer portu wagi (np. COM1):
if "%PORT%"=="" (echo [BLAD] Nie podano portu. & pause & exit /b 1)

rem Zapis przez > tworzy plik ANSI BEZ BOM (dokladnie tego chce HMI).
> "%DIR%\scale.json" echo { "enabled": true, "port": "%PORT%", "baud": 9600, "stabilityTolKg": 0.5 }

echo.
echo [OK] Zapisano wspolny plik dla wszystkich kont:
type "%DIR%\scale.json"
echo.
echo Sciezka: %DIR%\scale.json
echo.
echo Teraz na koncie ROZBIOR uruchom HMI ponownie (plik czytany przy starcie).
echo Waga powinna sie pojawic - zniknie "WAGA NIEPODLACZONA".
echo.
echo Kontrola w HMI: menu serwisowe ("." 3s, kod 0099) pokazuje teraz
echo diagnostyke wagi - jaki port jest uzyty i czy plik zostal znaleziony.
pause
