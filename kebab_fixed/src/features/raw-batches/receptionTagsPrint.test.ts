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

  it('cała seria idzie JEDNYM zadaniem', () => {
    expect(zadania).toHaveLength(1)
    expect(zadania[0].match(/\^XA/g)).toHaveLength(3)
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
    const formaty = zadania[0].split('^XZ').filter(f => f.includes('^XA'))
    expect(formaty).toHaveLength(3)
    formaty.forEach(f => {
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
