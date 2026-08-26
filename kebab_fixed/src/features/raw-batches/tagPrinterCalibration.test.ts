/**
 * Kalibracja drukarki zawieszek — nastawa jedzie WPROST na drukarkę, więc
 * testujemy głównie to, czego drukarka nie wybaczy: śmieci w liczbach,
 * wartości spoza zakresu i kolejność komend natychmiastowych.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { LABEL_H_MM, LABEL_W_MM, mmToDots } from '@/features/deboning/byproductLabelZpl'
import {
  DEFAULT_CALIBRATION, LABEL_LENGTH_MAX_MM, LABEL_LENGTH_MIN_MM, OFFSET_MAX_MM,
  CALIBRATION_STORAGE_KEY, calibrationTestZpl, clampCalibration, fmtOffsetMm,
  isDefaultCalibration, loadCalibration, saveCalibration, tearOffZpl,
} from './tagPrinterCalibration'

/** Prosty magazyn zamiast localStorage — testy nie zależą od jsdom. */
function magazyn(startowy: Record<string, string> = {}) {
  const dane = { ...startowy }
  return {
    dane,
    getItem: (k: string) => (k in dane ? dane[k] : null),
    setItem: (k: string, v: string) => { dane[k] = v },
  }
}

describe('clampCalibration — na drukarkę nie może pójść śmieć', () => {
  it('wartość spoza zakresu przycina, zamiast wysyłać ją drukarce', () => {
    const c = clampCalibration({ offsetXMm: 40, offsetYMm: -40 })
    expect(c.offsetXMm).toBe(OFFSET_MAX_MM)
    expect(c.offsetYMm).toBe(-OFFSET_MAX_MM)
  })

  it('NaN i tekst zastępuje domyślną — `^FO` z NaN drukarka odrzuca w całości', () => {
    const c = clampCalibration({ offsetXMm: Number.NaN, labelLengthMm: 'osiemdziesiąt' as never })
    expect(c.offsetXMm).toBe(0)
    expect(c.labelLengthMm).toBe(DEFAULT_CALIBRATION.labelLengthMm)
  })

  it('skok taśmy trzyma w granicach rolki zawieszek', () => {
    expect(clampCalibration({ labelLengthMm: 5 }).labelLengthMm).toBe(LABEL_LENGTH_MIN_MM)
    expect(clampCalibration({ labelLengthMm: 500 }).labelLengthMm).toBe(LABEL_LENGTH_MAX_MM)
  })

  it('zaokrągla do dziesiątej milimetra — drobniej i tak nie da się ustawić', () => {
    expect(clampCalibration({ offsetXMm: 1.234 }).offsetXMm).toBe(1.2)
  })

  it('brak nastawy to nastawa domyślna, a nie pusty obiekt', () => {
    expect(clampCalibration(null)).toEqual(DEFAULT_CALIBRATION)
    expect(isDefaultCalibration(clampCalibration(undefined))).toBe(true)
  })
})

describe('pamięć stanowiska', () => {
  let store = magazyn()
  beforeEach(() => { store = magazyn() })

  it('puste stanowisko startuje z nastawą domyślną', () => {
    expect(loadCalibration(store)).toEqual(DEFAULT_CALIBRATION)
  })

  it('zapisaną nastawę odczytuje z powrotem', () => {
    saveCalibration({ ...DEFAULT_CALIBRATION, offsetYMm: -1.5, tearOffMm: 2 }, store)
    expect(loadCalibration(store)).toMatchObject({ offsetYMm: -1.5, tearOffMm: 2 })
  })

  it('zapisuje wartość PRZYCIĘTĄ, żeby po restarcie nie wróciła spoza zakresu', () => {
    const zapisana = saveCalibration({ ...DEFAULT_CALIBRATION, offsetXMm: 99 }, store)
    expect(zapisana.offsetXMm).toBe(OFFSET_MAX_MM)
    expect(JSON.parse(store.dane[CALIBRATION_STORAGE_KEY]).offsetXMm).toBe(OFFSET_MAX_MM)
  })

  it('uszkodzony wpis nie blokuje druku — wraca nastawa domyślna', () => {
    const zepsuty = magazyn({ [CALIBRATION_STORAGE_KEY]: '{nie-json' })
    expect(loadCalibration(zepsuty)).toEqual(DEFAULT_CALIBRATION)
  })

  it('brak localStorage (kiosk bez pamięci) nie wywraca ekranu', () => {
    expect(loadCalibration(null)).toEqual(DEFAULT_CALIBRATION)
    expect(() => saveCalibration(DEFAULT_CALIBRATION, null)).not.toThrow()
  })
})

describe('tearOffZpl — punkt odrywania przed serią', () => {
  it('`~TA` to komenda natychmiastowa — nie wolno jej zamknąć w formacie', () => {
    const zpl = tearOffZpl(2)
    expect(zpl.startsWith('~TA')).toBe(true)
    expect(zpl).not.toContain('^XA')
  })

  it('wartość zawsze trzycyfrowa — część firmware ignoruje krótszą', () => {
    expect(tearOffZpl(0)).toBe('~TA000')
    expect(tearOffZpl(-1)).toMatch(/^~TA-\d{3}$/)
  })
})

describe('calibrationTestZpl — wydruk, z którego widać, w którą stronę uciekł druk', () => {
  it('rysuje ramkę po krawędzi etykiety', () => {
    expect(calibrationTestZpl()).toContain(`^FO0,0^GB${mmToDots(LABEL_W_MM)},${mmToDots(LABEL_H_MM)},`)
  })

  it('przesuwa ramkę o nastawę — testujemy to, co pójdzie na zawieszki', () => {
    const zpl = calibrationTestZpl({ ...DEFAULT_CALIBRATION, offsetXMm: 2, offsetYMm: 1 })
    expect(zpl).toContain(`^FO${mmToDots(2)},${mmToDots(1)}^GB`)
  })

  it('ujemna nastawa nie tworzy ujemnej współrzędnej — drukarka odrzuca taki format', () => {
    const zpl = calibrationTestZpl({ ...DEFAULT_CALIBRATION, offsetXMm: -3, offsetYMm: -3 })
    expect(zpl).not.toMatch(/\^FO-|,-\d/)
  })

  it('drukuje nastawę na etykiecie — inaczej po trzech próbach nikt nie wie, która to', () => {
    const zpl = calibrationTestZpl({ ...DEFAULT_CALIBRATION, offsetYMm: -1.5 })
    expect(zpl).toContain('Y -1,5 mm')
  })
})

describe('fmtOffsetMm — milimetry ze znakiem, po polsku', () => {
  it('dodatnie ze znakiem plus, ujemne z minusem, przecinek zamiast kropki', () => {
    expect(fmtOffsetMm(1.5)).toBe('+1,5')
    expect(fmtOffsetMm(-1)).toBe('-1')
    expect(fmtOffsetMm(0)).toBe('0')
  })
})

/**
 * Skok taśmy = to, co zmierzyła DRUKARKA (26.08.2026).
 *
 * Wydruk konfiguracyjny GC420t z biura: `LABEL LENGTH 0658` = 82,3 mm, a MES
 * wysyłał `^LL` 80 mm. Te 2,3 mm nadmiaru wypychały punkt odrywania na nagłówek
 * następnej zawieszki — „cięcie w złym miejscu", którego żaden `~TA` nie ruszy,
 * bo to nie jest problem punktu odrywania.
 *
 * 22.08 dołożyłem przycisk „Ustaw skok taśmy z drukarki", ale wymagał, żeby
 * biuro najpierw odczytało ustawienia (a ta drukarka odpowiada tylko wydrukiem
 * konfiguracji) i kliknęło. Nikt nie kliknął, więc naprawa nie zadziałała
 * ani razu. Wartość zmierzona MUSI być domyślna, nie do wyklikania.
 */
describe('skok taśmy — domyślnie to, co ma taśma, a nie wysokość zawieszki', () => {
  it('domyślny skok to zmierzone 82,3 mm, nie 80 mm zawieszki', () => {
    expect(DEFAULT_CALIBRATION.labelLengthMm).toBe(82.3)
  })

  it('stara nastawa 80 mm (nigdy nie ruszana) dostaje zmierzoną wartość', () => {
    const store = magazyn({ [CALIBRATION_STORAGE_KEY]: JSON.stringify(
      { offsetXMm: 0, offsetYMm: 0, labelLengthMm: 80, tearOffMm: 0 }) })
    expect(loadCalibration(store).labelLengthMm).toBe(82.3)
  })

  it('skok USTAWIONY ręcznie zostaje nietknięty — biuro wie lepiej', () => {
    const store = magazyn({ [CALIBRATION_STORAGE_KEY]: JSON.stringify(
      { offsetXMm: 0, offsetYMm: 0, labelLengthMm: 76.5, tearOffMm: 0 }) })
    expect(loadCalibration(store).labelLengthMm).toBe(76.5)
  })

  it('migracja nie rusza pozostałych nastaw', () => {
    const store = magazyn({ [CALIBRATION_STORAGE_KEY]: JSON.stringify(
      { offsetXMm: 1.5, offsetYMm: -2, labelLengthMm: 80, tearOffMm: 3 }) })
    expect(loadCalibration(store)).toEqual({
      offsetXMm: 1.5, offsetYMm: -2, labelLengthMm: 82.3, tearOffMm: 3,
    })
  })
})
