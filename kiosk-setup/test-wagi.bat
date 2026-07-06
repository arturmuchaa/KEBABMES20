@echo off
rem Test polaczenia z waga RS232 - znajduje port COM, na ktorym nadaje waga.
rem PRZED testem zamknij HMI (inaczej trzyma port).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-wagi.ps1"
pause
