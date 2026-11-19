//! Parser PrintCapabilities / PrintTicket (Print Schema Windows) — czysty,
//! bez Win32, testowany na każdym systemie.
//!
//! Identyfikatory funkcji i opcji są w zapisie Clarka `{uri}nazwa`, bo ten sam
//! sterownik w PrintCapabilities pisze `ns0000:Tray1`, a w tickecie `km:Tray1`
//! — prefiks to tylko lokalny skrót przestrzeni nazw.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Opcja {
    pub id: String,
    pub nazwa: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Funkcja {
    pub id: String,
    pub nazwa: String,
    pub opcje: Vec<Opcja>,
    pub wybrana: Option<String>,
}

const PSK: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords";
const PSF: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";

/// Najczęstsze ustawienia — na górze okna, w tej kolejności.
const NA_GORZE: [&str; 6] = ["PageInputBin", "JobInputBin", "PageOutputColor",
    "JobDuplexAllDocumentsContiguously", "PageMediaSize", "PageMediaType"];

/// Element XML z zakresem bajtów w dokumencie (do podmiany w tickecie).
#[derive(Debug, Default)]
struct El {
    name: String,
    attrs: Vec<(String, String)>,
    kids: Vec<El>,
    text: String,
    start: usize,
    end: usize,
}

impl El {
    fn local(&self) -> &str { self.name.rsplit(':').next().unwrap_or(&self.name) }
    fn prefix(&self) -> Option<&str> { self.name.split_once(':').map(|(p, _)| p) }
    fn attr(&self, k: &str) -> Option<&str> { self.attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str()) }
    fn kids_named<'a>(&'a self, local: &'a str) -> impl Iterator<Item = &'a El> + 'a {
        self.kids.iter().filter(move |k| k.local() == local)
    }
}

fn parsuj(xml: &str) -> Result<El, String> {
    use quick_xml::events::{BytesStart, Event};
    use quick_xml::Reader;
    fn el(e: &BytesStart, start: usize) -> Result<El, String> {
        let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
        let mut attrs = Vec::new();
        for a in e.attributes() {
            let a = a.map_err(|x| x.to_string())?;
            let v = a.unescape_value().map_err(|x| x.to_string())?.into_owned();
            attrs.push((String::from_utf8_lossy(a.key.as_ref()).into_owned(), v));
        }
        Ok(El { name, attrs, start, ..Default::default() })
    }
    let mut r = Reader::from_str(xml);
    let mut stos: Vec<El> = Vec::new();
    let mut korzen: Option<El> = None;
    loop {
        let przed = r.buffer_position() as usize;
        let ev = r.read_event().map_err(|e| format!("XML: {e}"))?;
        let po = r.buffer_position() as usize;
        match ev {
            Event::Start(e) => stos.push(el(&e, przed)?),
            Event::Empty(e) => {
                let mut x = el(&e, przed)?;
                x.end = po;
                match stos.last_mut() { Some(p) => p.kids.push(x), None => korzen = Some(x) }
            }
            Event::End(_) => {
                let mut x = stos.pop().ok_or("XML: nadmiarowy znacznik końca")?;
                x.end = po;
                match stos.last_mut() { Some(p) => p.kids.push(x), None => korzen = Some(x) }
            }
            Event::Text(t) => if let Some(p) = stos.last_mut() {
                p.text.push_str(&t.unescape().map_err(|e| e.to_string())?);
            },
            Event::Eof => break,
            _ => {}
        }
    }
    korzen.ok_or_else(|| "XML: pusty dokument".into())
}

/// Przestrzenie nazw zadeklarowane w korzeniu (Print Schema deklaruje je tam).
fn przestrzenie(root: &El) -> Vec<(String, String)> {
    root.attrs.iter().filter_map(|(k, v)| {
        if k == "xmlns" { Some((String::new(), v.clone())) }
        else { k.strip_prefix("xmlns:").map(|p| (p.to_string(), v.clone())) }
    }).collect()
}

fn clark(q: &str, ns: &[(String, String)]) -> String {
    let (p, l) = q.split_once(':').unwrap_or(("", q));
    match ns.iter().find(|(pp, _)| pp == p) {
        Some((_, uri)) => format!("{{{uri}}}{l}"),
        None => q.to_string(),
    }
}

fn rozbij(id: &str) -> (Option<&str>, &str) {
    match id.strip_prefix('{').and_then(|r| r.split_once('}')) {
        Some((uri, l)) => (Some(uri), l),
        None => (None, id),
    }
}

fn nazwa_wyswietlana(e: &El, ns: &[(String, String)]) -> Option<String> {
    let dn = format!("{{{PSK}}}DisplayName");
    e.kids_named("Property")
        .find(|p| p.attr("name").map(|n| clark(n, ns)) == Some(dn.clone()))
        .and_then(|p| p.kids_named("Value").next())
        .map(|v| v.text.trim().to_string())
        .filter(|t| !t.is_empty())
}

pub fn parsuj_mozliwosci(caps_xml: &str, ticket_xml: &str) -> Result<Vec<Funkcja>, String> {
    let caps = parsuj(caps_xml)?;
    let ns_c = przestrzenie(&caps);
    let wybrane: Vec<(String, String)> = match parsuj(ticket_xml) {
        Ok(t) => {
            let ns_t = przestrzenie(&t);
            t.kids_named("Feature").filter_map(|f| {
                let o = f.kids_named("Option").next()?;
                Some((clark(f.attr("name")?, &ns_t), clark(o.attr("name")?, &ns_t)))
            }).collect()
        }
        Err(_) => Vec::new(),
    };
    let skalowanie = format!("{{{PSK}}}PageScaling");
    let mut wynik: Vec<Funkcja> = caps.kids_named("Feature").filter_map(|f| {
        let q = f.attr("name")?;
        let id = clark(q, &ns_c);
        if id == skalowanie { return None; }
        let opcje: Vec<Opcja> = f.kids_named("Option").filter_map(|o| {
            let oq = o.attr("name")?;
            Some(Opcja {
                id: clark(oq, &ns_c),
                nazwa: nazwa_wyswietlana(o, &ns_c).unwrap_or_else(|| rozbij(&clark(oq, &ns_c)).1.to_string()),
            })
        }).collect();
        if opcje.len() < 2 { return None; }
        let wybrana = wybrane.iter().find(|(fid, _)| *fid == id).map(|(_, o)| o.clone())
            .filter(|o| opcje.iter().any(|x| &x.id == o));
        let nazwa = nazwa_wyswietlana(f, &ns_c).unwrap_or_else(|| rozbij(&id).1.to_string());
        Some(Funkcja { id, nazwa, opcje, wybrana })
    }).collect();
    let waga = |f: &Funkcja| {
        let (uri, l) = rozbij(&f.id);
        if uri == Some(PSK) { NA_GORZE.iter().position(|x| *x == l).unwrap_or(99) } else { 99 }
    };
    wynik.sort_by_key(|f| waga(f)); // stabilne — reszta w kolejności sterownika
    Ok(wynik)
}

/// Ticket z wybraną opcją jednej funkcji; pozostałe zostają bez zmian.
pub fn ustaw_opcje(ticket_xml: &str, funkcja_id: &str, opcja_id: &str) -> Result<String, String> {
    let root = parsuj(ticket_xml)?;
    let mut ns = przestrzenie(&root);
    let mut nowe_ns: Vec<(String, String)> = Vec::new();
    let mut q = |id: &str| -> String {
        let (uri, l) = rozbij(id);
        let Some(uri) = uri else { return l.to_string() };
        if let Some((p, _)) = ns.iter().find(|(p, u)| u == uri && !p.is_empty()) { return format!("{p}:{l}"); }
        let mut k = 0;
        let p = loop { let p = format!("ns{k:04}x"); if !ns.iter().any(|(pp, _)| *pp == p) { break p; } k += 1; };
        ns.push((p.clone(), uri.to_string()));
        nowe_ns.push((p.clone(), uri.to_string()));
        format!("{p}:{l}")
    };
    let psf = root.prefix().map(|p| format!("{p}:")).unwrap_or_default();
    let ns_root = przestrzenie(&root);
    let fq = q(funkcja_id);
    let oq = q(opcja_id);
    let opcja = format!("<{psf}Option name=\"{oq}\"/>");
    let mut wynik = ticket_xml.to_string();
    let cel = root.kids_named("Feature").find(|f| f.attr("name").map(|n| clark(n, &ns_root)).as_deref() == Some(funkcja_id));
    match cel {
        Some(f) => match f.kids_named("Option").next() {
            Some(o) => wynik.replace_range(o.start..o.end, &opcja),
            None => {
                let zamk = ticket_xml[..f.end].rfind("</").ok_or("XML: brak zamknięcia funkcji")?;
                wynik.insert_str(zamk, &opcja);
            }
        },
        None => {
            let zamk = ticket_xml.rfind("</").ok_or("XML: brak zamknięcia ticketu")?;
            wynik.insert_str(zamk, &format!("<{psf}Feature name=\"{fq}\">{opcja}</{psf}Feature>"));
        }
    }
    if !nowe_ns.is_empty() {
        let poz = root.start + 1 + root.name.len();
        let dekl: String = nowe_ns.iter().map(|(p, u)| format!(" xmlns:{p}=\"{u}\"")).collect();
        wynik.insert_str(poz, &dekl);
    }
    Ok(wynik)
}

/// Zasobnik na pierwsze uruchomienie: opcja z „1” w nazwie, inaczej pierwsza.
pub fn zasobnik_domyslny(f: &Funkcja) -> Option<String> {
    let jedynka = f.opcje.iter().find(|o| {
        o.nazwa.split(|c: char| !c.is_ascii_digit()).any(|t| t == "1")
    });
    jedynka.or(f.opcje.first()).map(|o| o.id.clone())
}

/// Największa liczba kopii ze sterownika (`psk:JobCopiesAllDocuments`), domyślnie 999.
pub fn kopie_max(caps_xml: &str) -> u32 {
    let Ok(root) = parsuj(caps_xml) else { return 999 };
    let ns = przestrzenie(&root);
    let kopie = format!("{{{PSK}}}JobCopiesAllDocuments");
    let maks = format!("{{{PSF}}}MaxValue");
    let wynik = root.kids_named("ParameterDef")
        .find(|p| p.attr("name").map(|n| clark(n, &ns)) == Some(kopie.clone()))
        .and_then(|p| p.kids_named("Property").find(|x| x.attr("name").map(|n| clark(n, &ns)) == Some(maks.clone())))
        .and_then(|p| p.kids_named("Value").next())
        .and_then(|v| v.text.trim().parse().ok())
        .unwrap_or(999);
    wynik
}

#[cfg(test)]
mod testy {
    use super::*;

    const CAPS: &str = include_str!("../../tests/fixtures/bizhub-capabilities.xml");
    const TICKET: &str = include_str!("../../tests/fixtures/bizhub-ticket.xml");
    const PSK: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords";
    const KM: &str = "http://www.konicaminolta.com/printing/schema";

    fn psk(n: &str) -> String { format!("{{{PSK}}}{n}") }
    fn km(n: &str) -> String { format!("{{{KM}}}{n}") }

    #[test]
    fn zasobniki_maja_nazwy_ze_sterownika() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        let bin = f.iter().find(|x| x.id == psk("PageInputBin")).unwrap();
        assert_eq!(bin.nazwa, "Źródło papieru");
        let nazwy: Vec<_> = bin.opcje.iter().map(|o| o.nazwa.as_str()).collect();
        assert_eq!(nazwy, ["Automatyczny", "Zasobnik 1", "Zasobnik 2", "Zasobnik 3", "Zasobnik 4"]);
        // prefiks w tickecie (km:) inny niż w możliwościach (ns0000:) — ta sama opcja
        assert_eq!(bin.wybrana.as_deref(), Some(km("Tray2").as_str()));
    }

    #[test]
    fn kolejnosc_najczestsze_na_gorze() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        let ids: Vec<_> = f.iter().map(|x| x.id.clone()).collect();
        assert_eq!(ids, [psk("PageInputBin"), psk("PageOutputColor"), psk("JobDuplexAllDocumentsContiguously"),
                         psk("PageMediaSize"), psk("PageMediaType"), km("Staple")]);
    }

    #[test]
    fn pomija_skalowanie_i_jednoopcyjne() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        assert!(f.iter().all(|x| x.id != psk("PageScaling") && x.id != psk("PageResolution")));
    }

    #[test]
    fn opcja_bez_nazwy_pokazuje_nazwe_techniczna() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        let size = f.iter().find(|x| x.id == psk("PageMediaSize")).unwrap();
        assert_eq!(size.opcje[1].nazwa, "ISOA5");
        assert_eq!(size.wybrana.as_deref(), Some(psk("ISOA4").as_str()));
    }

    #[test]
    fn opcja_spoza_listy_daje_none() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        let typ = f.iter().find(|x| x.id == psk("PageMediaType")).unwrap();
        assert_eq!(typ.wybrana, None); // ticket ma km:Glossy, sterownik go nie oferuje
    }

    #[test]
    fn ustaw_opcje_podmienia_tylko_ta_funkcje() {
        let t = ustaw_opcje(TICKET, &psk("PageInputBin"), &km("Tray3")).unwrap();
        let f = parsuj_mozliwosci(CAPS, &t).unwrap();
        let wyb = |id: String| f.iter().find(|x| x.id == id).unwrap().wybrana.clone();
        assert_eq!(wyb(psk("PageInputBin")), Some(km("Tray3")));
        assert_eq!(wyb(psk("PageOutputColor")), Some(psk("Color")));
        assert_eq!(wyb(psk("PageMediaSize")), Some(psk("ISOA4")));
    }

    #[test]
    fn ustaw_opcje_dodaje_brakujaca_funkcje() {
        let t = ustaw_opcje(TICKET, &km("Staple"), &km("StapleCorner")).unwrap();
        let f = parsuj_mozliwosci(CAPS, &t).unwrap();
        let st = f.iter().find(|x| x.id == km("Staple")).unwrap();
        assert_eq!(st.wybrana, Some(km("StapleCorner")));
    }

    #[test]
    fn zasobnik_domyslny_wybiera_z_jedynka() {
        let f = parsuj_mozliwosci(CAPS, TICKET).unwrap();
        let bin = f.iter().find(|x| x.id == psk("PageInputBin")).unwrap();
        assert_eq!(zasobnik_domyslny(bin), Some(km("Tray1")));
        let bez = Funkcja { id: "x".into(), nazwa: "x".into(), wybrana: None,
            opcje: vec![Opcja { id: "a".into(), nazwa: "Górny".into() }, Opcja { id: "b".into(), nazwa: "Dolny".into() }] };
        assert_eq!(zasobnik_domyslny(&bez), Some("a".into()));
    }

    #[test]
    fn kopie_max_z_parametru() {
        assert_eq!(kopie_max(CAPS), 9999);
        assert_eq!(kopie_max("<x/>"), 999);
    }
}
