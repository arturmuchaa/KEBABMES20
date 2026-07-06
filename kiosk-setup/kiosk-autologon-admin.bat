@echo off
rem ============================================================
rem  Rozbior HMI — krok 2: autologon + minimum ekranow przy starcie
rem  Uruchom JAKO ADMINISTRATOR (prawy klawisz -> Uruchom jako administrator).
rem
rem  Robi:
rem   1. Automatyczne logowanie na konto kioskowe (bez ekranu logowania).
rem   2. Wylacza wymog Windows Hello (blokuje klasyczny autologon na Win11).
rem   3. Wylacza ekran blokady (obrazek przed logowaniem).
rem   4. Wylacza animacje "Witaj/Przygotowywanie" pierwszego logowania.
rem   5. Wylacza pytania o prywatnosc przy pierwszym logowaniu (OOBE).
rem   6. Boot bez ekranow "niepowodzenie uruchamiania" (ignoreallfailures).
rem
rem  UWAGA: haslo autologonu laduje w rejestrze JAWNYM TEKSTEM.
rem  Bezpieczniejsza opcja: Sysinternals Autologon64.exe (szyfruje haslo) -
rem  https://learn.microsoft.com/sysinternals/downloads/autologon
rem ============================================================

net session >nul 2>&1
if errorlevel 1 (
  echo [BLAD] Uruchom ten skrypt jako administrator.
  pause
  exit /b 1
)

set /p KUSER=Nazwa konta kioskowego (np. rozbior):
if "%KUSER%"=="" (echo [BLAD] Nie podano nazwy. & pause & exit /b 1)

rem Sprawdz, czy takie LOKALNE konto istnieje (literowka = autologon nie ruszy)
net user "%KUSER%" >nul 2>&1
if errorlevel 1 (
  echo [BLAD] Konto "%KUSER%" nie istnieje na tym komputerze.
  echo Lista kont lokalnych:
  net user | findstr /v "polecenie zostalo Konta ---"
  pause
  exit /b 1
)

set /p KPASS=Haslo tego konta (puste = konto bez hasla):

set "WL=HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
reg add "%WL%" /v AutoAdminLogon   /t REG_SZ /d 1        /f >nul
reg add "%WL%" /v DefaultUserName  /t REG_SZ /d "%KUSER%" /f >nul
reg add "%WL%" /v DefaultPassword  /t REG_SZ /d "%KPASS%" /f >nul
reg add "%WL%" /v DefaultDomainName /t REG_SZ /d "%COMPUTERNAME%" /f >nul
reg delete "%WL%" /v AutoLogonCount /f >nul 2>&1
rem Bez animacji pierwszego logowania ("Czesc, przygotowujemy wszystko...")
reg add "%WL%" /v EnableFirstLogonAnimation /t REG_DWORD /d 0 /f >nul

rem Windows 11: tryb "bez hasla" (Windows Hello) potrafi blokowac klasyczny
rem autologon i chowa opcje w netplwiz - wylaczamy.
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device" /v DevicePasswordLessBuildVersion /t REG_DWORD /d 0 /f >nul

rem Bez ekranu blokady (od razu logowanie/autologon)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoLockScreen /t REG_DWORD /d 1 /f >nul

rem Skroc niebieski ekran "Witaj" przy logowaniu - przelacz na pulpit
rem natychmiast, bez czekania az wszystko sie zaladuje
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v DelayedDesktopSwitchTimeout /t REG_DWORD /d 0 /f >nul

rem Bez pytan o prywatnosc dla nowych kont (OOBE)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\OOBE" /v DisablePrivacyExperience /t REG_DWORD /d 1 /f >nul

rem Bez ekranow "Preparing Automatic Repair" po twardym wylaczeniu pradu
bcdedit /set {current} bootstatuspolicy ignoreallfailures >nul

echo.
echo ===== KONTROLA - tak zapisano w rejestrze: =====
reg query "%WL%" /v AutoAdminLogon   2>nul | findstr /i AutoAdminLogon
reg query "%WL%" /v DefaultUserName  2>nul | findstr /i DefaultUserName
reg query "%WL%" /v DefaultDomainName 2>nul | findstr /i DefaultDomainName
reg query "%WL%" /v DefaultPassword  2>nul | findstr /i DefaultPassword
echo ================================================
echo.
echo Jesli DefaultUserName/DefaultPassword powyzej wygladaja dobrze,
echo po restarcie komputer zaloguje sie sam na konto %KUSER%.
echo.
echo WAZNE: haslo musi byc DOKLADNIE tym, ktorym logujesz sie na %KUSER%.
echo Zle haslo = Windows pokaze ekran logowania z bledem.
echo.
echo Zeby przy starcie dostac sie na innego uzytkownika: przytrzymaj SHIFT
echo w trakcie logowania automatycznego, albo wyloguj z HMI (kod 0099).
pause
