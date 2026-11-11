/**
 * Dane testowe (fixture) modułu Rozrachunki — surowe odpowiedzi API w kształcie z backendu
 * (`rozliczenia_service.lista` / `karta`), wspólne dla testów modelu, listy i karty.
 * Nazwy i NIP-y wymyślone — żadnych prawdziwych kontrahentów w repozytorium.
 */

/** Odpowiedź `GET /api/rozliczenia` (rozliczenia_service.lista) — wymyśleni kontrahenci (scenariusz z testów backendu), stan na 09.11.2026. */
export const SUROWA_LISTA = {
  start: '2026-11-09',
  podsumowanie: {
    PLN: { naleznosci: 17700, po_terminie: 15300, gotowka_wz: 2400, nadplaty: 350 },
    EUR: { naleznosci: 38447.7, po_terminie: 15689.5, gotowka_wz: 8409.5, nadplaty: 0 },
  },
  kontrahenci: [
    { id: 'c1', nazwa: 'RONDO GRILL', nip: 'HU99000001', waluta: 'EUR', saldo_wz: -8409.5, saldo_fv: -30038.2, saldo: -38447.7,
      po_terminie: 15689.5, najstarsza_dni: 13, najblizszy_termin_dni: 1, stan: 'po_terminie', przypomnienie: true },
    { id: 'c3', nazwa: 'TESTOWA GASTRONOMIA', nip: '000-111-22-33', waluta: 'PLN', saldo_wz: -2400, saldo_fv: -15300, saldo: -17700,
      po_terminie: 15300, najstarsza_dni: 41, najblizszy_termin_dni: null, stan: 'po_terminie', przypomnienie: false },
    { id: 'c4', nazwa: 'BAR PRZYKŁADOWY', nip: '', waluta: 'PLN', saldo_wz: 350, saldo_fv: 0, saldo: 350,
      po_terminie: 0, najstarsza_dni: 0, najblizszy_termin_dni: null, stan: 'nadplata', przypomnienie: false },
    { id: 'c5', nazwa: 'PUNKT WZOROWY', nip: '', waluta: 'PLN', saldo_wz: 0, saldo_fv: 0, saldo: 0,
      po_terminie: 0, najstarsza_dni: 0, najblizszy_termin_dni: null, stan: 'rozliczony', przypomnienie: false },
  ],
  bez_kontrahenta: [{ id: 'd1', numer: 'WZ 07/11', data: '2026-11-07', kwota: 1250.4, waluta: 'PLN', nabywca: 'NABYWCA TESTOWY' }],
  inna_waluta: 2,
}

/** Odpowiedź `GET /api/rozliczenia/klienci/c1` (rozliczenia_service.karta). */
export const SUROWA_KARTA = {
  klient: { id: 'c1', nazwa: 'RONDO GRILL', nip: 'HU99000001', waluta: 'EUR', termin_wz: 0, termin_fv: 7,
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
      forma: 'przelew', uwagi: 'ręczna', zrodlo: 'reczna', otwarcie: false, stan: { kod: 'zaplacony', dni: 2, czesciowo: false },
      zamkniety: '2026-10-20', brak_vat: false }],
  },
  wplaty: [{ id: 'p1', ksiega: 'fv', forma: 'przelew', kwota: 17325, data: '2026-10-20', uwagi: 'tytuł', utworzyl: 'biuro',
    dokument_id: null, przydzialy: [{ numer: 'FV 512/2026', kwota: 17325 }], reszta: 0 }],
  czeka_na_ceny: [{ id: 'w30', numer: 'WZ 30/11', data: '2026-11-09' }],
  inna_waluta: [{ id: 'f9', numer: 'FV 9/2026', data: '2026-11-02', kwota: 500, waluta: 'PLN', rodzaj: 'dokument' }],
  dziennik: [{ id: 'j1', tresc: 'obiecał przelew', przypomnij: '2026-11-12', odhaczono: null, kto: 'biuro', kiedy: '2026-11-09T10:00:00' }],
}

const dok = (d: Record<string, unknown>) => ({
  forma: 'przelew', uwagi: '', zrodlo: 'reczna', otwarcie: false, zamkniety: null, brak_vat: false, ...d,
})

/**
 * Pełna karta RONDO GRILL jak w szkicu (stan na 09.11.2026): księga WZ z saldem otwarcia,
 * cztery faktury, wpłaty obu ksiąg. Najnowsze dokumenty i wpłaty na górze (jak z serwera).
 */
export const SUROWA_KARTA_PELNA = {
  ...SUROWA_KARTA,
  dokumenty: {
    wz: [
      dok({ id: 'w02', numer: 'WZ 02/11', data: '2026-11-03', kwota: 5289.5, zaplacono: 0, zostalo: 5289.5, termin: '2026-11-03',
        forma: 'gotowka', zrodlo: 'mes_wz', stan: { kod: 'po_terminie', dni: 6, czesciowo: false } }),
      SUROWA_KARTA.dokumenty.wz[0],
      dok({ id: 'otwarcie-wz', numer: 'Saldo otwarcia', data: '2026-09-20', kwota: 6300, zaplacono: 6300, zostalo: 0, termin: '2026-09-20',
        forma: 'gotowka', uwagi: 'z Excela', zrodlo: 'otwarcie', otwarcie: true, stan: { kod: 'zaplacony', dni: 30, czesciowo: false },
        zamkniety: '2026-10-20' }),
    ],
    fv: [
      dok({ id: 'f553', numer: 'FV 553/2026', data: '2026-11-08', kwota: 10416, zaplacono: 0, zostalo: 10416, termin: '2026-11-15',
        stan: { kod: 'w_terminie', dni: 6, czesciowo: false } }),
      dok({ id: 'f541', numer: 'FV 541/2026', data: '2026-11-03', kwota: 12342.2, zaplacono: 0, zostalo: 12342.2, termin: '2026-11-10',
        stan: { kod: 'termin_jutro', dni: 1, czesciowo: false } }),
      dok({ id: 'f528', numer: 'FV 528/2026', data: '2026-10-27', kwota: 14280, zaplacono: 7000, zostalo: 7280, termin: '2026-11-03',
        uwagi: 'brakuje 426 €, reklamacja', stan: { kod: 'po_terminie', dni: 6, czesciowo: true } }),
      SUROWA_KARTA.dokumenty.fv[0],
    ],
  },
  wplaty: [
    { id: 'p3', ksiega: 'fv', forma: 'przelew', kwota: 7250, data: '2026-11-05', uwagi: '', utworzyl: 'biuro',
      dokument_id: 'f528', przydzialy: [{ numer: 'FV 528/2026', kwota: 7000 }], reszta: 250 },
    { id: 'p2', ksiega: 'wz', forma: 'gotowka', kwota: 3000, data: '2026-10-28', uwagi: 'zapłacił kierowcy', utworzyl: 'Anna',
      dokument_id: null, przydzialy: [{ numer: 'WZ 21/10', kwota: 3000 }], reszta: 0 },
    ...SUROWA_KARTA.wplaty,
  ],
  dziennik: [
    { id: 'j2', tresc: 'wysłałem zestawienie mailem', przypomnij: null, odhaczono: null, kto: 'Anna', kiedy: '2026-11-08T14:00:00' },
    { id: 'j3', tresc: 'zadzwonić o FV 528', przypomnij: '2026-11-05', odhaczono: null, kto: 'biuro', kiedy: '2026-11-03T09:00:00' },
    ...SUROWA_KARTA.dziennik,
  ],
}

/** Odpowiedź `GET /api/rozliczenia/dokumenty/f512` (rozliczenia_service.dokument). */
export const SUROWY_DOKUMENT = {
  ...SUROWA_KARTA.dokumenty.fv[0],
  pokrycie: [{ data: '2026-10-20', forma: 'przelew', kwota: 17325, uwagi: 'tytuł' }],
  historia: [{ akcja: 'termin', opis: 'FV 512/2026: termin płatności zmieniona z 2026-10-22 na 2026-10-25',
    przed: { termin: '2026-10-22' }, po: { termin: '2026-10-25' }, powod: 'ustalenie z klientem', kto: 'Anna', kiedy: '2026-10-19T09:30:00' }],
}

/** Odpowiedź `POST /api/rozliczenia/klient/c1/wplaty/podglad` dla 15 000 € do faktur (rozliczenia_service._podglad). */
export const SUROWY_PODGLAD = {
  przydzialy: [
    { dokument_id: 'f528', numer: 'FV 528/2026', kwota: 7280, zostalo_przed: 7280, zostalo_po: 0, zamyka: true },
    { dokument_id: 'f541', numer: 'FV 541/2026', kwota: 7720, zostalo_przed: 12342.2, zostalo_po: 4622.2, zamyka: false },
  ],
  nadwyzka: 0,
}
