/**
 * Tryb budowy i wspólne teksty — jedno miejsce, żeby każdy ekran mówił to samo.
 *
 * PROBA: build `--mode proba` — kopia bazy (:8090), znaczniki „PRÓBA”, bez druku z QR.
 * Build `--mode produkcja` — prawdziwy serwer zakładu (:8080), działa RÓWNOLEGLE ze starym
 * MES na tej samej bazie (pilot uruchamiania PROTRIMA, od 30.10.2026).
 */
export const PROBA = import.meta.env.MODE === 'proba'
/** Funkcja, której PROTRIMA jeszcze nie przejął — działa w starym MES (oba programy pracują równolegle). */
export const W_STARYM_MES = 'Ta funkcja działa na razie w starym MES — PROTRIMA przejmie ją w kolejnej wersji.'
export const BEZ_DRUKU_ETYKIET = 'Druk etykiet Zebra jest w próbie wyłączony: kopia ma prawdziwe numery palet i kartonów, a numer nadany w kopii produkcja nada później innej palecie.'
/** Druk etykiet Zebra (karton, zawieszki): w próbie wyłączony, w produkcji — na razie stary MES. */
export const DRUK_ETYKIET = PROBA ? BEZ_DRUKU_ETYKIET : 'Druk etykiet Zebra działa na razie w starym MES.'
export const BRAK_W_API = 'Tej informacji nie ma jeszcze w API — wpis w docs/protrima-ui/BRAKI_API.md.'
