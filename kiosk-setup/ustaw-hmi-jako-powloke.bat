@echo off
rem ============================================================
rem  Rozbior HMI — krok 1: HMI jako powloka (shell) konta kiosk
rem  Uruchom ZALOGOWANY na koncie kioskowym (np. "rozbior").
rem  NIE wymaga administratora. Dziala dla biezacego konta.
rem ============================================================

set "EXE=%LOCALAPPDATA%\Rozbior HMI\Rozbior HMI.exe"
if not exist "%EXE%" set "EXE=%LOCALAPPDATA%\Programs\Rozbior HMI\Rozbior HMI.exe"
if not exist "%EXE%" (
  echo [BLAD] Nie znaleziono "Rozbior HMI.exe" w profilu tego uzytkownika.
  echo Najpierw zainstaluj Rozbior.HMI_x64-setup.exe NA TYM koncie,
  echo potem uruchom ten skrypt ponownie.
  pause
  exit /b 1
)

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
