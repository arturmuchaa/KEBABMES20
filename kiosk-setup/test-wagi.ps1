# test-wagi.ps1 — skanuje porty COM i pokazuje, na ktorym nadaje waga.
# Uruchamiaj przez test-wagi.bat (zwykly dwuklik). PRZED testem zamknij HMI,
# inaczej HMI trzyma port i test pokaze "zajety".

$ErrorActionPreference = 'SilentlyContinue'
Write-Host ""
Write-Host "=== TEST WAGI RS232 — skan portow COM (9600, 8N1) ===" -ForegroundColor Cyan
Write-Host ""

$ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
if (-not $ports) {
  Write-Host "[!] Windows nie widzi ZADNEGO portu COM." -ForegroundColor Red
  Write-Host "    - kabel/adapter USB-RS232 nie jest podlaczony, albo"
  Write-Host "    - brak sterownika adaptera (Menedzer urzadzen -> zolty wykrzyknik)."
  Write-Host "    Podlacz adapter i odpal test ponownie."
  exit 1
}

Write-Host ("Znalezione porty: " + ($ports -join ', '))
Write-Host "Na kazdym porcie nasluchuje 4 sekundy..."
Write-Host ""

$found = @()
foreach ($name in $ports) {
  $p = New-Object System.IO.Ports.SerialPort $name, 9600, 'None', 8, 'One'
  $p.ReadTimeout = 4000
  try {
    $p.Open()
  } catch {
    Write-Host "[$name] nie da sie otworzyc — port ZAJETY (dziala HMI?) albo uszkodzony" -ForegroundColor Yellow
    continue
  }
  try {
    $line = $p.ReadLine().Trim()
    if ($line.Length -gt 40) { $line = $line.Substring(0, 40) + '...' }
    Write-Host "[$name] ODBIERA DANE: >$line<" -ForegroundColor Green
    $found += @{ Port = $name; Line = $line }
  } catch {
    Write-Host "[$name] cisza — 4 s bez danych"
  }
  $p.Close()
  $p.Dispose()
}

Write-Host ""
if ($found.Count -eq 0) {
  Write-Host "=== WYNIK: zaden port nie odbiera danych ===" -ForegroundColor Red
  Write-Host " 1. Sprawdz w mierniku C18=4 i C19=3 (przytrzymaj PRINT + nacisnij HOLD)."
  Write-Host " 2. Sprawdz kabel: musi byc PROSTY (pin 2->2, 5->5), nie null-modem."
  Write-Host " 3. Sprawdz czy wtyczka siedzi w gniezdzie RS232 miernika (nie w zlaczu I/O)."
} else {
  $best = $found[0]
  Write-Host ("=== WYNIK: waga nadaje na porcie " + $best.Port + " ===") -ForegroundColor Green
  if ($best.Line -match '\d') {
    Write-Host "Ramka wyglada dobrze (sa cyfry) - HMI ja odczyta."
  } else {
    Write-Host "[!] W ramce brak cyfr / krzaki -> zla predkosc. Ustaw C19=3 (9600) w mierniku." -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "Wpisz ten port do scale.json obok kebab-mes.exe, np.:"
  Write-Host ('  { "enabled": true, "port": "' + $best.Port + '", "baud": 9600, "stabilityTolKg": 0.5 }') -ForegroundColor Cyan
  Write-Host "Sciezka: C:\Users\<konto>\AppData\Local\Rozbior HMI\scale.json"
  Write-Host "Po zapisaniu pliku uruchom HMI ponownie."
}
Write-Host ""
