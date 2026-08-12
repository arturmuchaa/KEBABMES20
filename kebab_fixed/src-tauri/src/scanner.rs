//! Most do skanera (biuro) — skan HDI wprost z MES, bez drugiego programu.
//!
//! DLACZEGO PRZEZ NAPS2, a nie własną obsługą sterowników: bizhub C458 nie
//! wystawia eSCL (sprawdzone w zakładzie), więc trzeba iść przez sterownik
//! TWAIN/WIA Konica Minolty. NAPS2 już to robi i jest na tym urządzeniu
//! sprawdzony w boju — pisanie własnego mostu do TWAIN oznaczałoby budowanie
//! trzeciego elementu zamiast połączenia dwóch działających.
//!
//! Serwer MES stoi w serwerowni i do skanera w sieci zakładu nie ma jak
//! sięgnąć; przeglądarka do skanera dostępu nie ma z zasady. Dlatego skanuje
//! aplikacja desktopowa — jedyne miejsce, które jest we WŁAŚCIWEJ SIECI
//! i może uruchomić program.
//!
//! Konfiguracja: `scanner.json` obok exe, w ProgramData albo w app_config_dir
//! (naps2Path / profile / pages / timeoutS). Diagnostyka: komenda
//! `scanner_diagnose` — bez niej serwisant jest ślepy, tak samo jak było
//! z wagą.

use base64::Engine;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::Manager;

#[derive(Deserialize, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct ScannerConfig {
    pub enabled: bool,
    /// Pełna ścieżka do NAPS2.Console.exe. Puste = szukamy w typowych miejscach.
    pub naps2_path: String,
    /// Nazwa profilu skanowania w NAPS2. Puste = profil domyślny.
    /// Profil ustawia się RAZ w NAPS2 (urządzenie, PDF, 300 dpi, szarość).
    pub profile: String,
    /// Ile stron zeskanować. UWAGA: w NAPS2 `-n` to LICZBA STRON, a nie limit —
    /// `-n 0` znaczy „zeskanuj zero stron", więc NAPS2 nic nie robi i nie
    /// zapisuje pliku (objaw: „kręci chwilę i nic"). Domyślnie 1, bo działa
    /// zarówno z szyby, jak i z podajnika. Przy wielostronicowym HDI z
    /// podajnika podnieś tę liczbę — nadmiar nie szkodzi, NAPS2 przestaje
    /// skanować, gdy podajnik się opróżni.
    pub pages: u32,
    /// Skan A4 z podajnika nie powinien trwać dłużej; dłużej = zacięcie
    /// albo urządzenie czeka na coś, czego operator nie widzi.
    pub timeout_s: u64,
}

impl Default for ScannerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            naps2_path: String::new(),
            profile: String::new(),
            pages: 1,
            timeout_s: 120,
        }
    }
}

/// Typowe miejsca instalacji NAPS2 na Windows (instalacja dla wszystkich
/// użytkowników, 32-bit na 64-bit oraz instalacja per-użytkownik).
fn naps2_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let base = Path::new(&base);
            out.push(base.join("NAPS2").join("NAPS2.Console.exe"));
            out.push(base.join("Programs").join("NAPS2").join("NAPS2.Console.exe"));
        }
    }
    // Ostatnia deska ratunku: jeśli katalog NAPS2 jest w PATH.
    out.push(PathBuf::from("NAPS2.Console.exe"));
    out
}

fn config_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    // Wspólny plik dla całego komputera — admin ustawia raz, konto operatora
    // go widzi. Ta sama pułapka co przy wadze: AppData jest per-konto.
    if let Some(pd) = std::env::var_os("ProgramData") {
        paths.push(Path::new(&pd).join("Kebab MES").join("scanner.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("scanner.json"));
        }
    }
    if let Ok(dir) = app.path().app_config_dir() {
        paths.push(dir.join("scanner.json"));
    }
    paths
}

fn load_config(app: &tauri::AppHandle) -> ScannerConfig {
    for p in config_paths(app) {
        if let Ok(s) = std::fs::read_to_string(&p) {
            // Notatnik Windows zapisuje UTF-8 z BOM, a serde_json go odrzuca —
            // konfiguracja wracałaby po cichu do domyślnej.
            let s = s.trim_start_matches('\u{feff}');
            match serde_json::from_str(s) {
                Ok(cfg) => return cfg,
                Err(e) => eprintln!("scanner.json niepoprawny ({}): {e}", p.display()),
            }
        }
    }
    ScannerConfig::default()
}

/// Liczba stron przekazywana NAPS2 — nigdy zero.
///
/// `-n 0` każe NAPS2 zeskanować zero stron: kończy pracę bez błędu i bez
/// pliku. Stary `scanner.json` z zerem (albo moja pierwotna wartość domyślna)
/// dawał dokładnie ten objaw, więc zero zamieniamy na jedną stronę zamiast
/// wysyłać polecenie, które z założenia nic nie zrobi.
pub fn effective_pages(pages: u32) -> u32 {
    pages.max(1)
}

fn resolve_naps2(cfg: &ScannerConfig) -> Option<PathBuf> {
    if !cfg.naps2_path.trim().is_empty() {
        let p = PathBuf::from(cfg.naps2_path.trim());
        return if p.exists() { Some(p) } else { None };
    }
    naps2_candidates().into_iter().find(|p| p.exists())
}

/// Uruchamia NAPS2 i czeka na plik, pilnując limitu czasu.
///
/// `Command::status()` nie ma limitu czasu, a zawieszony skaner zostawiłby
/// operatora przed formularzem, który „myśli" bez końca.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<(), String> {
    // Wyjście NAPS2 przechwytujemy: to ONO mówi, czemu odmówił (nie ma profilu,
    // nie wybrano urządzenia, sterownik chce pokazać okno). Bez tego zostawał
    // sam kod wyjścia i zgadywanie.
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Nie udało się uruchomić NAPS2: {e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let mut szczegoly = String::new();
                if let Some(out) = child.stdout.take() {
                    use std::io::Read;
                    let mut b = String::new();
                    let _ = std::io::BufReader::new(out).read_to_string(&mut b);
                    szczegoly.push_str(b.trim());
                }
                if let Some(err) = child.stderr.take() {
                    use std::io::Read;
                    let mut b = String::new();
                    let _ = std::io::BufReader::new(err).read_to_string(&mut b);
                    if !b.trim().is_empty() {
                        szczegoly.push('\n');
                        szczegoly.push_str(b.trim());
                    }
                }
                let szczegoly = szczegoly.trim();
                return Err(format!(
                    "NAPS2 zakończył się błędem (kod {}){}",
                    status.code().unwrap_or(-1),
                    if szczegoly.is_empty() {
                        ". Sprawdź w NAPS2, czy profil skanowania działa — ten sam profil używa MES."
                            .to_string()
                    } else {
                        format!(":\n{szczegoly}")
                    }
                ));
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err("Skanowanie trwało zbyt długo — sprawdź urządzenie \
                                (zacięcie papieru? czeka na potwierdzenie na panelu?)"
                        .into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("Błąd oczekiwania na NAPS2: {e}")),
        }
    }
}

/// Skanuje dokument i zwraca PDF w base64 (frontend robi z tego plik i wysyła
/// go do odczytu tą samą drogą, co plik wskazany ręcznie).
pub fn scan(app: &tauri::AppHandle) -> Result<String, String> {
    let cfg = load_config(app);
    if !cfg.enabled {
        return Err("Skaner wyłączony w scanner.json".into());
    }
    let exe = resolve_naps2(&cfg).ok_or_else(|| {
        "Nie znaleziono NAPS2 na tym komputerze. Zainstaluj NAPS2 albo wskaż \
         ścieżkę do NAPS2.Console.exe w pliku scanner.json."
            .to_string()
    })?;

    let out = last_scan_path();
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Brak miejsca na skan: {e}"))?;
    }
    let _ = std::fs::remove_file(&out);

    let mut cmd = Command::new(&exe);
    cmd.arg("-o").arg(&out)
        .arg("-n").arg(effective_pages(cfg.pages).to_string())
        .arg("--force");
    if !cfg.profile.trim().is_empty() {
        cmd.arg("-p").arg(cfg.profile.trim());
    }
    run_with_timeout(cmd, Duration::from_secs(cfg.timeout_s))?;

    let bytes = std::fs::read(&out).map_err(|_| {
        "NAPS2 nie zapisał pliku. Najczęstsza przyczyna: w profilu nie wybrano \
         urządzenia albo podajnik był pusty."
            .to_string()
    })?;
    if bytes.is_empty() {
        return Err("Skan jest pusty — sprawdź, czy dokument leżał na szybie.".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Stałe miejsce ostatniego skanu.
///
/// Plik NIE jest kasowany po odczycie: gdy rozpoznanie wyjdzie niepełne,
/// trzeba móc zobaczyć, CO dostał MES. Skan ze skanera bywa gorszy niż ten
/// sam dokument zapisany ręcznie, a bez pliku zostaje zgadywanie.
/// Jedna, nadpisywana ścieżka — nie zbieramy dokumentów na dysku klienta.
pub fn last_scan_path() -> PathBuf {
    std::env::temp_dir().join("Kebab MES").join("ostatni-skan-hdi.pdf")
}

/// Otwiera ostatni skan w domyślnej przeglądarce PDF.
///
/// W oknie aplikacji desktopowej pobieranie pliku przez `<a download>` nie
/// działa (to nie przeglądarka), więc plik pokazujemy systemowo.
pub fn open_last_scan(app: &tauri::AppHandle) -> Result<String, String> {
    let p = last_scan_path();
    if !p.exists() {
        return Err("Nie ma jeszcze żadnego skanu — zeskanuj najpierw dokument.".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(p.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Nie udało się otworzyć skanu: {e}"))?;
    Ok(p.to_string_lossy().to_string())
}

/// Zapisuje dokument przysłany przez MES i otwiera go systemowo.
///
/// Powód ten sam, co przy `open_last_scan`: w oknie aplikacji desktopowej
/// pobranie pliku linkiem ani blobem NIE DZIAŁA — to nie przeglądarka.
/// Dokument (skan HDI do okazania przy kontroli, WZ, CMR) musi więc trafić
/// na dysk przez warstwę natywną i otworzyć się w domyślnym czytniku.
pub fn open_document(app: &tauri::AppHandle, name: &str, b64: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Uszkodzone dane dokumentu: {e}"))?;
    if bytes.is_empty() {
        return Err("Pusty dokument — nie ma czego otworzyć.".into());
    }
    let dir = std::env::temp_dir().join("Kebab MES").join("dokumenty");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Nie udało się utworzyć {}: {e}", dir.display()))?;
    let plik = dir.join(safe_file_name(name));
    std::fs::write(&plik, &bytes).map_err(|e| format!("Nie udało się zapisać dokumentu: {e}"))?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(plik.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Nie udało się otworzyć dokumentu: {e}"))?;
    Ok(plik.to_string_lossy().to_string())
}

/// Nazwa pliku z serwera NIGDY nie trafia na dysk wprost.
///
/// Zostają tylko znaki bezpieczne; ukośniki i kropki wiodące znikają, żeby
/// `../../` nie wyprowadziło zapisu poza katalog tymczasowy. Polskie litery
/// zostają — `is_alphanumeric()` je przepuszcza, a nazwa ma być czytelna
/// („HDI 12-08-2026.pdf").
fn safe_file_name(raw: &str) -> String {
    let czyste: String = raw
        .chars()
        .map(|c| if c.is_alphanumeric() || " .-_()".contains(c) { c } else { '_' })
        .collect();
    let czyste = czyste.trim_matches(|c| c == '.' || c == ' ').to_string();
    if czyste.is_empty() { "dokument.pdf".into() } else { czyste }
}

/// Diagnostyka skanera dla serwisu: skąd wczytano config, gdzie szukamy NAPS2
/// i czy w ogóle go widać. Bez tego pierwsze uruchomienie u klienta to
/// zgadywanka — dokładnie tak samo jak było z wagą.
pub fn diagnose(app: &tauri::AppHandle) -> String {
    let mut out = String::new();
    let mut used: Option<String> = None;
    for p in config_paths(app) {
        let exists = p.exists();
        out.push_str(&format!("{} {}\n", if exists { "[jest]" } else { "[brak]" }, p.display()));
        if exists && used.is_none() {
            used = Some(p.display().to_string());
        }
    }
    let cfg = load_config(app);
    out.push_str(&format!(
        "\nUżyty config: {}\n",
        used.as_deref().unwrap_or("BRAK PLIKU → ustawienia domyślne")
    ));
    out.push_str(&format!(
        "Włączony: {}  Profil NAPS2: {}  Stron: {}\n",
        cfg.enabled,
        if cfg.profile.trim().is_empty() { "(domyślny)" } else { cfg.profile.trim() },
        effective_pages(cfg.pages),
    ));

    out.push_str(&format!("\nOstatni skan: {}{}\n", last_scan_path().display(),
                          if last_scan_path().exists() { "" } else { "  (jeszcze nie ma)" }));
    out.push_str("\nSzukanie NAPS2:\n");
    for p in naps2_candidates() {
        out.push_str(&format!("{} {}\n", if p.exists() { "[jest]" } else { "[brak]" }, p.display()));
    }
    match resolve_naps2(&cfg) {
        Some(p) => {
            out.push_str(&format!("\nUżyty NAPS2: {}\n", p.display()));
            // Dokładne polecenie — serwisant może je wkleić w wiersz poleceń
            // i zobaczyć zachowanie NAPS2 bez pośrednictwa MES.
            out.push_str(&format!(
                "\nPolecenie MES:\n\"{}\" -o <plik.pdf> -n {} --force{}\n",
                p.display(),
                effective_pages(cfg.pages),
                if cfg.profile.trim().is_empty() {
                    String::new()
                } else {
                    format!(" -p \"{}\"", cfg.profile.trim())
                }
            ));
        }
        None => out.push_str("\nUżyty NAPS2: NIE ZNALEZIONO — zainstaluj NAPS2 albo \
                              wpisz ścieżkę w scanner.json (naps2Path)\n"),
    }
    out
}


#[cfg(test)]
mod tests {
    use super::{effective_pages, safe_file_name};

    #[test]
    fn zero_stron_nigdy_nie_trafia_do_naps2() {
        // `-n 0` = „zeskanuj zero stron": NAPS2 kończy bez błędu i bez pliku,
        // a operator widzi „kręci chwilę i nic". Tak było do 2.5.43.
        assert_eq!(effective_pages(0), 1);
    }

    #[test]
    fn wieksza_liczba_stron_przechodzi_bez_zmian() {
        assert_eq!(effective_pages(1), 1);
        assert_eq!(effective_pages(5), 5);
    }

    #[test]
    fn nazwa_pliku_nie_wyprowadza_poza_katalog() {
        // Nazwa idzie z nagłówka odpowiedzi serwera — traktujemy ją jak dane
        // z zewnątrz, tak samo jak `is_safe_id()` po stronie backendu.
        // Liczy się JEDEN niezmiennik: w wyniku nie ma separatora ścieżki,
        // więc zapis nie wyjdzie poza katalog. Kropki same w sobie są
        // nieszkodliwe — bez ukośnika „.." to zwykły znak w nazwie.
        for zle in ["../../etc/passwd", "a/b\\c.pdf", "..\\..\\okno.pdf"] {
            let n = safe_file_name(zle);
            assert!(!n.contains('/') && !n.contains('\\'), "separator w {n}");
            assert!(!n.is_empty());
        }
        assert_eq!(safe_file_name("..."), "dokument.pdf");
        assert_eq!(safe_file_name(""), "dokument.pdf");
    }

    #[test]
    fn polskie_znaki_i_spacje_w_nazwie_zostaja() {
        assert_eq!(safe_file_name("HDI 12-08-2026.pdf"), "HDI 12-08-2026.pdf");
        assert_eq!(safe_file_name("Zażółć gęślą.pdf"), "Zażółć gęślą.pdf");
    }
}
