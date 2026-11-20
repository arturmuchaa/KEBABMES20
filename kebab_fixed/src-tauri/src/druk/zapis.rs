//! Zapis PDF wprost do folderu Pobrane — bez okna drukarki i „Zapisz jako PDF”.
//! Właściciel 20.11.2026: zapis jak w starym MES (plik nazwany po dokumencie,
//! np. `WZ_KLIENT_12-11-26.pdf`), kilka zaznaczonych = kilka osobnych plików.

use std::path::{Path, PathBuf};

/// Nazwa bez znaków niedozwolonych w Windows; zawsze z rozszerzeniem `.pdf`.
pub fn bezpieczna_nazwa(surowa: &str) -> String {
    let czyste: String = surowa
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    let czyste = czyste.trim_matches(|c| c == '.' || c == ' ').to_string();
    let czyste = if czyste.is_empty() { "dokument".to_string() } else { czyste };
    if czyste.to_lowercase().ends_with(".pdf") { czyste } else { format!("{czyste}.pdf") }
}

/// Ścieżka, która niczego nie nadpisze: ten sam plik (te same bajty) zwraca
/// istniejący, inny dostaje „ (2)”, „ (3)”… — jak pobieranie w przeglądarce.
pub fn wolna_sciezka(katalog: &Path, nazwa: &str, bajty: &[u8]) -> PathBuf {
    let p = katalog.join(nazwa);
    if !p.exists() || std::fs::read(&p).map(|b| b == bajty).unwrap_or(false) {
        return p;
    }
    let (rdzen, rozsz) = match nazwa.rfind('.') { Some(i) => (&nazwa[..i], &nazwa[i..]), None => (nazwa, "") };
    for n in 2..1000 {
        let k = katalog.join(format!("{rdzen} ({n}){rozsz}"));
        if !k.exists() || std::fs::read(&k).map(|b| b == bajty).unwrap_or(false) {
            return k;
        }
    }
    katalog.join(format!("{rdzen} ({}){rozsz}", std::process::id()))
}

pub fn zapisz(katalog: &Path, nazwa: &str, bajty: &[u8]) -> Result<PathBuf, String> {
    if bajty.is_empty() {
        return Err("Pusty dokument — nie ma czego zapisać.".into());
    }
    std::fs::create_dir_all(katalog).map_err(|e| format!("Nie udało się utworzyć {}: {e}", katalog.display()))?;
    let p = wolna_sciezka(katalog, &bezpieczna_nazwa(nazwa), bajty);
    std::fs::write(&p, bajty).map_err(|e| format!("Nie udało się zapisać {}: {e}", p.display()))?;
    Ok(p)
}

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn nazwa_bez_znakow_windows_i_z_pdf() {
        assert_eq!(bezpieczna_nazwa("WZ_PROVIA GLOBAL BV_12/11/26"), "WZ_PROVIA GLOBAL BV_12_11_26.pdf");
        assert_eq!(bezpieczna_nazwa("HDI_KLIENT_5.pdf"), "HDI_KLIENT_5.pdf");
        assert_eq!(bezpieczna_nazwa("  ..  "), "dokument.pdf");
        assert_eq!(bezpieczna_nazwa("Saldo Księżyc 2026-11-20.PDF"), "Saldo Księżyc 2026-11-20.PDF");
    }

    #[test]
    fn nie_nadpisuje_innego_pliku_a_ten_sam_zostawia() {
        let d = std::env::temp_dir().join(format!("kebab-zapis-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let a = zapisz(&d, "WZ_A_1.pdf", b"%PDF-1").unwrap();
        assert_eq!(a.file_name().unwrap(), "WZ_A_1.pdf");
        assert_eq!(zapisz(&d, "WZ_A_1.pdf", b"%PDF-1").unwrap(), a);
        let b = zapisz(&d, "WZ_A_1.pdf", b"%PDF-2").unwrap();
        assert_eq!(b.file_name().unwrap(), "WZ_A_1 (2).pdf");
        assert_eq!(std::fs::read(&a).unwrap(), b"%PDF-1");
        assert!(zapisz(&d, "x.pdf", b"").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
