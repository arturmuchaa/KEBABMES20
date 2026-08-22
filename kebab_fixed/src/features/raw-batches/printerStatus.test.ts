/**
 * Parser odpowiedzi drukarki. Cała wartość tego kodu to jedna liczba —
 * DŁUGOŚĆ ETYKIETY, jaką drukarka ma u siebie. Jeśli ją źle odczytamy, biuro
 * dostanie pewny siebie komunikat z błędną diagnozą, a to gorsze niż brak
 * odczytu: dokładnie tak straciliśmy 22.08.2026 trzy wydania na zgadywanie.
 */
import { describe, it, expect } from 'vitest'

import { parsePrinterIdentity, parsePrinterStatus, printerSummary } from './printerStatus'

// Prawdziwy kształt odpowiedzi `~HS` (trzy wiersze w ramkach STX/ETX).
const HS = '030,0,0,0639,000,0,0,0,000,0,0,0\r\n'
  + '001,0,0,0,0,2,4,0,00000000,1,000\r\n'
  + '1234,0\r\n'

describe('parsePrinterStatus — długość etykiety z `~HS`', () => {
  it('czyta długość etykiety w punktach i przelicza na milimetry', () => {
    const s = parsePrinterStatus(HS)
    expect(s.labelLengthDots).toBe(639)
    expect(s.labelLengthMm).toBe(80)
  })

  it('krótsza etykieta w drukarce = to, czego szukamy', () => {
    const s = parsePrinterStatus('030,0,0,0478,000,0,0,0,000,0,0,0')
    expect(s.labelLengthDots).toBe(478)
    expect(s.labelLengthMm).toBe(59.8)
  })

  it('wyłapuje brak papieru i pauzę — to też zatrzymuje wydruk', () => {
    const s = parsePrinterStatus('030,1,1,0639,000,0,0,0,000,0,0,0')
    expect(s.paperOut).toBe(true)
    expect(s.paused).toBe(true)
  })

  it('pusta albo obcięta odpowiedź NIE udaje odczytu', () => {
    expect(parsePrinterStatus('').labelLengthDots).toBeNull()
    expect(parsePrinterStatus('030,0').labelLengthDots).toBeNull()
    expect(parsePrinterStatus('cokolwiek').labelLengthDots).toBeNull()
  })

  it('zero punktów to nie jest długość etykiety', () => {
    expect(parsePrinterStatus('030,0,0,0000,000,0,0,0,000,0,0,0').labelLengthMm)
      .toBeNull()
  })
})

describe('parsePrinterIdentity — kto odpowiada', () => {
  it('czyta model i firmware z `~HI`', () => {
    const i = parsePrinterIdentity('GC420t,V61.17.17Z,8,2104KB')
    expect(i.model).toContain('GC420t')
    expect(i.firmware).toBe('V61.17.17Z')
  })

  it('brak odpowiedzi nie wymyśla modelu', () => {
    expect(parsePrinterIdentity('').model).toBe('')
  })
})

describe('printerSummary — zdanie dla biura', () => {
  it('milczy, gdy nie ma czego powiedzieć — pusty odczyt uruchamia plan B', () => {
    expect(printerSummary(parsePrinterIdentity(''), parsePrinterStatus(''), 80)).toEqual([])
  })

  it('zgodną długość kwituje bez alarmu', () => {
    const linie = printerSummary(parsePrinterIdentity(''), parsePrinterStatus(HS), 80)
    expect(linie.join(' ')).not.toContain('⚠')
  })

  it('rozjazd długości nazywa wprost przyczyną', () => {
    const status = parsePrinterStatus('030,0,0,0478,000,0,0,0,000,0,0,0')
    const linie = printerSummary(parsePrinterIdentity(''), status, 80)
    expect(linie.join(' ')).toContain('⚠')
    expect(linie.join(' ')).toContain('Rozjazd')
  })

  it('różnicę poniżej milimetra puszcza — to szum pomiaru, nie usterka', () => {
    const status = parsePrinterStatus('030,0,0,0635,000,0,0,0,000,0,0,0')
    expect(printerSummary(parsePrinterIdentity(''), status, 80).join(' ')).not.toContain('⚠')
  })
})
