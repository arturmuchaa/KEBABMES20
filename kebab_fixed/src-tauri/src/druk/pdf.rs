//! Geometria druku PDF — czysta, testowana wszędzie. Skala zawsze 1:1:
//! kartki palet z QR nie mogą być dopasowywane do strony.

/// Prostokąt rysowania strony w pikselach urządzenia (x, y, szer, wys).
/// Punkt (0,0) kontekstu drukarki leży w rogu obszaru drukowalnego, więc
/// stronę przesuwamy o fizyczny margines, żeby trafiła 1:1 na kartkę.
pub fn umiesc_strone(szer_pt: f32, wys_pt: f32, dpi_x: i32, dpi_y: i32, offset_x: i32, offset_y: i32) -> (i32, i32, i32, i32) {
    let px = |pt: f32, dpi: i32| (pt / 72.0 * dpi as f32).round() as i32;
    (-offset_x, -offset_y, px(szer_pt, dpi_x), px(wys_pt, dpi_y))
}

/// Zakres stron 1..=n z okna (od/do włącznie) → indeksy od zera.
pub fn zakres(stron: u32, od: Option<u32>, do_: Option<u32>) -> Result<(u32, u32), String> {
    if stron == 0 { return Err("Dokument nie ma stron".into()); }
    let (a, b) = (od.unwrap_or(1).max(1), do_.unwrap_or(stron));
    if a > stron || b > stron || a > b {
        return Err(format!("Zakres stron {a}–{b} wykracza poza dokument ({stron} str.)"));
    }
    Ok((a - 1, b - 1))
}

/// Rozdzielczość renderowania bitmapy: rozdzielczość drukarki, najwyżej 300 dpi
/// (A4 przy 600 dpi to ~140 MB na stronę; 300 dpi wystarcza dla QR i tekstu).
pub fn dpi_renderu(dpi_drukarki: i32) -> i32 { dpi_drukarki.clamp(72, 300) }

#[cfg(test)]
mod testy {
    use super::*;

    #[test]
    fn a4_przy_600dpi_bez_skalowania() {
        let (x, y, w, h) = umiesc_strone(595.0, 842.0, 600, 600, 100, 120);
        assert_eq!((x, y), (-100, -120));
        assert_eq!((w, h), (4958, 7017));
    }

    #[test]
    fn zakres_stron() {
        assert_eq!(zakres(5, None, None).unwrap(), (0, 4));
        assert_eq!(zakres(5, Some(2), Some(3)).unwrap(), (1, 2));
        assert_eq!(zakres(5, Some(4), None).unwrap(), (3, 4));
    }

    #[test]
    fn zakres_stron_poza_dokumentem_blad() {
        assert!(zakres(5, Some(6), None).is_err());
        assert!(zakres(5, Some(3), Some(2)).is_err());
        assert!(zakres(0, None, None).is_err());
    }

    #[test]
    fn dpi_renderu_najwyzej_300() {
        assert_eq!(dpi_renderu(600), 300);
        assert_eq!(dpi_renderu(200), 200);
    }
}
