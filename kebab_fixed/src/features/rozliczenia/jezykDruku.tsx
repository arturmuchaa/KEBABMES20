/**
 * Dokumenty dla klienta w DWÓCH językach na jednej kartce — polski i język
 * klienta (jak HDI): język z kartoteki klienta, a gdy pusty — z prefiksu NIP
 * (DE/AT → niemiecki, SK, CZ, SI, FR; inny zagraniczny → angielski).
 * Klient polski dostaje dokument tylko po polsku.
 *
 * Polski tekst zawsze pierwszy i pełnym tuszem; drugi język obok albo pod
 * spodem, lżejszy — kartka zostaje czytelna dla biura i dla odbiorcy.
 */
import type { CSSProperties, ReactNode } from 'react'

export type Jezyk = 'pl' | 'de' | 'en' | 'sk' | 'cs' | 'sl' | 'fr'
const OBCE = ['de', 'en', 'sk', 'cs', 'sl', 'fr'] as const
type Obcy = typeof OBCE[number]

export const NAZWA_JEZYKA: Record<Jezyk, string> = {
  pl: 'polski', de: 'niemiecki', en: 'angielski', sk: 'słowacki', cs: 'czeski', sl: 'słoweński', fr: 'francuski',
}

const KRAJ_JEZYK: Record<string, Jezyk> = { PL: 'pl', DE: 'de', AT: 'de', SK: 'sk', CZ: 'cs', SI: 'sl', FR: 'fr' }

/** Język wg prefiksu NIP — ta sama reguła co `lang_from_nip` na serwerze (HDI). */
export function jezykZNip(nip: string | null | undefined): Jezyk {
  const s = (nip ?? '').trim().toUpperCase()
  const cc = /^[A-Z]{2}/.test(s) ? s.slice(0, 2) : ''
  if (!cc) return 'pl'
  return KRAJ_JEZYK[cc] ?? 'en'
}

/** Język z kartoteki (gdy znany), inaczej z NIP. Nieznany kod → polski. */
export function jezykKlienta(jezyk: string | null | undefined, nip?: string | null): Jezyk {
  const j = (jezyk ?? '').trim().toLowerCase()
  if (j === 'pl' || (OBCE as readonly string[]).includes(j)) return j as Jezyk
  return jezykZNip(nip)
}

type Wpis = { pl: string } & Record<Obcy, string>
const w = (pl: string, de: string, en: string, sk: string, cs: string, sl: string, fr: string): Wpis => ({ pl, de, en, sk, cs, sl, fr })

/** `{d}` w tekście = data (albo inna wartość) wstawiana przy druku. */
export const TEKSTY = {
  // ── wspólne ──
  nabywca: w('Nabywca', 'Käufer', 'Buyer', 'Kupujúci', 'Kupující', 'Kupec', 'Acheteur'),
  odbiorca: w('Odbiorca', 'Kunde', 'Customer', 'Odberateľ', 'Odběratel', 'Kupec', 'Client'),
  nip: w('NIP', 'USt-IdNr.', 'VAT ID', 'IČ DPH', 'DIČ', 'ID za DDV', 'N° TVA'),
  waluta: w('Waluta', 'Währung', 'Currency', 'Mena', 'Měna', 'Valuta', 'Devise'),
  stan_na: w('Stan na dzień', 'Stand vom', 'As of', 'Stav ku dňu', 'Stav ke dni', 'Stanje na dan', 'Situation au'),
  okres: w('Okres', 'Zeitraum', 'Period', 'Obdobie', 'Období', 'Obdobje', 'Période'),
  wydrukowano: w('Wydrukowano', 'Gedruckt', 'Printed', 'Vytlačené', 'Vytištěno', 'Natisnjeno', 'Imprimé le'),
  razem: w('Razem', 'Gesamt', 'Total', 'Spolu', 'Celkem', 'Skupaj', 'Total'),
  // ── zestawienie należności ──
  t_zestawienie: w('Zestawienie należności', 'Offene Posten', 'Statement of outstanding balances', 'Prehľad pohľadávok', 'Přehled pohledávek', 'Pregled terjatev', 'Relevé des créances'),
  stan_rozliczen: w('Stan rozliczeń na dzień {d} — dokumenty niezapłacone', 'Kontostand zum {d} — offene Belege', 'Balance as of {d} — unpaid documents',
    'Stav zúčtovania k {d} — neuhradené doklady', 'Stav vyúčtování k {d} — neuhrazené doklady', 'Stanje na dan {d} — neplačani dokumenti', 'Situation au {d} — documents impayés'),
  k_dokument: w('Dokument', 'Beleg', 'Document', 'Doklad', 'Doklad', 'Dokument', 'Document'),
  k_data_wyst: w('Data wystawienia', 'Ausstellungsdatum', 'Issue date', 'Dátum vystavenia', 'Datum vystavení', 'Datum izdaje', 'Date d’émission'),
  k_termin: w('Termin płatności', 'Fälligkeit', 'Due date', 'Dátum splatnosti', 'Datum splatnosti', 'Rok plačila', 'Échéance'),
  k_kwota: w('Kwota', 'Betrag', 'Amount', 'Suma', 'Částka', 'Znesek', 'Montant'),
  k_zaplacono: w('Zapłacono', 'Bezahlt', 'Paid', 'Zaplatené', 'Zaplaceno', 'Plačano', 'Payé'),
  k_pozostalo: w('Pozostało', 'Offen', 'Outstanding', 'Zostáva', 'Zbývá', 'Odprto', 'Reste dû'),
  k_dni: w('Dni po terminie', 'Tage überfällig', 'Days overdue', 'Dni po splatnosti', 'Dnů po splatnosti', 'Dni zamude', 'Jours de retard'),
  ks_wz: w('WZ', 'Lieferscheine', 'Delivery notes', 'Dodacie listy', 'Dodací listy', 'Dobavnice', 'Bons de livraison'),
  ks_fv: w('Faktury', 'Rechnungen', 'Invoices', 'Faktúry', 'Faktury', 'Računi', 'Factures'),
  razem_wz: w('Razem WZ', 'Gesamt Lieferscheine', 'Total delivery notes', 'Spolu dodacie listy', 'Celkem dodací listy', 'Skupaj dobavnice', 'Total bons de livraison'),
  razem_fv: w('Razem faktury', 'Gesamt Rechnungen', 'Total invoices', 'Spolu faktúry', 'Celkem faktury', 'Skupaj računi', 'Total factures'),
  ten_dokument: w('ten dokument', 'dieser Beleg', 'this document', 'tento doklad', 'tento doklad', 'ta dokument', 'ce document'),
  po_terminie: w('W tym po terminie', 'davon überfällig', 'of which overdue', 'z toho po splatnosti', 'z toho po splatnosti', 'od tega zapadlo', 'dont échu'),
  do_zaplaty: w('Razem do zapłaty', 'Gesamt zu zahlen', 'Total due', 'Spolu na úhradu', 'Celkem k úhradě', 'Skupaj za plačilo', 'Total à payer'),
  do_zaplaty_wszystko: w('Łącznie do zapłaty (wszystkie niezapłacone dokumenty)', 'Gesamt zu zahlen (alle offenen Belege)', 'Total due (all unpaid documents)',
    'Spolu na úhradu (všetky neuhradené doklady)', 'Celkem k úhradě (všechny neuhrazené doklady)', 'Skupaj za plačilo (vsi neplačani dokumenti)', 'Total à payer (tous les documents impayés)'),
  nadplata_wz: w('Nadpłata (WZ)', 'Überzahlung (Lieferscheine)', 'Overpayment (delivery notes)', 'Preplatok (dodacie listy)', 'Přeplatek (dodací listy)', 'Preplačilo (dobavnice)', 'Trop-perçu (bons de livraison)'),
  nadplata_fv: w('Nadpłata (faktury)', 'Überzahlung (Rechnungen)', 'Overpayment (invoices)', 'Preplatok (faktúry)', 'Přeplatek (faktury)', 'Preplačilo (računi)', 'Trop-perçu (factures)'),
  brak_naleznosci: w('Brak należności — dziękujemy', 'Keine offenen Posten — vielen Dank', 'No outstanding balance — thank you', 'Žiadne pohľadávky — ďakujeme', 'Žádné pohledávky — děkujeme', 'Ni odprtih terjatev — hvala', 'Aucun solde dû — merci'),
  wplaty_do: w('Wpłaty zaksięgowane do {d}. Jeżeli zapłacili Państwo w ostatnich dniach, prosimy uznać zestawienie za nieaktualne.',
    'Zahlungen gebucht bis {d}. Falls Sie in den letzten Tagen gezahlt haben, betrachten Sie diese Aufstellung bitte als überholt.',
    'Payments booked up to {d}. If you have paid in the last few days, please disregard this statement.',
    'Platby zaúčtované do {d}. Ak ste v posledných dňoch zaplatili, považujte tento prehľad za neaktuálny.',
    'Platby zaúčtované do {d}. Pokud jste v posledních dnech zaplatili, považujte tento přehled za neaktuální.',
    'Plačila knjižena do {d}. Če ste v zadnjih dneh plačali, tega pregleda ne upoštevajte.',
    'Paiements comptabilisés jusqu’au {d}. Si vous avez payé ces derniers jours, veuillez ne pas tenir compte de ce relevé.'),
  konto_tytul: w('Rachunek do wpłat', 'Bankverbindung', 'Bank account for payments', 'Účet pre platby', 'Účet pro platby', 'Račun za plačila', 'Coordonnées bancaires'),
  konto_numer: w('Nr rachunku', 'IBAN', 'Account no. (IBAN)', 'Číslo účtu (IBAN)', 'Číslo účtu (IBAN)', 'Št. računa (IBAN)', 'IBAN'),
  konto_bank: w('Bank', 'Bank', 'Bank', 'Banka', 'Banka', 'Banka', 'Banque'),
  konto_odbiorca: w('Odbiorca przelewu', 'Zahlungsempfänger', 'Beneficiary', 'Príjemca platby', 'Příjemce platby', 'Prejemnik plačila', 'Bénéficiaire'),
  // ── historia rozliczeń ──
  t_historia: w('Historia rozliczeń', 'Kontoauszug', 'Account statement', 'Výpis zúčtovania', 'Výpis vyúčtování', 'Izpisek prometa', 'Relevé de compte'),
  h_data: w('Data', 'Datum', 'Date', 'Dátum', 'Datum', 'Datum', 'Date'),
  h_opis: w('Opis', 'Beschreibung', 'Description', 'Popis', 'Popis', 'Opis', 'Description'),
  h_obciazenie: w('Obciążenie', 'Belastung', 'Debit', 'Na ťarchu', 'Na vrub', 'Breme', 'Débit'),
  h_wplata: w('Wpłata', 'Zahlung', 'Payment', 'Platba', 'Platba', 'Plačilo', 'Paiement'),
  h_saldo: w('Saldo', 'Saldo', 'Balance', 'Zostatok', 'Zůstatek', 'Stanje', 'Solde'),
  saldo_pocz: w('Saldo na początek okresu', 'Saldo zu Beginn des Zeitraums', 'Opening balance', 'Počiatočný zostatok', 'Počáteční zůstatek', 'Začetno stanje', 'Solde d’ouverture'),
  saldo_kon: w('Saldo na koniec okresu', 'Saldo am Ende des Zeitraums', 'Closing balance', 'Konečný zostatok', 'Konečný zůstatek', 'Končno stanje', 'Solde de clôture'),
  brak_ruchu: w('Brak dokumentów i wpłat w tym okresie.', 'Keine Belege und Zahlungen in diesem Zeitraum.', 'No documents or payments in this period.',
    'V tomto období žiadne doklady ani platby.', 'V tomto období žádné doklady ani platby.', 'V tem obdobju ni dokumentov ali plačil.', 'Aucun document ni paiement sur cette période.'),
  znak_salda: w('Saldo ujemne oznacza kwotę do zapłaty, dodatnie — nadpłatę.', 'Negativer Saldo = zu zahlender Betrag, positiver = Überzahlung.',
    'A negative balance is the amount due; a positive one is an overpayment.', 'Záporný zostatok znamená sumu na úhradu, kladný — preplatok.',
    'Záporný zůstatek znamená částku k úhradě, kladný — přeplatek.', 'Negativno stanje pomeni znesek za plačilo, pozitivno — preplačilo.',
    'Un solde négatif indique le montant dû, un solde positif un trop-perçu.'),
  saldo_wz: w('Saldo WZ', 'Saldo Lieferscheine', 'Delivery notes balance', 'Zostatok – dodacie listy', 'Zůstatek – dodací listy', 'Stanje – dobavnice', 'Solde bons de livraison'),
  saldo_fv: w('Saldo faktur', 'Saldo Rechnungen', 'Invoices balance', 'Zostatok – faktúry', 'Zůstatek – faktury', 'Stanje – računi', 'Solde factures'),
  saldo_lacznie: w('Saldo łącznie na {d}', 'Gesamtsaldo zum {d}', 'Total balance as of {d}', 'Celkový zostatok k {d}', 'Celkový zůstatek k {d}', 'Skupno stanje na dan {d}', 'Solde total au {d}'),
  // ── stan magazynowy dla klienta ──
  t_stan: w('Stan magazynowy', 'Lagerbestand', 'Stock statement', 'Stav skladu', 'Stav skladu', 'Stanje zaloge', 'État du stock'),
  stan_podtytul: w('Wyrób gotowy przygotowany dla odbiorcy', 'Für den Kunden bereitgestellte Fertigware', 'Finished goods held for the customer',
    'Hotové výrobky pripravené pre odberateľa', 'Hotové výrobky připravené pro odběratele', 'Končni izdelki, pripravljeni za kupca', 'Produits finis préparés pour le client'),
  s_lp: w('Lp.', 'Nr.', 'No.', 'Č.', 'Č.', 'Št.', 'N°'),
  s_wyrob: w('Wyrób', 'Produkt', 'Product', 'Výrobok', 'Výrobek', 'Izdelek', 'Produit'),
  s_gramatura: w('Waga szt.', 'Stückgewicht', 'Unit weight', 'Hmotnosť ks', 'Hmotnost ks', 'Teža kosa', 'Poids unitaire'),
  s_opakowanie: w('Opakowanie', 'Verpackung', 'Packaging', 'Balenie', 'Balení', 'Embalaža', 'Emballage'),
  s_sztuk: w('Sztuk', 'Stück', 'Pcs', 'Kusov', 'Kusů', 'Kosov', 'Pièces'),
  s_masa: w('Masa netto', 'Nettogewicht', 'Net weight', 'Čistá hmotnosť', 'Čistá hmotnost', 'Neto teža', 'Poids net'),
  s_partie: w('Partia · data produkcji · szt.', 'Charge · Produktionsdatum · Stk.', 'Batch · production date · pcs', 'Šarža · dátum výroby · ks',
    'Šarže · datum výroby · ks', 'Serija · datum proizvodnje · kos', 'Lot · date de production · pcs'),
  s_pozycji: w('Liczba pozycji', 'Positionen', 'Items', 'Počet položiek', 'Počet položek', 'Število postavk', 'Nombre de lignes'),
  s_razem_szt: w('Razem sztuk', 'Stück gesamt', 'Total pieces', 'Kusov spolu', 'Kusů celkem', 'Skupaj kosov', 'Total pièces'),
  s_razem_kg: w('Razem masa netto', 'Nettogewicht gesamt', 'Total net weight', 'Čistá hmotnosť spolu', 'Čistá hmotnost celkem', 'Skupna neto teža', 'Poids net total'),
  s_brak: w('Brak wyrobu na magazynie dla tego odbiorcy.', 'Kein Lagerbestand für diesen Kunden.', 'No stock held for this customer.',
    'Žiadny tovar na sklade pre tohto odberateľa.', 'Žádné zboží na skladě pro tohoto odběratele.', 'Za tega kupca ni zaloge.', 'Aucun stock pour ce client.'),
  s_stopka: w('Zestawienie informacyjne — nie jest dokumentem wydania towaru.', 'Informative Aufstellung — kein Lieferschein.', 'For information only — not a delivery document.',
    'Informatívny prehľad — nie je dodacím dokladom.', 'Informativní přehled — není dodacím dokladem.', 'Informativni pregled — ni dobavni dokument.', 'Relevé informatif — ne constitue pas un bon de livraison.'),
} as const
export type Klucz = keyof typeof TEKSTY

const wstaw = (t: string, d?: string) => (d === undefined ? t : t.replace('{d}', d))

/** Tekst po polsku. */
export const pl = (k: Klucz, d?: string) => wstaw(TEKSTY[k].pl, d)
/** Tekst w drugim języku; '' gdy klient polski (dokument tylko po polsku). */
export const obcy = (k: Klucz, j: Jezyk, d?: string) => (j === 'pl' ? '' : wstaw(TEKSTY[k][j], d))

export const DRUGI_JEZYK: CSSProperties = { fontWeight: 400, color: '#5d646d', fontSize: '.9em', letterSpacing: 0, textTransform: 'none' }

/**
 * Etykieta w dwóch językach: polski, potem drugi język lżejszym krojem —
 * obok po ukośniku albo (`pod`) w drugiej linii, np. w nagłówkach kolumn.
 */
export function Dw({ k, j, d, pod = false }: { k: Klucz; j: Jezyk; d?: string; pod?: boolean }): ReactNode {
  const o = obcy(k, j, d)
  return <>{pl(k, d)}{o && <span data-drugi-jezyk={j} style={pod ? { ...DRUGI_JEZYK, display: 'block', whiteSpace: 'normal' } : DRUGI_JEZYK}>{pod ? o : ` / ${o}`}</span>}</>
}
