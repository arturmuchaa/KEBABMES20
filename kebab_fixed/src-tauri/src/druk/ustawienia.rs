//! Ustawienia druku na tym komputerze: `%APPDATA%\KebabMES\druk.json`.
//! Wspólne dla MES i PROTRIMA na komputerze, osobne na każdym komputerze.
//! Treść (JSON) układa front — tu tylko bezpieczny odczyt i zapis.

use std::fs;
use std::path::{Path, PathBuf};

pub fn katalog_domyslny() -> PathBuf {
    let baza = std::env::var_os("APPDATA").map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    baza.join("KebabMES")
}

/// Treść pliku albo `{}` — brak pliku lub uszkodzony plik nie blokuje druku.
pub fn czytaj(katalog: &Path) -> Result<String, String> {
    match fs::read_to_string(katalog.join("druk.json")) {
        Ok(t) if serde_json::from_str::<serde_json::Value>(&t).is_ok() => Ok(t),
        _ => Ok("{}".into()),
    }
}

/// Zapis atomowy (plik tymczasowy + rename); zły JSON odrzucony.
pub fn zapisz(katalog: &Path, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("Nieprawidłowe ustawienia: {e}"))?;
    fs::create_dir_all(katalog).map_err(|e| e.to_string())?;
    let tmp = katalog.join("druk.json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, katalog.join("druk.json")).map_err(|e| e.to_string())
}

#[cfg(test)]
mod testy {
    use super::*;

    fn tmp(n: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("druk-test-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn brak_pliku_daje_puste() {
        assert_eq!(czytaj(&tmp("brak")).unwrap(), "{}");
    }

    #[test]
    fn zapis_i_odczyt() {
        let d = tmp("zapis");
        zapisz(&d, r#"{"dokumenty":{"wz":{"drukarka":"bizhub"}}}"#).unwrap();
        assert!(czytaj(&d).unwrap().contains("bizhub"));
        assert!(!d.join("druk.json.tmp").exists());
    }

    #[test]
    fn zly_json_odrzucony_i_plik_nietkniety() {
        let d = tmp("zly");
        zapisz(&d, r#"{"a":1}"#).unwrap();
        assert!(zapisz(&d, "{nie json").is_err());
        assert_eq!(czytaj(&d).unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn uszkodzony_plik_czytany_jako_puste() {
        let d = tmp("uszk");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("druk.json"), "{{{").unwrap();
        assert_eq!(czytaj(&d).unwrap(), "{}");
    }
}
