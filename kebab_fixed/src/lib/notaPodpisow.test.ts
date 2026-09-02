import { describe, expect, it } from 'vitest'
import { NOTA_PODPISOW_ELEKTRONICZNYCH as NOTA } from './notaPodpisow'

/** Nota tłumaczy inspekcji, czym jest podpis bez pióra i pieczątki.
 *  Każde z tych zdań niesie osobny fakt — wycięcie któregokolwiek
 *  osłabia dokument, więc test trzyma je wszystkie. */
describe('nota o podpisach elektronicznych', () => {
  it('mówi, że dokument powstał elektronicznie', () => {
    expect(NOTA).toMatch(/wygenerowany elektronicznie/i)
  })

  it('nazywa sposób potwierdzenia tożsamości', () => {
    expect(NOTA).toMatch(/PIN/)
  })

  it('nazywa mechanizm związania podpisu z treścią', () => {
    expect(NOTA).toMatch(/SHA-256/)
  })

  it('tłumaczy, dlaczego kratka bywa pusta', () => {
    // Bez tego zdania pusta kolumna wygląda na zapomniany podpis.
    expect(NOTA).toMatch(/unieważnia podpis/i)
    expect(NOTA).toMatch(/pusta/i)
  })

  it('stwierdza wprost brak wymogu podpisu odręcznego i pieczęci', () => {
    expect(NOTA).toMatch(/nie wymaga podpisu odręcznego/i)
    expect(NOTA).toMatch(/pieczęci/i)
  })
})
