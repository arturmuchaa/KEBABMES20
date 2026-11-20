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

// ── Okno sterownika i druk PDF (Task 3) ────────────────────────────────

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    CreateDCW, DeleteDC, GetDeviceCaps, DM_COPIES, LOGPIXELSX, LOGPIXELSY, PHYSICALOFFSETX, PHYSICALOFFSETY,
};
use windows::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

/// Oryginalne okno ustawień sterownika (Konica). Anulowanie → ticket bez zmian.
pub fn okno_sterownika(hwnd: HWND, nazwa: &str, ticket: &str) -> Result<String, String> {
    let wej = devmode_z_ticketu(nazwa, ticket)?;
    let d = Drukarka::otworz(nazwa)?;
    let wn = w(nazwa);
    unsafe {
        let n = DocumentPropertiesW(Some(hwnd), d.0, PCWSTR(wn.as_ptr()), None, None, 0);
        if n <= 0 { return Err(format!("Sterownik „{nazwa}” nie otworzył ustawień")); }
        let mut wyj = vec![0u8; (n as usize).max(wej.len())];
        let r = DocumentPropertiesW(Some(hwnd), d.0, PCWSTR(wn.as_ptr()),
            Some(wyj.as_mut_ptr() as *mut DEVMODEW), Some(wej.as_ptr() as *const DEVMODEW),
            DM_IN_PROMPT | DM_IN_BUFFER | DM_OUT_BUFFER);
        match r {
            1 => ticket_z_devmode(nazwa, &wyj), // IDOK
            2 => Ok(ticket.to_string()),        // IDCANCEL
            _ => Err(format!("Sterownik „{nazwa}” zgłosił błąd okna ustawień ({r})")),
        }
    }
}

/// COM dla bieżącego wątku: dostawca PrintTicket (PT*) korzysta z COM, a wątki
/// puli Tauri/tokio go nie inicjalizują (przegląd 19.11.2026, I1).
pub struct Com(bool);
impl Com {
    pub fn init() -> Self {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        // S_OK / S_FALSE → trzeba zrównoważyć CoUninitialize; RPC_E_CHANGED_MODE → wątek ma już STA.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Com(hr.is_ok())
    }
}
impl Drop for Com {
    fn drop(&mut self) { if self.0 { unsafe { windows::Win32::System::Com::CoUninitialize() } } }
}

struct Kontekst(windows::Win32::Graphics::Gdi::HDC);
impl Drop for Kontekst { fn drop(&mut self) { unsafe { let _ = DeleteDC(self.0); } } }

/// Rozpoczęte zadanie druku: bez `zakoncz()` Drop woła AbortDoc — błąd w połowie
/// nie wysyła drukarce części dokumentu (przegląd I5).
struct Zadanie { hdc: windows::Win32::Graphics::Gdi::HDC, gotowe: bool }
impl Zadanie {
    fn zakoncz(mut self) -> Result<(), String> {
        self.gotowe = true;
        if unsafe { EndDoc(self.hdc) } <= 0 { return Err("Drukarka nie zakończyła zadania".into()); }
        Ok(())
    }
}
impl Drop for Zadanie {
    fn drop(&mut self) { if !self.gotowe { unsafe { let _ = windows::Win32::Storage::Xps::AbortDoc(self.hdc); } } }
}

/// Kilka funkcji pdfium.dll wołanych wprost: `FPDF_RenderPage` rysuje stronę
/// wektorowo na kontekście drukarki w jej pełnej rozdzielczości (bitmapa
/// 300 dpi dawała ~35 MB na stronę w kolejce wydruku — przegląd I4).
mod pdfium {
    use std::ffi::{c_char, c_float, c_int, c_void};
    use windows::core::{s, PCWSTR};
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    type Dok = *mut c_void;
    type Str = *mut c_void;
    pub struct Pdfium {
        _lib: HMODULE,
        zaladuj: unsafe extern "C" fn(*const c_void, usize, *const c_char) -> Dok,
        stron: unsafe extern "C" fn(Dok) -> c_int,
        strona: unsafe extern "C" fn(Dok, c_int) -> Str,
        szer: unsafe extern "C" fn(Str) -> c_float,
        wys: unsafe extern "C" fn(Str) -> c_float,
        rysuj: unsafe extern "C" fn(*mut c_void, Str, c_int, c_int, c_int, c_int, c_int, c_int),
        zamknij_strone: unsafe extern "C" fn(Str),
        zamknij_dok: unsafe extern "C" fn(Dok),
    }
    pub struct Dokument<'a> { p: &'a Pdfium, d: Dok }
    pub struct Strona<'a> { p: &'a Pdfium, s: Str }

    /// FPDF_ANNOT | FPDF_PRINTING
    const FLAGI: c_int = 0x01 | 0x800;

    impl Pdfium {
        pub fn zaladuj(dll: &std::path::Path) -> Result<Self, String> {
            let wn = super::w(&dll.to_string_lossy());
            unsafe {
                let lib = LoadLibraryW(PCWSTR(wn.as_ptr())).map_err(|e| format!("Brak biblioteki PDF (pdfium.dll): {}", e.message()))?;
                macro_rules! f { ($n:expr) => { std::mem::transmute(GetProcAddress(lib, $n).ok_or_else(|| "pdfium.dll: brak funkcji".to_string())?) } }
                let init: unsafe extern "C" fn() = f!(s!("FPDF_InitLibrary"));
                init();
                Ok(Self { _lib: lib,
                    zaladuj: f!(s!("FPDF_LoadMemDocument64")), stron: f!(s!("FPDF_GetPageCount")),
                    strona: f!(s!("FPDF_LoadPage")), szer: f!(s!("FPDF_GetPageWidthF")), wys: f!(s!("FPDF_GetPageHeightF")),
                    rysuj: f!(s!("FPDF_RenderPage")), zamknij_strone: f!(s!("FPDF_ClosePage")), zamknij_dok: f!(s!("FPDF_CloseDocument")) })
            }
        }
        /// `pdf` musi żyć dłużej niż dokument (pdfium czyta z bufora).
        pub fn dokument<'a>(&'a self, pdf: &'a [u8]) -> Result<Dokument<'a>, String> {
            let d = unsafe { (self.zaladuj)(pdf.as_ptr() as *const c_void, pdf.len(), std::ptr::null()) };
            if d.is_null() { return Err("Uszkodzony PDF".into()); }
            Ok(Dokument { p: self, d })
        }
    }
    impl<'a> Dokument<'a> {
        pub fn stron(&self) -> u32 { unsafe { (self.p.stron)(self.d) }.max(0) as u32 }
        pub fn strona(&self, i: u32) -> Result<Strona<'a>, String> {
            let s = unsafe { (self.p.strona)(self.d, i as c_int) };
            if s.is_null() { return Err(format!("Nie można odczytać strony {}", i + 1)); }
            Ok(Strona { p: self.p, s })
        }
    }
    impl Drop for Dokument<'_> { fn drop(&mut self) { unsafe { (self.p.zamknij_dok)(self.d) } } }
    impl Strona<'_> {
        pub fn wymiary_pt(&self) -> (f32, f32) { unsafe { ((self.p.szer)(self.s), (self.p.wys)(self.s)) } }
        pub fn rysuj(&self, hdc: windows::Win32::Graphics::Gdi::HDC, x: i32, y: i32, w: i32, h: i32) {
            unsafe { (self.p.rysuj)(hdc.0, self.s, x, y, w, h, 0, FLAGI) }
        }
    }
    impl Drop for Strona<'_> { fn drop(&mut self) { unsafe { (self.p.zamknij_strone)(self.s) } } }
}

/// Druk PDF: ticket → DEVMODE (zasobnik, kolor, dwustronnie… ze sterownika),
/// kopie i skala 100% w DEVMODE, orientacja kartki dobrana do każdej strony,
/// strony rysowane wektorowo 1:1 względem fizycznego marginesu.
pub fn drukuj_pdf(nazwa: &str, pdf: &[u8], ticket: &str, kopie: u32, od: Option<u32>, do_: Option<u32>,
                  tytul: &str, pdfium_dll: &std::path::Path) -> Result<u32, String> {
    use windows::Win32::Graphics::Gdi::{ResetDCW, DM_ORIENTATION, DM_SCALE};
    let mut dm = devmode_z_ticketu(nazwa, ticket)?;
    let pdfium = pdfium::Pdfium::zaladuj(pdfium_dll)?;
    let doc = pdfium.dokument(pdf)?;
    let (a, b) = super::pdf::zakres(doc.stron(), od, do_)?;
    let wn = w(nazwa);
    let wt = w(tytul);
    unsafe {
        let p = dm.as_mut_ptr() as *mut DEVMODEW;
        (*p).Anonymous1.Anonymous1.dmCopies = kopie.clamp(1, 9999) as i16;
        (*p).Anonymous1.Anonymous1.dmScale = 100;
        (*p).dmFields |= DM_COPIES | DM_SCALE | DM_ORIENTATION;
        let pierwsza = doc.strona(a)?.wymiary_pt();
        let mut orient = super::pdf::orientacja(pierwsza.0, pierwsza.1);
        (*p).Anonymous1.Anonymous1.dmOrientation = orient;
        let hdc = CreateDCW(PCWSTR::null(), PCWSTR(wn.as_ptr()), PCWSTR::null(), Some(p as *const DEVMODEW));
        if hdc.is_invalid() { return Err(format!("Nie można rozpocząć druku na „{nazwa}”")); }
        let dc = Kontekst(hdc);
        let di = DOCINFOW { cbSize: std::mem::size_of::<DOCINFOW>() as i32, lpszDocName: PCWSTR(wt.as_ptr()), ..Default::default() };
        if StartDocW(dc.0, &di) <= 0 { return Err(format!("Drukarka „{nazwa}” odrzuciła zadanie")); }
        let zadanie = Zadanie { hdc: dc.0, gotowe: false };
        for i in a..=b {
            let strona = doc.strona(i)?;
            let (wpt, hpt) = strona.wymiary_pt();
            let o = super::pdf::orientacja(wpt, hpt);
            if o != orient {
                // Strona w innej orientacji niż poprzednia (np. kartki palet po WZ) — zmiana przed StartPage.
                orient = o;
                (*p).Anonymous1.Anonymous1.dmOrientation = orient;
                if ResetDCW(dc.0, p as *const DEVMODEW).is_invalid() { return Err("Drukarka nie zmieniła orientacji kartki".into()); }
            }
            let (dpi_x, dpi_y) = (GetDeviceCaps(Some(dc.0), LOGPIXELSX), GetDeviceCaps(Some(dc.0), LOGPIXELSY));
            let (off_x, off_y) = (GetDeviceCaps(Some(dc.0), PHYSICALOFFSETX), GetDeviceCaps(Some(dc.0), PHYSICALOFFSETY));
            let (x, y, wpx, hpx) = super::pdf::umiesc_strone(wpt, hpt, dpi_x, dpi_y, off_x, off_y);
            if StartPage(dc.0) <= 0 { return Err("Drukarka przerwała stronę".into()); }
            strona.rysuj(dc.0, x, y, wpx, hpx);
            if EndPage(dc.0) <= 0 { return Err("Drukarka przerwała stronę".into()); }
        }
        zadanie.zakoncz()?;
        Ok(b - a + 1)
    }
}
