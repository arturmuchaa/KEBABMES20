/**
 * Opcje sterownika po polsku. Sterownik Konica podaje nazwy po angielsku
 * (albo wcale — wtedy mamy tylko identyfikator typu `ns0000:Tray1`).
 * Kolejność: słowa kluczowe Print Schema (psk) → znane frazy → wzorce
 * („Tray 3” → „Zasobnik 3”) → słowo po słowie → nazwa ze sterownika.
 * Zgłoszenie 20.11.2026: „spolszcz wszystkie opcje”.
 */

const PSK = '{http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords}'

/** Słowa kluczowe Print Schema — funkcje i opcje (wspólne dla wszystkich drukarek). */
const SLOWA_PSK: Record<string, string> = {
  // funkcje
  PageInputBin: 'Zasobnik papieru', JobInputBin: 'Zasobnik papieru', DocumentInputBin: 'Zasobnik papieru',
  PageOutputColor: 'Kolor', PageMediaSize: 'Rozmiar papieru', PageMediaType: 'Rodzaj papieru', PageMediaColor: 'Kolor papieru',
  JobDuplexAllDocumentsContiguously: 'Druk dwustronny', DocumentDuplex: 'Druk dwustronny',
  PageOrientation: 'Orientacja', PageResolution: 'Rozdzielczość', PageOutputQuality: 'Jakość druku',
  JobCollateAllDocuments: 'Sortowanie kopii', DocumentCollate: 'Sortowanie kopii',
  JobNUpAllDocumentsContiguously: 'Stron na arkusz', DocumentNUp: 'Stron na arkusz', PagesPerSheet: 'Stron na arkusz',
  JobStapleAllDocuments: 'Zszywanie', DocumentStaple: 'Zszywanie', JobHolePunch: 'Dziurkowanie', DocumentHolePunch: 'Dziurkowanie',
  JobOutputBin: 'Taca odbiorcza', PageOutputBin: 'Taca odbiorcza', DocumentOutputBin: 'Taca odbiorcza',
  JobBindAllDocuments: 'Oprawa', DocumentBinding: 'Oprawa', JobPageOrder: 'Kolejność stron', PageBorderless: 'Bez marginesów',
  PageMirrorImage: 'Odbicie lustrzane', PageNegativeImage: 'Negatyw', PageColorManagement: 'Zarządzanie kolorem',
  PageICMRenderingIntent: 'Odwzorowanie kolorów', PageTrueTypeFontMode: 'Czcionki TrueType', PageDeviceFontSubstitution: 'Zastępowanie czcionek',
  PagePhotoPrintingIntent: 'Druk zdjęć', JobAccountingSheet: 'Arkusz rozliczeniowy', JobErrorSheet: 'Arkusz błędów',
  JobDeviceLanguage: 'Język drukarki', JobCoverSheet: 'Okładka', DocumentCoverFront: 'Okładka przednia', DocumentCoverBack: 'Okładka tylna',
  DocumentBannerSheet: 'Strona tytułowa', PageWatermark: 'Znak wodny', PagePoster: 'Plakat', PageRotate180: 'Obrót o 180°',
  PageForceFrontSide: 'Zawsze na przedniej stronie', PageBlackGenerationProcessing: 'Generowanie czerni',
  JobRollCutAtEndOfJob: 'Cięcie po zadaniu', PageScaling: 'Skalowanie', JobCopiesAllDocuments: 'Kopie',
  DocumentSeparatorSheet: 'Kartka rozdzielająca', JobOffset: 'Przesunięcie kopii', PageSourceColorProfile: 'Profil koloru',
  // opcje
  AutoSelect: 'Wybór automatyczny', Manual: 'Podajnik ręczny', ManualFeed: 'Podajnik ręczny', Cassette: 'Kaseta',
  Upper: 'Górny', Middle: 'Środkowy', Lower: 'Dolny', LargeCapacity: 'Podajnik dużej pojemności', Envelope: 'Koperta', Tractor: 'Traktor',
  Color: 'Kolorowo', Grayscale: 'Skala szarości', Monochrome: 'Czarno-biało',
  OneSided: 'Jednostronnie', TwoSidedLongEdge: 'Dwustronnie (długa krawędź)', TwoSidedShortEdge: 'Dwustronnie (krótka krawędź)',
  Portrait: 'Pionowo', Landscape: 'Poziomo', ReversePortrait: 'Pionowo odwrócona', ReverseLandscape: 'Poziomo odwrócona',
  None: 'Brak', On: 'Włączone', Off: 'Wyłączone', Automatic: 'Automatycznie',
  Plain: 'Zwykły', Photographic: 'Fotograficzny', PhotographicGlossy: 'Fotograficzny błyszczący', PhotographicMatte: 'Fotograficzny matowy',
  Transparency: 'Folia', CardStock: 'Karton', Cardstock: 'Karton', Labels: 'Etykiety', Bond: 'Papier dokumentowy', Letterhead: 'Papier firmowy',
  Stationery: 'Papier firmowy', Recycled: 'Z recyklingu', Prepunched: 'Dziurkowany', Preprinted: 'Z nadrukiem', Archival: 'Archiwalny',
  Thick: 'Gruby', Thin: 'Cienki', Continuous: 'Ciągły', TabStockFull: 'Przekładki', TabStockPreCut: 'Przekładki wycinane', Screen: 'Ekran',
  Draft: 'Robocza', Normal: 'Normalna', High: 'Wysoka', Text: 'Tekst', Graphics: 'Grafika', Fax: 'Faks',
  Collated: 'Posortowane', Uncollated: 'Nieposortowane', FrontToBack: 'Od pierwszej', BackToFront: 'Od ostatniej',
  StapleTopLeft: 'Zszywka w lewym górnym rogu', StapleTopRight: 'Zszywka w prawym górnym rogu',
  StapleBottomLeft: 'Zszywka w lewym dolnym rogu', StapleBottomRight: 'Zszywka w prawym dolnym rogu',
  StapleDualLeft: 'Dwie zszywki z lewej', StapleDualRight: 'Dwie zszywki z prawej', StapleDualTop: 'Dwie zszywki u góry',
  StapleDualBottom: 'Dwie zszywki u dołu', SaddleStitch: 'Zszywanie grzbietowe',
  NorthAmericaLetter: 'Letter', NorthAmericaLegal: 'Legal', NorthAmericaExecutive: 'Executive', NorthAmericaTabloid: 'Tabloid',
  CustomMediaSize: 'Własny rozmiar', ISODLEnvelope: 'Koperta DL', ISOC5Envelope: 'Koperta C5', ISOC4Envelope: 'Koperta C4',
  ISOC6Envelope: 'Koperta C6', JISB4: 'B4 (JIS)', JISB5: 'B5 (JIS)', JapanHagakiPostcard: 'Pocztówka',
  ShortEdgeFirst: 'Krótszą krawędzią', LongEdgeFirst: 'Dłuższą krawędzią', BindLeft: 'Oprawa z lewej', BindTop: 'Oprawa u góry',
  BindRight: 'Oprawa z prawej', BindBottom: 'Oprawa u dołu', Booklet: 'Broszura', Perceptual: 'Percepcyjne', Saturation: 'Nasycenie',
  RelativeColorimetric: 'Kolorymetryczne względne', AbsoluteColorimetric: 'Kolorymetryczne bezwzględne', Business: 'Biurowe', Picture: 'Zdjęcia',
}

/** Frazy z nazw sterownika (angielskie), małymi literami. */
const FRAZY: Record<string, string> = {
  'paper source': 'Zasobnik papieru', 'paper tray': 'Zasobnik papieru', 'input tray': 'Zasobnik papieru', 'input bin': 'Zasobnik papieru',
  'bypass tray': 'Taca boczna (ręczna)', 'bypass': 'Taca boczna (ręczna)', 'manual feed': 'Podajnik ręczny', 'manual feed tray': 'Podajnik ręczny',
  'auto': 'Automatycznie', 'auto select': 'Wybór automatyczny', 'automatically select': 'Wybór automatyczny', 'auto tray select': 'Wybór automatyczny',
  'lct': 'Podajnik dużej pojemności', 'large capacity tray': 'Podajnik dużej pojemności', 'large capacity unit': 'Podajnik dużej pojemności',
  'output tray': 'Taca odbiorcza', 'output bin': 'Taca odbiorcza', 'paper size': 'Rozmiar papieru', 'original size': 'Rozmiar oryginału',
  'paper type': 'Rodzaj papieru', 'media type': 'Rodzaj papieru', 'plain paper': 'Zwykły', 'plain': 'Zwykły', 'fine paper': 'Papier wysokiej jakości',
  'thin paper': 'Cienki', 'thick paper': 'Gruby', 'recycled paper': 'Z recyklingu', 'colored paper': 'Kolorowy', 'colour paper': 'Kolorowy',
  'color paper': 'Kolorowy', 'colored': 'Kolorowy', 'label sheet': 'Etykiety', 'labels': 'Etykiety', 'letterhead': 'Papier firmowy',
  'transparency': 'Folia', 'ohp': 'Folia', 'envelope': 'Koperta', 'postcard': 'Pocztówka', 'glossy': 'Błyszczący', 'user paper': 'Papier użytkownika',
  'single side only': 'Tylko jednostronnie', 'single-sided': 'Jednostronnie', '1-sided': 'Jednostronnie', '2-sided': 'Dwustronnie',
  'one sided': 'Jednostronnie', 'two sided': 'Dwustronnie', 'duplex': 'Druk dwustronny', 'print type': 'Druk jedno-/dwustronny',
  'color': 'Kolor', 'colour': 'Kolor', 'select color': 'Kolor', 'full color': 'Kolorowo', 'auto color': 'Kolor automatycznie',
  'gray scale': 'Skala szarości', 'grayscale': 'Skala szarości', 'black and white': 'Czarno-biało', 'black': 'Czarny', 'mono': 'Czarno-biało',
  'resolution': 'Rozdzielczość', 'orientation': 'Orientacja', 'original orientation': 'Orientacja oryginału', 'portrait': 'Pionowo', 'landscape': 'Poziomo',
  'staple': 'Zszywanie', 'staples': 'Zszywanie', 'corner': 'W rogu', '1 staple (corner)': 'Jedna zszywka w rogu', '2 staples': 'Dwie zszywki',
  'center staple and fold': 'Zszycie i złożenie na pół', 'punch': 'Dziurkowanie', '2 holes': '2 otwory', '3 holes': '3 otwory', '4 holes': '4 otwory',
  'fold': 'Składanie', 'half-fold': 'Złożenie na pół', 'half fold': 'Złożenie na pół', 'tri-fold': 'Złożenie na trzy', 'z-fold': 'Składanie Z',
  'finishing': 'Wykończenie', 'binding position': 'Miejsce oprawy', 'left bind': 'Oprawa z lewej', 'top bind': 'Oprawa u góry',
  'right bind': 'Oprawa z prawej', 'auto bind': 'Oprawa automatycznie', 'booklet': 'Broszura', 'combination': 'Strony na arkusz',
  'n-up': 'Stron na arkusz', 'pages per sheet': 'Stron na arkusz', 'sort': 'Sortuj', 'group': 'Grupuj', 'offset': 'Przesunięcie kopii',
  'collate': 'Sortowanie kopii', 'collated': 'Posortowane', 'uncollated': 'Nieposortowane',
  'secure print': 'Wydruk zabezpieczony', 'proof print': 'Wydruk próbny', 'save in user box': 'Zapisz w skrzynce', 'account track': 'Śledzenie kont',
  'user authentication': 'Uwierzytelnianie użytkownika', 'authentication': 'Uwierzytelnianie', 'output method': 'Sposób wydruku', 'print': 'Drukuj',
  'toner save': 'Oszczędzanie toneru', 'toner saving': 'Oszczędzanie toneru', 'edge enhancement': 'Wyostrzanie krawędzi', 'glossy mode': 'Tryb połysku',
  'image compression': 'Kompresja obrazu', 'quality': 'Jakość', 'print quality': 'Jakość druku', 'high quality': 'Wysoka jakość', 'high speed': 'Szybko',
  'watermark': 'Znak wodny', 'overlay': 'Nakładka', 'date/time': 'Data i godzina', 'page number': 'Numer strony', 'header/footer': 'Nagłówek i stopka',
  'copy security': 'Zabezpieczenie przed kopiowaniem', 'front cover': 'Okładka przednia', 'back cover': 'Okładka tylna', 'chapter': 'Rozdziały',
  'per page setting': 'Ustawienia dla stron', 'transparency interleave': 'Przekładki do folii', 'blank page print': 'Drukuj puste strony',
  'skip blank pages': 'Pomiń puste strony', 'rotate 180': 'Obrót o 180°', 'rotate 180 degrees': 'Obrót o 180°', 'zoom': 'Powiększenie',
  'fit to paper': 'Dopasuj do papieru', 'printer default': 'Domyślne drukarki', 'printer setting': 'Ustawienie drukarki', 'default': 'Domyślne',
  'none': 'Brak', 'off': 'Wyłączone', 'on': 'Włączone', 'yes': 'Tak', 'no': 'Nie', 'enable': 'Włączone', 'disable': 'Wyłączone',
  'normal': 'Normalna', 'high': 'Wysoka', 'low': 'Niska', 'standard': 'Standardowa', 'custom': 'Własne', 'custom size': 'Własny rozmiar',
  'text': 'Tekst', 'photo': 'Zdjęcie', 'graphics': 'Grafika', 'draft': 'Robocza', 'fine': 'Dokładna', 'gloss': 'Połysk',
  'paper': 'Papier', 'tray': 'Zasobnik', 'copies': 'Kopie', 'layout': 'Układ', 'cover': 'Okładka', 'cover mode': 'Okładka',
}

/** Wzorce z numerem: „Tray 3”, „Thick 1 (106-163g/m2)”, „Res600”. */
const WZORCE: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^tray\s*(\d+)$/i, m => `Zasobnik ${m[1]}`],
  [/^thick\s*(\d+)(.*)$/i, m => `Gruby ${m[1]}${m[2]}`],
  [/^thin\s*(\d+)(.*)$/i, m => `Cienki ${m[1]}${m[2]}`],
  [/^res\s*(\d+)$/i, m => `${m[1]} dpi`],
  [/^(\d+)\s*x\s*(\d+)\s*dpi$/i, m => `${m[1]} × ${m[2]} dpi`],
  [/^(\d+)\s*dpi$/i, m => `${m[1]} dpi`],
  [/^(\d+)\s*-?\s*up$/i, m => `${m[1]} na arkusz`],
  [/^(\d+)\s*holes?$/i, m => `${m[1]} otwory`],
  [/^ISO\s*A(\d+)$/i, m => `A${m[1]}`],
  [/^ISO\s*B(\d+)$/i, m => `B${m[1]} (ISO)`],
  [/^A(\d)$/i, m => `A${m[1]}`],
]

const lokalna = (id: string) => id.slice(id.lastIndexOf('}') + 1)
const klucz = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
/** „StapleCorner” → „staple corner”, „Tray1” → „tray 1”. */
const rozbij = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Za-z])/g, '$1 $2').replace(/[_-]+/g, ' ')

function zFrazy(tekst: string): string | null {
  const k = klucz(tekst)
  if (!k) return null
  if (FRAZY[k]) return FRAZY[k]
  for (const [w, f] of WZORCE) { const m = k.match(w) ?? tekst.trim().match(w); if (m) return f(m) }
  // Słowo po słowie — tylko gdy znamy KAŻDE słowo (inaczej pół angielskiego, pół polskiego).
  const slowa = k.split(' ')
  if (slowa.length > 1 && slowa.every(s => FRAZY[s] || /^\d+$/.test(s))) {
    const t = slowa.map(s => FRAZY[s] ?? s).join(' ').toLowerCase()
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  return null
}

/** Nazwa funkcji albo opcji po polsku. `id` w zapisie Clarka, `nazwa` — co podał sterownik. */
export function poPolsku(id: string, nazwa: string): string {
  const lok = lokalna(id)
  if (id.startsWith(PSK)) {
    if (SLOWA_PSK[lok]) return SLOWA_PSK[lok]
    const iso = lok.match(/^ISOA(\d+)$/) ?? lok.match(/^ISOB(\d+)$/)
    if (iso) return lok.startsWith('ISOA') ? `A${iso[1]}` : `B${iso[1]} (ISO)`
  }
  // Nazwa ze sterownika (gdy różna od identyfikatora), potem sam identyfikator.
  return zFrazy(nazwa) ?? zFrazy(rozbij(lok)) ?? nazwa
}
