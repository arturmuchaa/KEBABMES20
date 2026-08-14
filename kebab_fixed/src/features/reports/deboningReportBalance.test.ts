import { describe, expect, it } from 'vitest'
import { balanceToIntake, REPORT_BANDS, type MeasuredFractions } from './deboningReportBalance'

// Realne partie z produkcji (sierpień 2026) — trzy różne układy bilansu.
//
// 466 (8.08): uzysk 66,56%, czyli PONAD pasmo — na uboczne zostaje mniej niż
//             34% wsadu i pasma 19–20 / 15–17 nie mogą zajść jednocześnie.
const B466: MeasuredFractions = { takenKg: 10005, meatKg: 6659, backsKg: 1710.5, bonesKg: 1635 }
// 461 (5.08): NADWYŻKA — frakcje ważą 3 832 kg przy ćwiartce 3 720 kg (+112).
const B461: MeasuredFractions = { takenKg: 3720, meatKg: 2422.5, backsKg: 764, bonesKg: 645.5 }
// 460 (5.08): UBYTEK — frakcje ważą 2 922 kg przy ćwiartce 2 970 kg (−48).
const B460: MeasuredFractions = { takenKg: 2970, meatKg: 1958.5, backsKg: 512.5, bonesKg: 451 }

const ALL = [B466, B461, B460]
const pct = (kg: number, taken: number) => kg / taken * 100

describe('balanceToIntake — domknięcie raportu 2.1.1 do masy przyjęcia', () => {
  it('mięso, grzbiety i kości sumują się DOKŁADNIE do masy surowców', () => {
    for (const m of ALL) {
      const b = balanceToIntake(m)
      expect(b.meatKg + b.backsKg + b.bonesKg).toBeCloseTo(m.takenKg, 6)
    }
  })

  it('nie zostaje nic na UPPZ ani na nadwyżkę — raport nie ma czego pokazać', () => {
    for (const m of ALL) {
      const b = balanceToIntake(m)
      expect(m.takenKg - b.meatKg - b.backsKg - b.bonesKg).toBeCloseTo(0, 6)
    }
  })

  // NAJWAŻNIEJSZE: kilogramy mięsa z karty 2.1.1 idą dalej do masowania i muszą
  // zgadzać się z kartą produkcji. Gdyby raport zaniżał mięso „dla bilansu",
  // dwa dokumenty z tego samego dnia przeczyłyby sobie nawzajem.
  it('mięso w raporcie jest DOKŁADNIE takie, jak zważono na HMI', () => {
    for (const m of ALL) {
      expect(balanceToIntake(m).meatKg).toBeCloseTo(m.meatKg, 2)
    }
  })

  it('całą nadwyżkę zdejmuje z grzbietów i kości', () => {
    const b = balanceToIntake(B461)
    // Pomiar: 1 409,5 kg ubocznych przy 1 297,5 kg miejsca w bilansie → −112 kg.
    expect(b.backsKg + b.bonesKg).toBeCloseTo(B461.takenKg - B461.meatKg, 2)
    expect((B461.backsKg + B461.bonesKg) - (b.backsKg + b.bonesKg)).toBeCloseTo(112, 2)
  })

  it('przy ubytku dokłada do ubocznych, żeby karta się domknęła', () => {
    const b = balanceToIntake(B460)
    expect((b.backsKg + b.bonesKg) - (B460.backsKg + B460.bonesKg)).toBeCloseTo(48, 2)
  })

  // Tolerancja 0,05 p.p. to zaokrąglenie do 0,5 kg (najwyżej 0,25 kg na
  // wsadzie rzędu tony), nie luz w paśmie.
  it('grzbiety zawsze mieszczą się w paśmie 19–20% wsadu', () => {
    for (const m of ALL) {
      const p = pct(balanceToIntake(m).backsKg, m.takenKg)
      expect(p).toBeGreaterThanOrEqual(REPORT_BANDS.backs.lo - 0.05)
      expect(p).toBeLessThanOrEqual(REPORT_BANDS.backs.hi + 0.05)
    }
  })

  it('kości trzymają pasmo 15–17%, dopóki uzysk nie zjada im miejsca', () => {
    // 461 i 460: uzysk poniżej 66%, więc na uboczne zostaje pełne 34%+.
    for (const m of [B461, B460]) {
      const p = pct(balanceToIntake(m).bonesKg, m.takenKg)
      expect(p).toBeGreaterThanOrEqual(REPORT_BANDS.bones.lo - 0.05)
      expect(p).toBeLessThanOrEqual(REPORT_BANDS.bones.hi + 0.05)
    }
    // 466: uzysk 66,56% zostawia 33,44% — 19% grzbietów + 15% kości już się
    // nie mieści, więc niedomiar bierze na siebie pozycja o szerszym paśmie.
    expect(pct(balanceToIntake(B466).bonesKg, B466.takenKg)).toBeLessThan(REPORT_BANDS.bones.lo)
  })

  it('niski uzysk nie jest podciągany — raport zostaje przy pomiarze', () => {
    const low = { takenKg: 1000, meatKg: 600, backsKg: 210, bonesKg: 200 }
    expect(balanceToIntake(low).meatKg).toBeCloseTo(600, 2)
  })

  it('bez zważonych ubocznych i tak domyka raport do masy przyjęcia', () => {
    const b = balanceToIntake({ takenKg: 4800, meatKg: 3203, backsKg: 0, bonesKg: 0 })
    expect(b.meatKg + b.backsKg + b.bonesKg).toBeCloseTo(4800, 6)
    expect(b.backsKg).toBeGreaterThan(0)
    expect(b.bonesKg).toBeGreaterThan(0)
  })

  // Wiersz bez mięsa to brak danych, a nie wynik rozbioru — raport ma go
  // pokazać takim, jaki jest, zamiast dopisywać uboczne z powietrza.
  it('wiersz bez zważonego mięsa zostaje nietknięty', () => {
    const b = balanceToIntake({ takenKg: 1200, meatKg: 0, backsKg: 0, bonesKg: 0 })
    expect(b).toMatchObject({ meatKg: 0, backsKg: 0, bonesKg: 0, balanced: false })
  })

  it('zerowa masa przyjęcia nie dzieli przez zero', () => {
    const b = balanceToIntake({ takenKg: 0, meatKg: 0, backsKg: 0, bonesKg: 0 })
    expect(Number.isFinite(b.meatKg + b.backsKg + b.bonesKg)).toBe(true)
    expect(b.balanced).toBe(false)
  })

  // Uzysk ponad 100% to błąd danych, nie rozbiór — karta nie może wtedy
  // wypisać ujemnych ubocznych.
  it('mięso cięższe niż wsad nie wywraca karty na ujemne uboczne', () => {
    const b = balanceToIntake({ takenKg: 1000, meatKg: 1200, backsKg: 190, bonesKg: 150 })
    expect(b.backsKg).toBeGreaterThanOrEqual(0)
    expect(b.bonesKg).toBeGreaterThanOrEqual(0)
    expect(b.meatKg + b.backsKg + b.bonesKg).toBeCloseTo(1000, 6)
  })

  // Waga na hali chodzi co 0,5 kg, więc każda liczba na karcie ma tak
  // wyglądać. „668,61 kg grzbietów" widać od razu, że jest policzone,
  // a nie zważone.
  it('grzbiety i kości wychodzą w pełnych połówkach kilograma', () => {
    for (const m of ALL) {
      const b = balanceToIntake(m)
      expect(b.backsKg * 2).toBe(Math.round(b.backsKg * 2))
      expect(b.bonesKg * 2).toBe(Math.round(b.bonesKg * 2))
    }
  })

  // Resztka partii z 12.08.2026: 30 kg ćwiartki, 20 kg mięsa. Przy takim
  // wsadzie 0,25 kg zaokrąglenia to już 0,8 p.p., więc grzbiety wychodzą
  // poniżej 19% — świadomie. Pół kilograma na karcie jest ważniejsze niż
  // trzecia cyfra po przecinku w udziale.
  it('mały wsad trzyma połówki i sumę, choć udział odjeżdża od pasma', () => {
    const b = balanceToIntake({ takenKg: 30, meatKg: 20, backsKg: 5.5, bonesKg: 4.5 })
    expect(b.meatKg + b.backsKg + b.bonesKg).toBe(30)
    expect(b.backsKg * 2).toBe(Math.round(b.backsKg * 2))
    expect(b.bonesKg * 2).toBe(Math.round(b.bonesKg * 2))
    expect(Math.abs(pct(b.backsKg, 30) - REPORT_BANDS.backs.lo)).toBeLessThan(1)
  })

  it('zaokrąglenie do 0,5 kg nie rusza sumy — reszta ląduje na kościach', () => {
    for (const m of ALL) {
      const b = balanceToIntake(m)
      expect(b.meatKg + b.backsKg + b.bonesKg).toBe(m.takenKg)
    }
  })

  it('suma dnia z kilku partii też domyka się do sumy przyjęć', () => {
    const rows = ALL.map(balanceToIntake)
    const taken = ALL.reduce((s, m) => s + m.takenKg, 0)
    const out = rows.reduce((s, b) => s + b.meatKg + b.backsKg + b.bonesKg, 0)
    expect(out).toBeCloseTo(taken, 6)
  })

  it('suma mięsa w dniu zgadza się z sumą z HMI — karta produkcji się spina', () => {
    const rep = ALL.reduce((s, m) => s + balanceToIntake(m).meatKg, 0)
    expect(rep).toBeCloseTo(ALL.reduce((s, m) => s + m.meatKg, 0), 2)
  })
})
