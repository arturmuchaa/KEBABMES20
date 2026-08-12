import { describe, it, expect } from 'vitest'
import { errorText } from './desktopScanner'

describe('errorText — powód odrzucenia z warstwy natywnej', () => {
  it('goły tekst z Rusta przechodzi w całości', () => {
    // Tauri odrzuca Result<_, String> ZWYKŁYM TEKSTEM, nie obiektem Error.
    // Sprawdzanie `instanceof Error` kasowało komunikat mostu i operator
    // widział bezużyteczne „nie udało się zeskanować".
    expect(errorText('Nie znaleziono NAPS2 na tym komputerze.'))
      .toBe('Nie znaleziono NAPS2 na tym komputerze.')
  })

  it('zwykły Error też działa', () => {
    expect(errorText(new Error('Skaner nie zwrócił dokumentu')))
      .toBe('Skaner nie zwrócił dokumentu')
  })

  it('obiekt z polem message', () => {
    expect(errorText({ message: 'zacięcie papieru' })).toBe('zacięcie papieru')
  })

  it('pusty tekst nie udaje komunikatu', () => {
    expect(errorText('   ')).toBe('Nie udało się zeskanować')
    expect(errorText(null)).toBe('Nie udało się zeskanować')
    expect(errorText(undefined)).toBe('Nie udało się zeskanować')
  })
})
