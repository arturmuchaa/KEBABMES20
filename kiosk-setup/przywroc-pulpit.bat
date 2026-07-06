@echo off
rem ============================================================
rem  Rozbior HMI — awaryjnie: przywroc normalny pulpit (explorer)
rem  Uruchom na koncie, ktoremu ustawiono HMI jako powloke.
rem  Gdy HMI jest powloka i nie widac pulpitu:
rem  Ctrl+Alt+Del -> Menedzer zadan -> Uruchom nowe zadanie ->
rem  wpisz sciezke do tego pliku (albo "cmd" i odpal go z konsoli).
rem ============================================================

reg delete "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f >nul 2>&1
echo [OK] Wpis Shell usuniety - po ponownym zalogowaniu wraca normalny pulpit.
echo Aby od razu zobaczyc pulpit bez przelogowania, wpisz: explorer
pause
