@echo off
rem ============================================================
rem  Kebab MES - Rozbior HMI - KIOSK W PRZEGLADARCE
rem  Dziala na Windows 7/8/10/11 (Chrome lub Edge).
rem  Watchdog: jesli operator zamknie okno, uruchamia ponownie.
rem  Wyjscie serwisowe: Ctrl+Alt+Del -> Menedzer zadan -> zakoncz
rem  proces chrome.exe / msedge.exe, potem to okno (cmd).
rem ============================================================
setlocal enableextensions

set "URL=http://204.168.166.34:8080/tablet/rozbior"
set "PROFILE=%LOCALAPPDATA%\RozbiorKiosk"

rem --- Znajdz Chrome ---
set "BROWSER="
set "KIND="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe" & set "KIND=chrome")
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" & set "KIND=chrome")
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe" & set "KIND=chrome")

rem --- Fallback: Edge ---
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" & set "KIND=edge")
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" & set "KIND=edge")

if not defined BROWSER (
  echo Nie znaleziono Google Chrome ani Microsoft Edge.
  echo Zainstaluj Google Chrome na panelu i uruchom ponownie.
  pause
  exit /b 1
)

echo Uruchamiam kiosk rozbioru (%KIND%)...

:loop
if /I "%KIND%"=="chrome" (
  start /wait "" "%BROWSER%" --kiosk "%URL%" --app="%URL%" ^
    --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check ^
    --disable-session-crashed-bubble --disable-infobars --noerrdialogs ^
    --disable-translate --disable-pinch --overscroll-history-navigation=0 ^
    --disable-features=TranslateUI --check-for-update-interval=31536000
) else (
  start /wait "" "%BROWSER%" --kiosk "%URL%" --edge-kiosk-type=fullscreen ^
    --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check ^
    --disable-session-crashed-bubble --noerrdialogs
)

rem Okno zamkniete -> krotka pauza i ponowne uruchomienie (watchdog).
timeout /t 2 /nobreak >nul
goto loop
