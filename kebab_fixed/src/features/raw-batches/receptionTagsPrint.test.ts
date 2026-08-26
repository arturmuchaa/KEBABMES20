/**
 * Strażnik tego, co strona dokleja do wydruku zawieszek.
 *
 * Obie regresje z 22.08.2026 siedziały właśnie tutaj, nie w układzie etykiety:
 * najpierw wyniesienie `^LL`/`^MNY` poza format (etykiety urwane w 3/4 na
 * GC420t), potem `~TA` wysyłane przed każdą serią (biuro nie mogło ustawić
 * cięcia, bo następny wydruk kasował poprawkę).
 */
import { describe, it, expect } from 'vitest'

import { receptionTagsPrintJobs } from './receptionTagsPrint'
import { DEFAULT_CALIBRATION } from './tagPrinterCalibration'

const TAG = {
  receptionNo: '12/08/2026', supplierName: 'KOKO', batchNo: '471', netKg: 540,
  containers: 36, containerKg: 15, palletIndex: 1, palletCount: 6, batchKg: 3000,
  slaughterDate: '2026-08-04', expiryDate: '2026-08-18', receivedDate: '2026-08-12',
}

describe('receptionTagsPrintJobs — co leci na drukarkę', () => {
  const zadania = receptionTagsPrintJobs([TAG, TAG, TAG], DEFAULT_CALIBRATION)

  it('zadanie na KAŻDĄ zawieszkę — tak druk działał, zanim go ruszyłem', () => {
    expect(zadania).toHaveLength(3)
    zadania.forEach(z => expect(z.match(/\^XA/g)).toHaveLength(1))
  })

  it('NIE rusza punktu odrywania — to nastawa zapisana w drukarce', () => {
    // `~TA` przed każdą serią kasował ustawienie drukarki wartością z ekranu:
    // przy domyślnym zerze każdy wydruk robił `~TA000` i cięcie wracało w złe
    // miejsce, cokolwiek biuro ustawiło.
    expect(zadania.join('\n')).not.toContain('~TA')
  })

  it('NIE odpala kalibracji mediów przy zwykłym druku', () => {
    // `~JC` wypuszcza kilka pustych etykiet i zmienia rejestrację drukarki —
    // to świadoma decyzja operatora, nie efekt uboczny druku zawieszek.
    expect(zadania.join('\n')).not.toContain('~JC')
  })

  it('każdy format niesie własną długość taśmy i szukanie przerwy', () => {
    zadania.forEach(f => {
      expect(f).toContain('^LL')
      expect(f).toContain('^MNY')
    })
  })

  it('nastawa stanowiska dosuwa wydruk w całej serii', () => {
    const z = receptionTagsPrintJobs([TAG, TAG], { ...DEFAULT_CALIBRATION, offsetYMm: 1 })
    const bez = receptionTagsPrintJobs([TAG, TAG], DEFAULT_CALIBRATION)
    expect(z[0]).not.toBe(bez[0])
  })

  it('pusta seria nie wysyła nic — pusty format wypluwa czystą etykietę', () => {
    expect(receptionTagsPrintJobs([], DEFAULT_CALIBRATION)).toEqual([])
  })
})

/**
 * Przerwa między zawieszkami (26.08.2026).
 *
 * Biuro: „całość się drukuje, ale cięcie w złym miejscu" — i tylko przy serii
 * kilku palet, przy pojedynczej zawieszce dobrze.
 *
 * Zadania są osobne od 22.08, ale BrowserPrint oddaje sterowanie w chwili
 * przekazania danych, nie po wydrukowaniu. Sześć zawieszek ląduje w buforze
 * w kilkanaście milisekund, a GC420t drukuje pełny bufor jednym ciągiem:
 * do punktu odrywania dojeżdża dopiero po OSTATNIEJ. Wcześniejsze zatrzymują
 * się tam, gdzie zaczyna się druk następnej — i biuro odrywa je w poprzek.
 *
 * Lekarstwo: poczekać, aż bufor się opróżni. Wtedy drukarka wykonuje dosuw do
 * krawędzi po KAŻDEJ zawieszce, dokładnie jak przy druku pojedynczym.
 */
import { tagPrintDelayMs } from './receptionTagsPrint'

describe('tagPrintDelayMs — ile czekać między zawieszkami', () => {
  it('starcza na wydruk etykiety i dosuw do krawędzi', () => {
    // 80 mm przy ~100 mm/s to 0,8 s druku + dosuw; z zapasem ponad sekunda.
    expect(tagPrintDelayMs(80)).toBeGreaterThanOrEqual(1000)
    expect(tagPrintDelayMs(80)).toBeLessThanOrEqual(2000)
  })

  it('dłuższa etykieta czeka dłużej', () => {
    expect(tagPrintDelayMs(150)).toBeGreaterThan(tagPrintDelayMs(80))
  })

  it('krótka etykieta nie schodzi poniżej sensownego minimum', () => {
    expect(tagPrintDelayMs(20)).toBeGreaterThanOrEqual(600)
  })

  it('bzdurna długość nie zawiesza druku na minutę', () => {
    expect(tagPrintDelayMs(0)).toBeGreaterThanOrEqual(600)
    expect(tagPrintDelayMs(99999)).toBeLessThanOrEqual(3000)
    expect(tagPrintDelayMs(NaN as any)).toBeGreaterThanOrEqual(600)
  })
})
