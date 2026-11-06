/**
 * Etapy zakładu — jeden słownik dla „Przebiegu dnia” na Pulpicie i szyny na ekranie logowania.
 * Przegląd wyglądu: logowanie miało inne etapy i nazwy niż Pulpit (Rozbiór, Wyrób gotowy).
 */
export const ETAPY_ZAKLADU = [
  { key: 'przyjecia', name: 'Przyjęcie surowca' },
  { key: 'masowanie', name: 'Masowanie' },
  { key: 'realizacja', name: 'Produkcja' },
  { key: 'magazyn-wg', name: 'Magazyn wyrobu' },
  { key: 'zamowienia', name: 'Zamówienia' },
  { key: 'wysylki', name: 'Wysyłka' },
] as const

export type KluczEtapu = typeof ETAPY_ZAKLADU[number]['key']
export const ETAP = Object.fromEntries(ETAPY_ZAKLADU.map(e => [e.key, e.name])) as Record<KluczEtapu, string>
