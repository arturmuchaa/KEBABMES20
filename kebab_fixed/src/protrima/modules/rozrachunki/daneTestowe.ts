/**
 * Dane testowe modułu Rozrachunki — surowe odpowiedzi API w kształcie z backendu
 * (`rozliczenia_service.lista` / `karta`), wspólne dla testów modelu, listy i karty.
 */

/** Odpowiedź `GET /api/rozliczenia` (rozliczenia_service.lista) — dane ROJPAK z testów Task 4, stan na 09.11.2026. */
export const SUROWA_LISTA = {
  start: '2026-11-09',
  podsumowanie: {
    PLN: { naleznosci: 17700, po_terminie: 15300, gotowka_wz: 2400, nadplaty: 350 },
    EUR: { naleznosci: 38447.7, po_terminie: 15689.5, gotowka_wz: 8409.5, nadplaty: 0 },
  },
  kontrahenci: [
    { id: 'c1', nazwa: 'ROJPAK', nip: 'HU25341187', waluta: 'EUR', saldo_wz: -8409.5, saldo_fv: -30038.2, saldo: -38447.7,
      po_terminie: 15689.5, najstarsza_dni: 13, najblizszy_termin_dni: 1, stan: 'po_terminie', przypomnienie: true },
    { id: 'c3', nazwa: 'TRUVA GASTRO', nip: '753-123-45-67', waluta: 'PLN', saldo_wz: -2400, saldo_fv: -15300, saldo: -17700,
      po_terminie: 15300, najstarsza_dni: 41, najblizszy_termin_dni: null, stan: 'po_terminie', przypomnienie: false },
    { id: 'c4', nazwa: 'BOSS KEBAB', nip: '', waluta: 'PLN', saldo_wz: 350, saldo_fv: 0, saldo: 350,
      po_terminie: 0, najstarsza_dni: 0, najblizszy_termin_dni: null, stan: 'nadplata', przypomnienie: false },
    { id: 'c5', nazwa: 'POLAT', nip: '', waluta: 'PLN', saldo_wz: 0, saldo_fv: 0, saldo: 0,
      po_terminie: 0, najstarsza_dni: 0, najblizszy_termin_dni: null, stan: 'rozliczony', przypomnienie: false },
  ],
  bez_kontrahenta: [{ id: 'd1', numer: 'WZ 07/11', data: '2026-11-07', kwota: 1250.4, waluta: 'PLN', nabywca: 'NAZAR' }],
  inna_waluta: 2,
}

/** Odpowiedź `GET /api/rozliczenia/klienci/c1` (rozliczenia_service.karta). */
export const SUROWA_KARTA = {
  klient: { id: 'c1', nazwa: 'ROJPAK', nip: 'HU25341187', waluta: 'EUR', termin_wz: 0, termin_fv: 7,
    forma_wz: 'gotowka', forma_fv: 'przelew', notatka: 'płaci w piątki', waluta_podpowiedz: null },
  start: '2026-10-01',
  saldo: { wz: -8409.5, fv: -30038.2, lacznie: -38447.7, po_terminie_wz: 8409.5, po_terminie_fv: 7280,
    najstarsza_dni_wz: 13, najstarsza_dni_fv: 6 },
  otwarcia: { wz: { kwota: -6300, zalegle_od: '2026-09-20', uwagi: 'z Excela' }, fv: null },
  dokumenty: {
    wz: [{ id: 'w21', numer: 'WZ 21/10', data: '2026-10-27', kwota: 6120, zaplacono: 3000, zostalo: 3120, termin: '2026-10-27',
      forma: 'gotowka', uwagi: '', zrodlo: 'mes_wz', otwarcie: false, stan: { kod: 'po_terminie', dni: 13, czesciowo: true },
      zamkniety: null, brak_vat: true }],
    fv: [{ id: 'f512', numer: 'FV 512/2026', data: '2026-10-18', kwota: 17325, zaplacono: 17325, zostalo: 0, termin: '2026-10-25',
      forma: 'przelew', uwagi: 'ręczna', zrodlo: 'reczny', otwarcie: false, stan: { kod: 'zaplacony', dni: 2, czesciowo: false },
      zamkniety: '2026-10-20', brak_vat: false }],
  },
  wplaty: [{ id: 'p1', ksiega: 'fv', forma: 'przelew', kwota: 17325, data: '2026-10-20', uwagi: 'tytuł', utworzyl: 'biuro',
    dokument_id: null, przydzialy: [{ numer: 'FV 512/2026', kwota: 17325 }], reszta: 0 }],
  czeka_na_ceny: [{ id: 'w30', numer: 'WZ 30/11', data: '2026-11-09' }],
  inna_waluta: [{ id: 'f9', numer: 'FV 9/2026', data: '2026-11-02', kwota: 500, waluta: 'PLN', rodzaj: 'dokument' }],
  dziennik: [{ id: 'j1', tresc: 'obiecał przelew', przypomnij: '2026-11-12', odhaczono: null, kto: 'biuro', kiedy: '2026-11-09T10:00:00' }],
}
