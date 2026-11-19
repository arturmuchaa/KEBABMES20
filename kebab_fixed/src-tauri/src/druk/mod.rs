//! Własne okno druku: drukarki, opcje sterownika, druk PDF (Windows).
//!
//! Właściciel 19.11.2026: wybór zasobnika (i innych opcji sterownika) przy
//! każdym wydruku, jak w Subiekcie, bez wchodzenia w ustawienia drukarki.
//! Spec: docs/superpowers/specs/2026-11-19-okno-druku-design.md
pub mod mozliwosci;
pub mod ustawienia;
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
pub fn druk_drukarki() -> Result<Vec<Drukarka>, String> {
    #[cfg(windows)]
    { Ok(win::drukarki()?.into_iter().map(|(nazwa, domyslna)| Drukarka { nazwa, domyslna }).collect()) }
    #[cfg(not(windows))]
    { Err(NIEOBSLUGIWANE.into()) }
}

#[tauri::command]
pub fn druk_mozliwosci(drukarka: String, ticket: Option<String>) -> Result<Mozliwosci, String> {
    #[cfg(windows)]
    {
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
}
