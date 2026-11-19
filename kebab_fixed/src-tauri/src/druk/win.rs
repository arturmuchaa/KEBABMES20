//! Win32: drukarki, Print Schema (PrintCapabilities / PrintTicket), DEVMODE.
//! Kompiluje się tylko na Windows (`#[cfg(windows)]` w `mod.rs`).

use windows::core::{BSTR, PCWSTR, PWSTR};
use windows::Win32::Graphics::Gdi::DEVMODEW;
use windows::Win32::Graphics::Printing::PrintTicket::{
    kPTJobScope, kUserDefaultDevmode, PTCloseProvider, PTConvertDevModeToPrintTicket,
    PTConvertPrintTicketToDevMode, PTGetPrintCapabilities, PTMergeAndValidatePrintTicket,
    PTOpenProvider, PTReleaseMemory, HPTPROVIDER,
};
use windows::Win32::Graphics::Printing::{
    ClosePrinter, DocumentPropertiesW, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
    PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
};
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STREAM_SEEK_SET};
use windows::Win32::UI::Shell::SHCreateMemStream;

pub const DM_OUT_BUFFER: u32 = 2;
pub const DM_IN_PROMPT: u32 = 4;
pub const DM_IN_BUFFER: u32 = 8;

pub fn w(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

fn err(e: windows::core::Error) -> String { format!("{} (0x{:08X})", e.message(), e.code().0) }

pub fn drukarki() -> Result<Vec<(String, bool)>, String> {
    let domyslna = domyslna_drukarka().unwrap_or_default();
    let flagi = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let (mut potrzeba, mut ile) = (0u32, 0u32);
    unsafe {
        let _ = EnumPrintersW(flagi, PCWSTR::null(), 4, None, &mut potrzeba, &mut ile);
        if potrzeba == 0 { return Ok(Vec::new()); }
        let mut buf = vec![0u8; potrzeba as usize];
        EnumPrintersW(flagi, PCWSTR::null(), 4, Some(&mut buf), &mut potrzeba, &mut ile).map_err(err)?;
        let info = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, ile as usize);
        Ok(info.iter().filter_map(|p| p.pPrinterName.to_string().ok())
            .map(|n| { let d = n == domyslna; (n, d) }).collect())
    }
}

pub fn domyslna_drukarka() -> Option<String> {
    let mut n = 0u32;
    unsafe {
        let _ = GetDefaultPrinterW(None, &mut n);
        if n == 0 { return None; }
        let mut buf = vec![0u16; n as usize];
        if !GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut n).as_bool() { return None; }
        PWSTR(buf.as_mut_ptr()).to_string().ok()
    }
}

struct Drukarka(PRINTER_HANDLE);
impl Drukarka {
    fn otworz(nazwa: &str) -> Result<Self, String> {
        let wn = w(nazwa);
        let mut h = PRINTER_HANDLE::default();
        unsafe { OpenPrinterW(PCWSTR(wn.as_ptr()), &mut h, None) }
            .map_err(|e| format!("Nie można otworzyć drukarki „{nazwa}”: {}", err(e)))?;
        Ok(Self(h))
    }
}
impl Drop for Drukarka { fn drop(&mut self) { unsafe { let _ = ClosePrinter(self.0); } } }

struct Dostawca(HPTPROVIDER);
impl Dostawca {
    fn otworz(nazwa: &str) -> Result<Self, String> {
        let wn = w(nazwa);
        unsafe { PTOpenProvider(PCWSTR(wn.as_ptr()), 1) }.map(Self)
            .map_err(|e| format!("Sterownik „{nazwa}” nie udostępnia ustawień: {}", err(e)))
    }
}
impl Drop for Dostawca { fn drop(&mut self) { unsafe { let _ = PTCloseProvider(self.0); } } }

fn strumien(dane: &[u8]) -> Result<IStream, String> {
    unsafe { SHCreateMemStream(Some(dane)) }.ok_or_else(|| "Brak pamięci na strumień".into())
}

fn czytaj_strumien(s: &IStream) -> Result<String, String> {
    unsafe {
        let mut st = Default::default();
        s.Stat(&mut st, STATFLAG_NONAME).map_err(err)?;
        s.Seek(0, STREAM_SEEK_SET, None).map_err(err)?;
        let mut buf = vec![0u8; st.cbSize as usize];
        let mut przeczytane = 0u32;
        s.Read(buf.as_mut_ptr() as *mut _, buf.len() as u32, Some(&mut przeczytane)).ok().map_err(err)?;
        buf.truncate(przeczytane as usize);
        Ok(String::from_utf8_lossy(&buf).into_owned())
    }
}

/// DEVMODE użytkownika dla drukarki (ustawienia domyślne z Windows).
pub fn devmode_domyslny(nazwa: &str) -> Result<Vec<u8>, String> {
    let d = Drukarka::otworz(nazwa)?;
    let wn = w(nazwa);
    unsafe {
        let n = DocumentPropertiesW(None, d.0, PCWSTR(wn.as_ptr()), None, None, 0);
        if n <= 0 { return Err(format!("Sterownik „{nazwa}” nie zwrócił ustawień")); }
        let mut buf = vec![0u8; n as usize];
        let r = DocumentPropertiesW(None, d.0, PCWSTR(wn.as_ptr()), Some(buf.as_mut_ptr() as *mut DEVMODEW), None, DM_OUT_BUFFER);
        if r < 0 { return Err(format!("Sterownik „{nazwa}” nie zwrócił ustawień")); }
        Ok(buf)
    }
}

pub fn ticket_z_devmode(nazwa: &str, devmode: &[u8]) -> Result<String, String> {
    let p = Dostawca::otworz(nazwa)?;
    let wyj = strumien(&[])?;
    unsafe { PTConvertDevModeToPrintTicket(p.0, devmode.len() as u32, devmode.as_ptr() as *const _, kPTJobScope, &wyj) }
        .map_err(err)?;
    czytaj_strumien(&wyj)
}

pub fn devmode_z_ticketu(nazwa: &str, ticket: &str) -> Result<Vec<u8>, String> {
    let p = Dostawca::otworz(nazwa)?;
    let wej = strumien(ticket.as_bytes())?;
    let mut rozmiar = 0u32;
    let mut dm: *mut DEVMODEW = std::ptr::null_mut();
    let mut blad = BSTR::new();
    unsafe {
        PTConvertPrintTicketToDevMode(p.0, &wej, kUserDefaultDevmode, kPTJobScope, &mut rozmiar,
            &mut dm as *mut *mut DEVMODEW as *mut *mut _, Some(&mut blad))
            .map_err(|e| format!("{} {}", err(e), blad))?;
        let wynik = std::slice::from_raw_parts(dm as *const u8, rozmiar as usize).to_vec();
        let _ = PTReleaseMemory(dm as *const _);
        Ok(wynik)
    }
}

pub fn ticket_domyslny(nazwa: &str) -> Result<String, String> {
    ticket_z_devmode(nazwa, &devmode_domyslny(nazwa)?)
}

/// Zapisany ticket poprawiony przez sterownik (np. po aktualizacji sterownika
/// opcja zniknęła) — na bazie domyślnego ticketu drukarki.
pub fn ticket_sprawdzony(nazwa: &str, ticket: Option<&str>) -> Result<String, String> {
    let baza = ticket_domyslny(nazwa)?;
    let Some(t) = ticket.filter(|t| !t.trim().is_empty()) else { return Ok(baza) };
    let p = Dostawca::otworz(nazwa)?;
    let (b, d, wyj) = (strumien(baza.as_bytes())?, strumien(t.as_bytes())?, strumien(&[])?);
    let mut blad = BSTR::new();
    match unsafe { PTMergeAndValidatePrintTicket(p.0, &b, &d, kPTJobScope, &wyj, Some(&mut blad)) } {
        Ok(()) => czytaj_strumien(&wyj),
        Err(_) => Ok(baza),
    }
}

pub fn mozliwosci_xml(nazwa: &str, ticket: &str) -> Result<String, String> {
    let p = Dostawca::otworz(nazwa)?;
    let (t, wyj) = (strumien(ticket.as_bytes())?, strumien(&[])?);
    let mut blad = BSTR::new();
    unsafe { PTGetPrintCapabilities(p.0, &t, &wyj, Some(&mut blad)) }
        .map_err(|e| format!("{} {}", err(e), blad))?;
    czytaj_strumien(&wyj)
}
