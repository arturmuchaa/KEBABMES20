import {
  LayoutGrid, ShoppingCart, Building2, Truck, FileText, Wallet, CalendarRange, ClipboardList, BookOpen, Tags,
  Factory, Scissors, Layers, MonitorSmartphone, History, Warehouse, PackageOpen, Beef, Package, Boxes, Archive,
  ShieldCheck, GitBranch, ClipboardCheck, Thermometer, BarChart3, FileBarChart, Calculator, Settings, Users, type LucideIcon,
  Clock, Car, UserCog, SlidersHorizontal, Palette, Handshake,
} from 'lucide-react'

export interface ModuleDef { key: string; label: string; icon: LucideIcon; info?: string[] }
export interface AreaDef { key: string; label: string; icon: LucideIcon; modules: ModuleDef[] }

/**
 * Nawigacja ułożona wzdłuż przepływu zakładu (sprzedaż → plan → produkcja →
 * magazyn → jakość), a nie według typów danych. Obszary są stałe dla każdego
 * zakładu; nazwy etapów (rozbiór, masowanie) to konfiguracja branżowa.
 * Opisy „info" mówią, co dany moduł robi dziś w KEBABMES20.
 */
export const AREAS: AreaDef[] = [
  { key: 'sprzedaz', label: 'Sprzedaż', icon: Handshake, modules: [
    { key: 'zamowienia', label: 'Zamówienia', icon: ShoppingCart },
    { key: 'kontrahenci', label: 'Kontrahenci', icon: Building2, info: ['Kartoteki odbiorców i dostawców', 'Pobieranie danych z GUS i VIES po NIP', 'Grupy kontrahentów i nazwy do WZ'] },
    { key: 'wysylki', label: 'Wysyłki i załadunki', icon: Truck, info: ['Kursy i załadunki skanowane kodem QR', 'Pojazdy, kierowcy, przewoźnicy', 'Wydruk dokumentów dla kierowcy'] },
    { key: 'dokumenty', label: 'Dokumenty WZ, CMR, HDI', icon: FileText, info: ['WZ, CMR z konfiguratorem układu, HDI', 'Podział wysyłki na fakturę i WZ', 'Rejestr wystawionych dokumentów'] },
    { key: 'rozrachunki', label: 'Rozrachunki', icon: Wallet, info: ['Rozrachunki z klientami', 'Saldo pojemników zwrotnych'] },
  ] },
  { key: 'planowanie', label: 'Planowanie', icon: CalendarRange, modules: [
    { key: 'plan-produkcji', label: 'Plan produkcji', icon: ClipboardList, info: ['Plan z importem pozycji zamówień', 'Rezerwacja mięsa przyprawionego z wielu partii', 'Zalecenia produkcyjne'] },
    { key: 'plan-masowania', label: 'Plan masowania', icon: Layers, info: ['Zlecenia masowania z przyrostem masy', 'Alokacja surowca wg FEFO'] },
    { key: 'receptury', label: 'Receptury', icon: BookOpen, info: ['Składniki i komponenty receptur', 'Wydajność i przyrost na 100 kg'] },
    { key: 'katalog', label: 'Katalog wyrobów', icon: Tags, info: ['Rodzaj × receptura × gramatura × opakowanie', 'Szablony etykiet i drukarki Zebra'] },
  ] },
  { key: 'produkcja', label: 'Produkcja', icon: Factory, modules: [
    { key: 'rozbior', label: 'Rozbiór', icon: Scissors, info: ['Panel rozbioru i palety mięsa', 'Statystyki wydajności, kartoteka pracownika', 'Raport HACCP z rozbioru'] },
    { key: 'masowanie', label: 'Masowanie', icon: Layers, info: ['Realizacja zleceń z tabletu', 'Partie M powiązane z surowcem R'] },
    { key: 'realizacja', label: 'Realizacja produkcji', icon: MonitorSmartphone, info: ['Tablet produkcyjny z rozliczeniem na pracownika', 'Potwierdzanie sesji przez biuro', 'Partie P i etykiety'] },
    { key: 'historia-prod', label: 'Historia produkcji', icon: History, info: ['Przebieg sesji, partii i zgłoszeń'] },
  ] },
  { key: 'magazyn', label: 'Magazyn', icon: Warehouse, modules: [
    { key: 'przyjecia', label: 'Przyjęcia surowca', icon: PackageOpen, info: ['Przyjęcie z kontrolą temperatury i HACCP', 'Rejestr przyjęć, przyjęcie DDFiP'] },
    { key: 'surowce', label: 'Surowce', icon: Beef, info: ['Partie surowca, stany i rezerwacje'] },
    { key: 'polprodukty', label: 'Półprodukty', icon: Layers, info: ['Mięso przyprawione po masowaniu', 'Rezerwacje pod plan produkcji'] },
    { key: 'magazyn-wg', label: 'Wyrób gotowy', icon: Package, info: ['Stany z automatycznym łączeniem partii', 'Kartony magazynowe i przydział do zamówień'] },
    { key: 'palety', label: 'Palety i kartony', icon: Boxes, info: ['Stałe numery palet i kartonów', 'Skanowanie pakowania, mroźnia, załadunek'] },
    { key: 'opakowania', label: 'Opakowania i dodatki', icon: Archive, info: ['Tuleje, kartony, przyprawy, dodatki'] },
  ] },
  { key: 'jakosc', label: 'Jakość', icon: ShieldCheck, modules: [
    { key: 'sledzenie', label: 'Śledzenie partii', icon: GitBranch, info: ['Śledzenie w obie strony: surowiec ↔ wyrób', 'Wycofanie partii'] },
    { key: 'haccp', label: 'Kontrole HACCP', icon: ClipboardCheck, info: ['Arkusz kontroli sanitarnej', 'Kontrole przyjęć i podpisy'] },
    { key: 'temperatury', label: 'Rejestr temperatur', icon: Thermometer, info: ['Kontrola temperatury i historia pomiarów'] },
  ] },
  { key: 'analiza', label: 'Analiza', icon: BarChart3, modules: [
    { key: 'raporty', label: 'Raporty', icon: FileBarChart, info: ['Raporty produkcji, rozbioru i partii'] },
    { key: 'analityka', label: 'Analityka', icon: BarChart3, info: ['Wydajności, trendy, porównania okresów'] },
    { key: 'koszty', label: 'Kalkulacja kosztów', icon: Calculator, info: ['Kalkulacja cen wyrobów'] },
  ] },
  { key: 'admin', label: 'Administracja', icon: Settings, modules: [
    { key: 'pracownicy', label: 'Pracownicy', icon: Users, info: ['Kartoteki pracowników'] },
    { key: 'czas-pracy', label: 'Czas pracy i rozliczenia', icon: Clock, info: ['Godziny pracy, rozliczenia, paski'] },
    { key: 'pojazdy', label: 'Pojazdy i przewoźnicy', icon: Car, info: ['Samochody, przewoźnicy, kierowcy'] },
    { key: 'uzytkownicy', label: 'Użytkownicy i uprawnienia', icon: UserCog, info: ['Konta, role, dziennik audytu'] },
    { key: 'ustawienia', label: 'Ustawienia zakładu', icon: SlidersHorizontal, info: ['Dane firmy, numeracje, drukarki'] },
  ] },
]

export const PINNED = ['zamowienia', 'plan-produkcji', 'magazyn-wg', 'wysylki']

export const ALL_MODULES: ModuleDef[] = [
  { key: 'pulpit', label: 'Pulpit', icon: LayoutGrid },
  ...AREAS.flatMap(a => a.modules),
  { key: 'system', label: 'System projektowy', icon: Palette },
]
export const moduleDef = (key: string) => ALL_MODULES.find(m => m.key === key)
export const areaOf = (key: string) => AREAS.find(a => a.modules.some(m => m.key === key))

/**
 * Nawigacja boczna: płaska, bez rozwijania — tylko moduły używane codziennie.
 * Pozostałe są w menu „Narzędzia" i w wyszukiwarce (Ctrl+K).
 */
export const NAV_SECTIONS: Array<{ label: string; keys: string[] }> = [
  { label: 'Sprzedaż', keys: ['zamowienia', 'kontrahenci', 'wysylki', 'dokumenty'] },
  { label: 'Produkcja', keys: ['plan-produkcji', 'rozbior', 'masowanie', 'realizacja', 'receptury'] },
  { label: 'Magazyn', keys: ['przyjecia', 'surowce', 'magazyn-wg', 'palety'] },
  { label: 'Jakość i analiza', keys: ['sledzenie', 'haccp', 'raporty'] },
]
