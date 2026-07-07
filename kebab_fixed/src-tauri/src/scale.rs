//! Most wagowy RS232 → eventy `scale://weight` do frontendu HMI rozbiór v10.
//!
//! Protokół-agnostyczny: z każdej linii ASCII miernika wyciąga pierwszą
//! liczbę (kropka LUB przecinek dziesiętny), a stabilność liczy softwarowo
//! (okno odczytów o rozrzucie ≤ tolerancja przez ≥ 1,5 s) — działa więc z
//! każdą wagą w trybie transmisji ciągłej, bez znajomości formatu ramki.
//! Tolerancja domyślnie 0,5 kg = działka wagi najazdowej 1 t na hali; przy
//! mniejszej odczyt migoczący między dwoma sąsiednimi krokami działki
//! (169,5 ↔ 170,0) nigdy nie byłby „stabilny".
//! Konfiguracja: `scale.json` obok exe albo w app_config_dir
//! (port / baud / stabilityTolKg).

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub const EVENT: &str = "scale://weight";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleReading {
    pub gross: f64,
    pub stable: bool,
    pub connected: bool,
}

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ScaleConfig {
    pub enabled: bool,
    pub port: String,
    pub baud: u32,
    /// Maks. rozrzut odczytów uznawany za stabilny (kg). Domyślnie działka
    /// wagi (0,5 kg) — mniejsza wartość = wieczne „WAŻENIE…" przy migotaniu.
    pub stability_tol_kg: f64,
    /// Komenda tarowania/zerowania wysyłana do wagi (LP7510: "Z" = zero).
    /// Konfigurowalna w scale.json (`tareCmd`) na wypadek innego miernika.
    pub tare_cmd: String,
}

impl Default for ScaleConfig {
    fn default() -> Self {
        Self {
            enabled: true, port: "COM3".into(), baud: 9600,
            stability_tol_kg: 0.5, tare_cmd: "Z\r\n".into(),
        }
    }
}

/// Żądanie tarowania wagi ustawiane przez komendę Tauri `scale_tare`; wątek
/// czytający wysyła komendę między odczytami (port jest jego wyłączną własnością).
pub static TARE_REQUESTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Wywoływane z JS (przycisk „Taruj wagę" w HMI) — zgłasza żądanie tary.
pub fn request_tare() {
    TARE_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Pierwsza liczba w ramce, np. "ST,GS,+  170.0kg" → 170.0, "0170,5" → 170.5.
pub fn parse_weight(line: &str) -> Option<f64> {
    let mut buf = String::new();
    let mut seen_digit = false;
    for c in line.chars() {
        match c {
            '0'..='9' => {
                buf.push(c);
                seen_digit = true;
            }
            '.' | ',' if seen_digit && !buf.contains('.') => buf.push('.'),
            '-' if buf.is_empty() => buf.push('-'),
            _ if seen_digit => break,
            _ => buf.clear(),
        }
    }
    if !seen_digit {
        return None;
    }
    buf.trim_end_matches('.').parse::<f64>().ok()
}

/// Softwarowa detekcja stabilności: okno czasowe odczytów; stabilna gdy w
/// ostatnich `span` jest ≥ `min_count` odczytów o rozrzucie ≤ `tol` kg.
pub struct StabilityWindow {
    readings: VecDeque<(Instant, f64)>,
    span: Duration,
    tol: f64,
    min_count: usize,
}

impl StabilityWindow {
    pub fn new(tol_kg: f64) -> Self {
        Self {
            readings: VecDeque::new(),
            span: Duration::from_millis(1500),
            tol: tol_kg,
            min_count: 5,
        }
    }

    /// Dodaje odczyt, zwraca czy waga jest stabilna.
    pub fn push(&mut self, now: Instant, weight: f64) -> bool {
        self.readings.push_back((now, weight));
        while let Some(&(t, _)) = self.readings.front() {
            if now.duration_since(t) > self.span {
                self.readings.pop_front();
            } else {
                break;
            }
        }
        if self.readings.len() < self.min_count {
            return false;
        }
        let (mut lo, mut hi) = (f64::MAX, f64::MIN);
        for &(_, v) in &self.readings {
            lo = lo.min(v);
            hi = hi.max(v);
        }
        hi - lo <= self.tol
    }
}

fn config_paths(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    // 1. Wspólny plik dla CAŁEGO komputera — widoczny ze WSZYSTKICH kont
    //    (Admin ustawia raz, konto operatora go widzi). To rozwiązuje pułapkę
    //    "działa na Adminie, nie działa na rozbior": AppData jest per-konto,
    //    a instalacja per-user trzyma exe też w profilu, więc bez tej ścieżki
    //    plik z jednego konta był niewidoczny dla drugiego.
    if let Some(pd) = std::env::var_os("ProgramData") {
        paths.push(std::path::Path::new(&pd).join("Rozbior HMI").join("scale.json"));
    }
    // 2. Obok exe (per-konto — zgodność wstecz).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("scale.json"));
        }
    }
    // 3. AppData bieżącego konta (per-konto — zgodność wstecz).
    if let Ok(dir) = app.path().app_config_dir() {
        paths.push(dir.join("scale.json"));
    }
    paths
}

fn load_config(app: &tauri::AppHandle) -> ScaleConfig {
    for p in config_paths(app) {
        if let Ok(s) = std::fs::read_to_string(&p) {
            // Notatnik Windows potrafi zapisać UTF-8 z BOM — serde_json odrzuca
            // taki plik i konfiguracja po cichu wracała do domyślnej (COM3).
            let s = s.trim_start_matches('\u{feff}');
            match serde_json::from_str(s) {
                Ok(cfg) => return cfg,
                Err(e) => eprintln!("scale.json niepoprawny ({}): {e}", p.display()),
            }
        }
    }
    ScaleConfig::default()
}

/// Diagnostyka wagi dla menu serwisowego: skąd wczytano config, jaki port,
/// jakie porty COM widzi system i czy port konfiguracyjny da się otworzyć.
/// Bez tego serwisant był ślepy — nie wiadomo, czy HMI w ogóle czyta plik.
pub fn diagnose(app: &tauri::AppHandle) -> String {
    let mut out = String::new();
    let mut used_path: Option<String> = None;
    for p in config_paths(app) {
        let exists = p.exists();
        out.push_str(&format!(
            "{} {}\n",
            if exists { "[jest]" } else { "[brak]" },
            p.display()
        ));
        if exists && used_path.is_none() {
            used_path = Some(p.display().to_string());
        }
    }
    let cfg = load_config(app);
    out.push_str(&format!(
        "\nUżyty config: {}\n",
        used_path.as_deref().unwrap_or("BRAK PLIKU → domyślny COM3")
    ));
    out.push_str(&format!("Port: {}  Baud: {}\n", cfg.port, cfg.baud));

    let available = serialport::available_ports()
        .map(|v| {
            v.into_iter()
                .map(|p| p.port_name)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_else(|_| "(błąd odczytu)".into());
    out.push_str(&format!("Porty w systemie: {}\n", if available.is_empty() { "(żadnych)".into() } else { available }));

    match serialport::new(&cfg.port, cfg.baud)
        .timeout(Duration::from_millis(300))
        .open()
    {
        Ok(_) => out.push_str(&format!("Otwarcie {}: OK (port istnieje i wolny)\n", cfg.port)),
        Err(e) => out.push_str(&format!("Otwarcie {}: BŁĄD — {}\n", cfg.port, e)),
    }
    out
}

/// Wątek czytający wagę przez cały czas życia aplikacji; po błędzie portu
/// emituje `connected: false` i ponawia otwarcie co 3 s.
pub fn spawn_reader(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let cfg = load_config(&app);
        if !cfg.enabled {
            return;
        }
        loop {
            match serialport::new(&cfg.port, cfg.baud)
                .timeout(Duration::from_millis(500))
                .open()
            {
                Ok(port) => read_loop(&app, port, cfg.stability_tol_kg, &cfg.tare_cmd),
                Err(_) => {
                    let _ = app.emit(
                        EVENT,
                        ScaleReading { gross: 0.0, stable: false, connected: false },
                    );
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn read_loop(app: &tauri::AppHandle, port: Box<dyn serialport::SerialPort>, tol_kg: f64, tare_cmd: &str) {
    let mut reader = BufReader::new(port);
    let mut window = StabilityWindow::new(tol_kg);
    let mut line = String::new();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    loop {
        // Żądanie tary z HMI — wyślij komendę do wagi (port jest nasz wyłącznie).
        if TARE_REQUESTED.swap(false, std::sync::atomic::Ordering::SeqCst) {
            let p = reader.get_mut();
            let _ = p.write_all(tare_cmd.as_bytes());
            let _ = p.flush();
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return, // port zniknął (odpięty kabel/USB)
            Ok(_) => {
                if let Some(gross) = parse_weight(&line) {
                    let stable = window.push(Instant::now(), gross);
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        last_emit = Instant::now();
                        let _ = app.emit(
                            EVENT,
                            ScaleReading { gross, stable, connected: true },
                        );
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_ramka_st_gs() {
        assert_eq!(parse_weight("ST,GS,+  170.0kg\r\n"), Some(170.0));
    }

    #[test]
    fn parser_przecinek_dziesietny() {
        assert_eq!(parse_weight("  0150,5 kg"), Some(150.5));
    }

    #[test]
    fn parser_liczba_ujemna_i_zero() {
        assert_eq!(parse_weight("-0.4kg"), Some(-0.4));
        assert_eq!(parse_weight("W+000.0"), Some(0.0));
    }

    #[test]
    fn parser_smieci_bez_liczby() {
        assert_eq!(parse_weight("ERR OVERLOAD"), None);
        assert_eq!(parse_weight(""), None);
    }

    #[test]
    fn stabilnosc_wymaga_min_odczytow() {
        let mut w = StabilityWindow::new(0.5);
        let t0 = Instant::now();
        assert!(!w.push(t0, 170.0));
        assert!(!w.push(t0 + Duration::from_millis(200), 170.0));
        assert!(!w.push(t0 + Duration::from_millis(400), 170.0));
        assert!(!w.push(t0 + Duration::from_millis(600), 170.05));
        // 5. odczyt w oknie, rozrzut 0,05 ≤ 0,5 → stabilna
        assert!(w.push(t0 + Duration::from_millis(800), 170.0));
    }

    #[test]
    fn stabilnosc_migotanie_dzialki_05_jest_stabilne() {
        // Waga z działką 0,5 kg na granicy kroku: 169,5 ↔ 170,0 w kółko.
        let mut w = StabilityWindow::new(0.5);
        let t0 = Instant::now();
        let vals = [169.5, 170.0, 169.5, 170.0];
        for (i, v) in vals.iter().enumerate() {
            w.push(t0 + Duration::from_millis(200 * i as u64), *v);
        }
        assert!(w.push(t0 + Duration::from_millis(800), 169.5));
    }

    #[test]
    fn stabilnosc_rozrzut_ponad_tolerancje() {
        let mut w = StabilityWindow::new(0.5);
        let t0 = Instant::now();
        for (i, v) in [168.0, 169.5, 170.5, 169.9, 170.1].iter().enumerate() {
            assert!(!w.push(t0 + Duration::from_millis(200 * i as u64), *v));
        }
    }

    #[test]
    fn stabilnosc_stare_odczyty_wypadaja_z_okna() {
        let mut w = StabilityWindow::new(0.5);
        let t0 = Instant::now();
        // skok wagi dawno temu nie psuje stabilności teraz
        w.push(t0, 20.0);
        for i in 1..=5 {
            w.push(t0 + Duration::from_millis(1600 + 200 * i), 170.0);
        }
        assert!(w.push(t0 + Duration::from_millis(3000), 170.0));
    }

    #[test]
    fn config_default_gdy_brak_pliku() {
        let cfg = ScaleConfig::default();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, "COM3");
        assert_eq!(cfg.baud, 9600);
        assert_eq!(cfg.stability_tol_kg, 0.5);
    }
}
