/**
 * Opis błędu skanu sztuki dla operatora — wspólny dla okna skanu pozycji
 * (`ScanPanel`) i paska skanera na głównym ekranie.
 *
 * Co zrobić, zależy od powodu: dubel już jest na magazynie, sztuka z obcej
 * pozycji/planu ma być odłożona, odmowa serwera (4xx) znaczy, że sztuka NIE
 * weszła, a brak odpowiedzi albo 5xx daje wynik NIEPEWNY — wtedy nie wolno
 * mówić „nie zapisano". Nic nie jest ponawiane automatycznie.
 */

/** Sztuka z cudzej pozycji — serwer podaje, z której („Ta sztuka jest z pozycji 2 (KIRMIZI)"). */
export const czyObcaPozycja = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return t.includes('z pozycji') || t.includes('innej pozycji')
}
/** Sztuka z innego planu (skan z głównego ekranu, `expected_plan_id`). */
export const czyObcyPlan = (e: any): boolean =>
  String(e?.message ?? '').toLowerCase().includes('innego planu')
/** Dubel poznajemy PO TREŚCI, nie po kodzie 409 — obca pozycja też jest 409. */
export const czyDubel = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return t.includes('duplikat') || t.includes('already') || t.includes('zeskanowan')
}
/** Serwer odpowiedział odmową (4xx) — wtedy wiadomo, że sztuka nie weszła.
 *  Brak odpowiedzi (sieć, przerwane połączenie) albo 5xx: wynik niepewny. */
export const czyOdmowa = (e: any): boolean => {
  const s = Number(e?.status ?? 0)
  return s >= 400 && s < 500
}

export interface OpisBledu { tytul: string; tekst: string; niepewny: boolean }

export function opiszBladSkanu(e: any): OpisBledu {
  if (czyObcyPlan(e)) return { tytul: 'Sztuka z innego planu — odłóż ją', tekst: e?.message || '', niepewny: false }
  if (czyObcaPozycja(e)) return { tytul: 'Sztuka z innej pozycji — odłóż ją', tekst: e?.message || '', niepewny: false }
  if (czyDubel(e)) return { tytul: 'Ta sztuka jest już zeskanowana', tekst: 'Drugi raz nie wchodzi na magazyn.', niepewny: false }
  if (czyOdmowa(e)) return { tytul: 'Nie weszła', tekst: e?.message || 'Nie udało się zeskanować', niepewny: false }
  // Bez odpowiedzi serwera NIE wiemy, czy zapis doszedł — ponowny skan
  // zapisanej sztuki odbije się jako dubel.
  return {
    tytul: 'Błąd połączenia — wynik niepewny',
    tekst: `${e?.message || 'Brak odpowiedzi serwera'} — sprawdź licznik pozycji; ponowny skan już zapisanej sztuki pokaże dubel.`,
    niepewny: true,
  }
}
