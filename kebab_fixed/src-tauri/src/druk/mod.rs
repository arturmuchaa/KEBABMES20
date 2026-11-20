//! Własne okno druku: drukarki, opcje sterownika, druk PDF (Windows).
//!
//! Właściciel 19.11.2026: wybór zasobnika (i innych opcji sterownika) przy
//! każdym wydruku, jak w Subiekcie, bez wchodzenia w ustawienia drukarki.
//! Spec: docs/superpowers/specs/2026-11-19-okno-druku-design.md
pub mod mozliwosci;
pub mod pdf;
pub mod ustawienia;
pub mod zapis;
#[cfg(windows)]
pub mod webview;
#[cfg(windows)]
pub mod win;

use mozliwosci::Funkcja;
use serde::Serialize;

#[derive(Serialize)]
pub struct Drukarka {
    pub nazwa: String,
    pub domyslna: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mozliwosci {
    pub funkcje: Vec<Funkcja>,
    pub ticket: String,
    pub kopie_max: u32,
    /// Id funkcji zasobnika i opcja „zasobnik 1” — front ustawia ją przy pierwszym uruchomieniu.
    pub zasobnik_domyslny: Option<(String, String)>,
}

#[allow(dead_code)]
const NIEOBSLUGIWANE: &str = "nieobsługiwane: druk natywny działa tylko w Windows";

#[tauri::command]
pub async fn druk_drukarki() -> Result<Vec<Drukarka>, String> {
    #[cfg(windows)]
    { Ok(win::drukarki()?.into_iter().map(|(nazwa, domyslna)| Drukarka { nazwa, domyslna }).collect()) }
    #[cfg(not(windows))]
    { Err(NIEOBSLUGIWANE.into()) }
}

#[tauri::command]
pub async fn druk_mozliwosci(drukarka: String, ticket: Option<String>) -> Result<Mozliwosci, String> {
    #[cfg(windows)]
    {
        let _com = win::Com::init();
        let ticket = win::ticket_sprawdzony(&drukarka, ticket.as_deref())?;
        let caps = win::mozliwosci_xml(&drukarka, &ticket)?;
        Ok(zbuduj(&caps, ticket))
    }
    #[cfg(not(windows))]
    { let _ = (drukarka, ticket); Err(NIEOBSLUGIWANE.into()) }
}

#[allow(dead_code)]
fn zbuduj(caps: &str, ticket: String) -> Mozliwosci {
    let funkcje = mozliwosci::parsuj_mozliwosci(caps, &ticket).unwrap_or_default();
    let zasobnik_domyslny = funkcje.iter()
        .find(|f| f.id.ends_with("}PageInputBin") || f.id.ends_with("}JobInputBin"))
        .and_then(|f| mozliwosci::zasobnik_domyslny(f).map(|o| (f.id.clone(), o)));
    Mozliwosci { funkcje, kopie_max: mozliwosci::kopie_max(caps), ticket, zasobnik_domyslny }
}

#[tauri::command]
pub fn druk_ustaw_opcje(ticket: String, funkcja: String, opcja: String) -> Result<String, String> {
    mozliwosci::ustaw_opcje(&ticket, &funkcja, &opcja)
}

#[tauri::command]
pub fn druk_ustawienia_czytaj() -> Result<String, String> {
    ustawienia::czytaj(&ustawienia::katalog_domyslny())
}

#[tauri::command]
pub fn druk_ustawienia_zapisz(json: String) -> Result<(), String> {
    ustawienia::zapisz(&ustawienia::katalog_domyslny(), &json)
}

/// Oryginalne okno sterownika. Komenda synchroniczna = wątek główny, więc
/// okno Konica jest modalne względem okna aplikacji.
#[tauri::command]
pub fn druk_ustawienia_sterownika(window: tauri::WebviewWindow, drukarka: String, ticket: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        win::okno_sterownika(hwnd, &drukarka, &ticket)
    }
    #[cfg(not(windows))]
    { let _ = (window, drukarka, ticket); Err(NIEOBSLUGIWANE.into()) }
}

/// Bieżąca strona jako PDF (base64).
#[tauri::command]
pub async fn druk_strona_pdf(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(windows)]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        window.with_webview(move |wv| {
            let wynik = unsafe { wv.controller().CoreWebView2() };
            match wynik {
                Ok(core) => webview::zamow_pdf(&core, tx),
                Err(e) => { let _ = tx.send(Err(e.message().to_string())); }
            }
        }).map_err(|e| e.to_string())?;
        rx.await.map_err(|_| "Zamiana strony na PDF przerwana".to_string())?
    }
    #[cfg(not(windows))]
    { let _ = window; Err(NIEOBSLUGIWANE.into()) }
}

/// Druk PDF z ustawieniami sterownika. Zwraca liczbę wydrukowanych stron.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn druk_pdf(app: tauri::AppHandle, drukarka: String, pdf: String, ticket: String, kopie: u32,
                      od: Option<u32>, r#do: Option<u32>, tytul: String) -> Result<u32, String> {
    #[cfg(windows)]
    {
        use base64::Engine;
        use tauri::Manager;
        let bajty = base64::engine::general_purpose::STANDARD.decode(pdf.as_bytes()).map_err(|e| format!("PDF: {e}"))?;
        let dll = app.path().resource_dir().map(|d| d.join("pdfium.dll")).ok()
            .filter(|p| p.exists())
            .or_else(|| std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("pdfium.dll"))))
            .ok_or("Brak biblioteki PDF (pdfium.dll) obok programu")?;
        let ticket = ticket_do_druku(&ticket);
        tauri::async_runtime::spawn_blocking(move || {
            let _com = win::Com::init();
            win::drukuj_pdf(&drukarka, &bajty, &ticket, kopie, od, r#do, &tytul, &dll)
        })
            .await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = (app, drukarka, pdf, ticket, kopie, od, r#do, tytul); Err(NIEOBSLUGIWANE.into()) }
}

/// Nazwa komputera do rejestru wydruków („który z trzech komputerów”).
#[tauri::command]
pub fn druk_komputer() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default()
}

/// Ticket do druku: skalowanie zawsze wyłączone (kartki z QR 1:1), nawet gdy
/// domyślne ustawienia użytkownika w Windows mają „dopasuj do strony”.
#[allow(dead_code)]
pub fn ticket_do_druku(ticket: &str) -> String {
    const PSK: &str = "{http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords}";
    mozliwosci::ustaw_opcje(ticket, &format!("{PSK}PageScaling"), &format!("{PSK}None"))
        .unwrap_or_else(|_| ticket.to_string())
}

#[cfg(test)]
mod testy {
    #[test]
    fn zbuduj_wskazuje_zasobnik_1() {
        let caps = include_str!("../../tests/fixtures/bizhub-capabilities.xml");
        let t = include_str!("../../tests/fixtures/bizhub-ticket.xml");
        let m = super::zbuduj(caps, t.into());
        let (f, o) = m.zasobnik_domyslny.unwrap();
        assert!(f.ends_with("}PageInputBin") && o.ends_with("}Tray1"));
        assert_eq!(m.kopie_max, 9999);
    }

    #[test]
    fn druk_zawsze_bez_skalowania() {
        let t = include_str!("../../tests/fixtures/bizhub-ticket.xml")
            .replace("</psf:PrintTicket>", "<psf:Feature name=\"psk:PageScaling\"><psf:Option name=\"psk:FitApplicationBleedSizeToPageImageableSize\"/></psf:Feature></psf:PrintTicket>");
        let wynik = super::ticket_do_druku(&t);
        assert!(wynik.contains("psk:None"), "{wynik}");
        assert!(!wynik.contains("FitApplicationBleedSizeToPageImageableSize"));
        // ticket bez tej funkcji dostaje ją dopisaną
        let bez = super::ticket_do_druku(include_str!("../../tests/fixtures/bizhub-ticket.xml"));
        assert!(bez.contains("PageScaling") && bez.contains("psk:None"));
    }
}

/// Folder zapisu PDF: Pobrane użytkownika (jak pobieranie w starym MES z przeglądarki).
fn folder_pobrane(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().download_dir().or_else(|_| app.path().document_dir()).map_err(|e| format!("Nie znaleziono folderu Pobrane: {e}"))
}

/// Zapis PDF (base64) do folderu Pobrane, bez okna druku. Zwraca pełną ścieżkę pliku.
#[tauri::command]
pub fn druk_zapisz_pdf(app: tauri::AppHandle, nazwa: String, pdf: String) -> Result<String, String> {
    use base64::Engine;
    let bajty = base64::engine::general_purpose::STANDARD.decode(pdf.as_bytes()).map_err(|e| format!("Uszkodzony PDF: {e}"))?;
    Ok(zapis::zapisz(&folder_pobrane(&app)?, &nazwa, &bajty)?.to_string_lossy().to_string())
}

/// Pokaż zapisany plik w Eksploratorze (zaznaczony).
#[tauri::command]
pub fn druk_pokaz_plik(app: tauri::AppHandle, sciezka: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(&sciezka).map_err(|e| format!("Nie udało się otworzyć folderu: {e}"))
}
