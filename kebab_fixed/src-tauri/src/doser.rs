//! Most dozownika wody DW-1C (ELEKTRON s.c.) → eventy `doser://state`.
//!
//! Urządzenie stoi na masowni i samo zamyka elektrozawór po zadanej dawce,
//! ale modułu RS-485 (Modbus RTU, slave) jeszcze nie ma — jest dokupywany.
//! Do tego czasu most jest WYŁĄCZONY (`enabled: false` w `doser.json`) i nie
//! emituje nic, a panel przyjmuje litry z klawiatury w oknie ±3%.
//!
//! Po dokupieniu modułu wystarczy włączyć `doser.json` i dopisać ramki
//! protokołu w `read_loop` — ekran masowni zostaje bez zmian, bo hook
//! `useDoser()` czyta wyłącznie ten event.
//!
//! Konfiguracja: `doser.json` obok exe albo w ProgramData (te same ścieżki,
//! co `scale.json`).

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::Emitter;

pub const EVENT: &str = "doser://state";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoserState {
    /// Ile litrów urządzenie zgłasza jako nalane.
    pub dosed_l: f64,
    /// Zawór otwarty — dozowanie w toku.
    pub running: bool,
    pub connected: bool,
    /// Urządzenie nadaje, ale ramki nie mają liczby (awaria przepływomierza).
    pub error: bool,
}

#[derive(Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DoserConfig {
    /// DOMYŚLNIE WYŁĄCZONY: modułu RS-485 jeszcze nie ma, a włączony most
    /// bez urządzenia zalewałby log próbami otwarcia nieistniejącego portu.
    pub enabled: bool,
    pub port: String,
    pub baud: u32,
    /// Adres urządzenia na magistrali (Modbus RTU slave).
    pub unit_id: u8,
}

impl Default for DoserConfig {
    fn default() -> Self {
        Self { enabled: false, port: "COM4".into(), baud: 9600, unit_id: 1 }
    }
}

/// Zadana dawka w setnych litra; 0 = nic nie zlecono.
static DOSE_REQUESTED: AtomicU64 = AtomicU64::new(0);

/// Wywoływane z JS (przycisk „Dozuj" w panelu masowni).
pub fn request_dose(liters: f64) -> Result<(), String> {
    validate_dose(liters)?;
    DOSE_REQUESTED.store((liters * 100.0).round() as u64, Ordering::SeqCst);
    Ok(())
}

/// Dawka musi być dodatnia i mieścić się w rozsądku hali: największy wsad to
/// 600 kg, czyli ok. 110 L wody. 1000 L to pomyłka przecinka, nie dawka.
pub fn validate_dose(liters: f64) -> Result<(), String> {
    if !(liters.is_finite()) || liters <= 0.0 {
        return Err("Dawka musi być większa od zera".into());
    }
    if liters > 1000.0 {
        return Err("Dawka poza zakresem urządzenia".into());
    }
    Ok(())
}

/// Pierwsza liczba w ramce, np. "DOS,+ 108.0L" → 108.0, "0108,5" → 108.5.
/// Ten sam parser co przy wadze — protokół DW-1C potwierdzimy przy module.
pub fn parse_liters(line: &str) -> Option<f64> {
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

fn load_config(app: &tauri::AppHandle) -> DoserConfig {
    for p in crate::scale::device_config_paths(app, "doser.json") {
        if let Ok(s) = std::fs::read_to_string(&p) {
            let s = s.trim_start_matches('\u{feff}');
            match serde_json::from_str(s) {
                Ok(cfg) => return cfg,
                Err(e) => eprintln!("doser.json niepoprawny ({}): {e}", p.display()),
            }
        }
    }
    DoserConfig::default()
}

/// Wątek dozownika. Dopóki `enabled == false` (czyli do czasu dokupienia
/// modułu RS-485), kończy się od razu i panel widzi `connected: false`.
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
                Ok(port) => read_loop(&app, port),
                Err(_) => {
                    let _ = app.emit(
                        EVENT,
                        DoserState { dosed_l: 0.0, running: false, connected: false, error: false },
                    );
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn read_loop(app: &tauri::AppHandle, port: Box<dyn serialport::SerialPort>) {
    let mut reader = BufReader::new(port);
    let mut line = String::new();
    loop {
        // Zlecenie dawki z panelu — port jest wyłączną własnością tego wątku.
        let dose = DOSE_REQUESTED.swap(0, Ordering::SeqCst);
        if dose > 0 {
            let p = reader.get_mut();
            let _ = p.write_all(format!("D{:.2}\r\n", dose as f64 / 100.0).as_bytes());
            let _ = p.flush();
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return,
            Ok(_) => {
                if let Some(dosed) = parse_liters(&line) {
                    let running = line.contains('R') || dose > 0;
                    let _ = app.emit(
                        EVENT,
                        DoserState { dosed_l: dosed, running, connected: true, error: false },
                    );
                } else if !line.trim().is_empty() {
                    let _ = app.emit(
                        EVENT,
                        DoserState { dosed_l: 0.0, running: false, connected: true, error: true },
                    );
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
    fn domyslnie_dozownik_jest_wylaczony() {
        // Moduł RS-485 dochodzi do DW-1C dopiero za jakiś czas — do tego momentu
        // most ma milczeć, a panel przyjmować litry z klawiatury.
        let cfg = DoserConfig::default();
        assert!(!cfg.enabled);
    }

    #[test]
    fn czyta_litry_z_ramki_urzadzenia() {
        assert_eq!(parse_liters("DOS,+ 108.0L"), Some(108.0));
        assert_eq!(parse_liters("0108,5"), Some(108.5));
        assert_eq!(parse_liters("ERR"), None);
    }

    #[test]
    fn dawka_musi_byc_dodatnia() {
        assert!(validate_dose(108.0).is_ok());
        assert!(validate_dose(0.0).is_err());
        assert!(validate_dose(-5.0).is_err());
    }

    #[test]
    fn dawka_poza_zakresem_urzadzenia_jest_odrzucana() {
        // 1080 L zamiast 108 L to pomyłka przecinka — takiej dawki nie wysyłamy.
        assert!(validate_dose(1080.0).is_err());
    }
}
