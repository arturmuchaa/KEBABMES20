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
rem
rem  Uwaga: NIE sprawdzamy uprawnien przez "net session" (wymaga uslugi
rem  Serwer, wylaczonej na Windows IoT -> falszywy alarm). Zamiast tego
rem  probujemy zapisac i weryfikujemy, czy plik powstal.
rem ============================================================

set "DIR=%ProgramData%\Rozbior HMI"
if not exist "%DIR%" mkdir "%DIR%" 2>nul

echo.
set /p PORT=Numer portu wagi (np. COM1):
if "%PORT%"=="" (echo [BLAD] Nie podano portu. & pause & exit /b 1)

rem Zapis przez > tworzy plik ANSI BEZ BOM (dokladnie tego chce HMI).
> "%DIR%\scale.json" echo { "enabled": true, "port": "%PORT%", "baud": 9600, "stabilityTolKg": 0.5 } 2>nul

if not exist "%DIR%\scale.json" (
  echo.
  echo [BLAD] Nie udalo sie zapisac do:
  echo   %DIR%
  echo Brak uprawnien do ProgramData. Uruchom plik przez
  echo   prawy klawisz -^> "Uruchom jako administrator".
  echo Jesli robisz to jako administrator i dalej blad - zapisz
  echo recznie do AppData konta ROZBIOR (patrz instrukcja).
  pause
  exit /b 1
)

echo.
echo [OK] Zapisano wspolny plik dla wszystkich kont:
type "%DIR%\scale.json"
echo.
echo Sciezka: %DIR%\scale.json
echo.
echo Teraz na koncie ROZBIOR uruchom HMI ponownie (plik czytany przy starcie).
echo Waga powinna sie pojawic - zniknie "WAGA NIEPODLACZONA".
echo.
echo Kontrola w HMI: menu serwisowe ("." 3s, kod 0099) pokazuje
echo diagnostyke wagi - jaki port jest uzyty i czy plik zostal znaleziony.
pause
