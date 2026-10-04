/**
 * Ramkowanie strumienia skanera: szybka seria etykiet nie może się sklejać.
 *
 * Hala 02.10.2026: dwie szybko zeskanowane etykiety dawały jeden długi,
 * niepoprawny kod (pole czekało na 150 ms ciszy, której przy serii nie było).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CISZA_RAMKI_MS, MAX_DLUGOSC_RAMKI, PRZERWA_OBCA_MS, SUFIKS_MS, utworzBuforSkanu, utworzStrumienSkanu,
         type Ramka } from './buforSkanu'

const hex = (n: number) => n.toString(16).padStart(20, '0')
const U = (n: number) => `U|${hex(n)}`
const ID = 'ac82b8f61e2545a4867b'
const PAL_ID = '6890e863376444ceaa10'

const kody = (r: Ramka[]) => r.map(x => (x.rodzaj === 'kod' ? x.kod : `!${x.powod}`))

/** Znak po znaku, `krok` ms między znakami. */
function wystukaj(b: ReturnType<typeof utworzBuforSkanu>, tekst: string, t0: number, krok = 2) {
  const out: Ramka[] = []
  let t = t0
  for (const ch of tekst) { out.push(...b.dodaj(ch, t)); t += krok }
  return { out, t }
}

describe('stała długość: sztuka i karton zamykają się po 20. znaku hex', () => {
  it('dwie i trzy sztuki bez Entera, znak po znaku, 0 ms przerwy — osobne kody, od razu', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const { out } = wystukaj(b, U(1) + U(2) + U(3), 1000, 0)
    expect(kody(out)).toEqual([U(1), U(2), U(3)])
    expect(b.reszta()).toBe('')
    expect(b.nastepnyTik()).toBeNull()            // nic nie czeka na zegar
  })

  it('jedna zmiana pola z trzema sklejonymi kodami — trzy kody w kolejności', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(U(1) + U(2) + U(3), 1000))).toEqual([U(1), U(2), U(3)])
  })

  it('30 ms między kodami, ~10 ms między znakami (Bluetooth)', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, U(10), 1000, 10)
    const c = wystukaj(b, U(11), a.t + 30, 10)
    expect(kody([...a.out, ...c.out])).toEqual([U(10), U(11)])
  })

  it('niekompletny ogon zostaje w buforze', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(U(1) + 'U|ac82b8', 1000))).toEqual([U(1)])
    expect(b.reszta()).toBe('U|ac82b8')
    expect(kody(b.dodaj('f61e2545a4867b', 1001))).toEqual([`U|${ID}`])
  })

  it('AIM, STX/ETX, CapsLock, inny separator i brak separatora', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const wej = `]Q1U|${ID}` + `\u0002u<${ID.toUpperCase()}\u0003` + `U${ID}` + `U#${ID}`
    expect(kody(b.dodaj(wej, 1000))).toEqual([`U|${ID}`, `u<${ID.toUpperCase()}`, `U${ID}`, `U#${ID}`])
  })

  it('SCARTON + U + U bez separatorów ramek', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(`SCARTON|${ID}${U(1)}scarton${ID.toUpperCase()}${U(2)}`, 1000)))
      .toEqual([`SCARTON|${ID}`, U(1), `scarton${ID.toUpperCase()}`, U(2)])
  })

  it('seria 500 różnych kodów bez Entera — ani jednego sklejonego, zgubionego, przestawionego', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const oczekiwane = Array.from({ length: 500 }, (_, i) => U(i + 1))
    const { out } = wystukaj(b, oczekiwane.join(''), 1000, 1)
    expect(kody(out)).toEqual(oczekiwane)
    expect(b.reszta()).toBe('')
  })
})

describe('terminatory: Enter / CR / LF / Tab', () => {
  it('kończą ramkę od razu, także w wklejonym tekście', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj('KEBAB-1\r\nPAL|Zam1|1\tPAL|Zam1|12\n', 1000))).toEqual(['KEBAB-1', 'PAL|Zam1|1', 'PAL|Zam1|12'])
  })

  it('spóźniony sufiks po samoczynnym zamknięciu nie tworzy pustego skanu', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(U(1), 1000))).toEqual([U(1)])
    expect(b.poznySufiks(1050)).toBe(true)
    expect(b.zakoncz(1050)).toEqual([])
    expect(kody(b.dodaj('\r\n\t', 1060))).toEqual([])
    expect(b.poznySufiks(1000 + SUFIKS_MS + 1)).toBe(false)
  })

  it('Enter na pustym buforze nic nie oddaje', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(b.zakoncz(1000)).toEqual([])
    expect(b.dodaj('   ', 1000)).toEqual([])
    expect(b.zakoncz(1001)).toEqual([])
  })

  it('ucięta sztuka zakończona Enterem to błąd, nie sztuka', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    b.dodaj('U|ac82b8', 1000)
    const r = b.zakoncz(1010)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ rodzaj: 'blad', powod: 'niepelny', fragment: 'U|ac82b8' })
  })

  it('stara krótka kartka kartonu z Enterem idzie dalej (obsługa rozpozna)', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    b.dodaj('SCARTON|k3', 1000)
    expect(kody(b.zakoncz(1001))).toEqual(['SCARTON|k3'])
  })
})

describe('zmienna długość: kartka palety', () => {
  it('numer 1 NIE wychodzi, zanim dotrze 12 i 123', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const { out, t } = wystukaj(b, `PAL|Zam1|123`, 1000, 2)
    expect(out).toEqual([])
    expect(kody(b.tik(t + CISZA_RAMKI_MS - 10))).toEqual([])
    expect(kody(b.tik(t + CISZA_RAMKI_MS))).toEqual(['PAL|Zam1|123'])
  })

  it('pauza 600 ms między cyframi numeru nie tnie palety', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'PAL|Zam1|1', 1000, 2)
    expect(kody(b.tik(a.t + 600))).toEqual([])
    const c = wystukaj(b, '2', a.t + 600)
    expect(kody(b.tik(c.t + CISZA_RAMKI_MS))).toEqual(['PAL|Zam1|12'])
    expect(c.out).toEqual([])
  })

  it('paleta + sztuka bez separatora: numer kończy się na początku sztuki', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(`PAL|Zam1|12${U(1)}`, 1000))).toEqual(['PAL|Zam1|12', U(1)])
  })

  it('regresja: 20. hex po numerze palety domyka sztukę/karton, a nie psuje odczytu', () => {
    // Podgląd sprawdzał zgodność z NIEPEŁNYM prefiksem przed pełnym kodem —
    // 20. hex oznaczał całość jako śmieci, `zakoncz` dawał błąd.
    for (const ogon of [`U|${ID}`, `SCARTON|${ID}`, `u${ID}`]) {
      const b = utworzBuforSkanu({ tryb: 'pole' })
      expect(kody(b.dodaj(`PAL|Zam1|12${ogon}`, 1000))).toEqual(['PAL|Zam1|12', ogon])
      expect(b.zakoncz(1001)).toEqual([])
      const z = utworzBuforSkanu({ tryb: 'pole' })
      const { out, t } = wystukaj(z, `PAL|Zam1|12${ogon}`, 2000, 2)
      expect(kody(out)).toEqual(['PAL|Zam1|12', ogon])
      expect(z.zakoncz(t)).toEqual([])
    }
  })

  it('adres QR + sztuka, paleta + paleta, adres + adres — bez separatorów', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const wej = `http://tauri.localhost/m/p/AbC/7${U(1)}PAL|Zam1|1PAL|Zam1|12http://h/m/p/X/123\r`
    expect(kody(b.dodaj(wej, 1000)))
      .toEqual(['http://tauri.localhost/m/p/AbC/7', U(1), 'PAL|Zam1|1', 'PAL|Zam1|12', 'http://h/m/p/X/123'])
  })

  it('wielkość liter zamówienia NIE jest zmieniana', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj('PAL|ZaM1aB|3\r', 1000))).toEqual(['PAL|ZaM1aB|3'])
  })

  it('kartka zniekształcona przez CapsLock + sztuka', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const wej = `HTTP://TAURI.LOCALHOST/M/P/${PAL_ID.toUpperCase()}/7${U(5)}`
    expect(kody(b.dodaj(wej, 1000))).toEqual([`HTTP://TAURI.LOCALHOST/M/P/${PAL_ID.toUpperCase()}/7`, U(5)])
  })
})

describe('kartka palety: granica tylko przy POTWIERDZONEJ następnej ramce', () => {
  const blad = (r: Ramka[]) => r.map(x => (x.rodzaj === 'blad' ? x.powod : `kod:${x.kod}`))

  it('„PAL|Zam1|12SPAM" — paleta NIE wychodzi przy „S"; cały odczyt to błąd', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(b.dodaj('PAL|Zam1|12SPAM', 1000)).toEqual([])
    const r = b.zakoncz(1001)
    expect(blad(r)).toEqual(['niejednoznaczny'])
    expect((r[0] as any).fragment).toBe('PAL|Zam1|12SPAM')
    expect(b.reszta()).toBe('')
  })

  it('„PAL|Zam1|12UNRELATED" znak po znaku — nic nie wychodzi, potem błąd', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const { out } = wystukaj(b, 'PAL|Zam1|12UNRELATED', 1000, 2)
    expect(out).toEqual([])
    expect(blad(b.zakoncz(2000))).toEqual(['niejednoznaczny'])
  })

  it('błędny ogon bez terminatora — po ciszy błąd, NIE paleta', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const { t } = wystukaj(b, 'PAL|Zam1|12SPAM', 1000, 2)
    expect(b.tik(t + CISZA_RAMKI_MS - 10)).toEqual([])
    expect(blad(b.tik(t + CISZA_RAMKI_MS))).toEqual(['niejednoznaczny'])
  })

  it('niedokończona sztuka po palecie i cisza — błąd całości, NIE paleta', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const { t } = wystukaj(b, 'PAL|Zam1|12U|ac82b8', 1000, 2)
    expect(blad(b.tik(t + CISZA_RAMKI_MS))).toEqual(['niejednoznaczny'])
  })

  it('niedokończona sztuka po palecie i Enter — błąd całości', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    b.dodaj('PAL|Zam1|3U|ac', 1000)
    expect(blad(b.zakoncz(1001))).toEqual(['niejednoznaczny'])
  })

  it('obcy ogon w środku serii: zła ramka nie wykonuje palety ani nie tnie się na sztuki', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj(`PAL|Zam1|12X${U(1)}`, 1000))).toEqual([])
    expect(blad(b.zakoncz(1001))).toEqual(['niejednoznaczny'])
  })

  it('paleta czeka na pełną sztukę w podglądzie, a potem obie wychodzą natychmiast', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, `PAL|Zam1|12${U(1).slice(0, 10)}`, 1000, 1)
    expect(a.out).toEqual([])
    const c = wystukaj(b, U(1).slice(10), a.t, 1)
    expect(kody(c.out)).toEqual(['PAL|Zam1|12', U(1)])
    expect(b.reszta()).toBe('')
  })

  it('numery 1, 12, 123 + seria PAL+U, PAL+PAL, URL+URL znak po znaku', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const wej = `PAL|Zam1|1${U(1)}PAL|Zam1|12PAL|Zam1|123${U(2)}http://h/m/p/X/7http://h/m/p/X/77\r`
    const { out } = wystukaj(b, wej, 1000, 1)
    expect(kody(out)).toEqual(['PAL|Zam1|1', U(1), 'PAL|Zam1|12', 'PAL|Zam1|123', U(2),
      'http://h/m/p/X/7', 'http://h/m/p/X/77'])
  })

  it('paleta + SCARTON, AIM, CapsLock, luźny separator', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const wej = `PAL|Zam1|4SCARTON|${ID}` + `PAL|Zam1|5]Q1u<${ID.toUpperCase()}`
      + `PAL|Zam1|6PAL#${PAL_ID.toUpperCase()}#9\r`
    expect(kody(b.dodaj(wej, 1000))).toEqual(['PAL|Zam1|4', `SCARTON|${ID}`, 'PAL|Zam1|5',
      `u<${ID.toUpperCase()}`, 'PAL|Zam1|6', `PAL#${PAL_ID.toUpperCase()}#9`])
  })

  it('spacja / terminator po numerze — paleta wychodzi normalnie', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    expect(kody(b.dodaj('PAL|Zam1|12 \r', 1000))).toEqual(['PAL|Zam1|12'])
    expect(kody(b.dodaj('PAL|Zam1|13\u0002', 1000))).toEqual(['PAL|Zam1|13'])
  })

  it('zbyt długi podgląd — błąd „za długi", bufor czysty', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const poczatek = 'PAL|Zam1|1http://'
    const r = b.dodaj(poczatek + 'x'.repeat(MAX_DLUGOSC_RAMKI + 1 - poczatek.length), 1000)
    expect(blad(r)).toEqual(['za-dlugi'])
    expect(b.reszta()).toBe('')
  })
})

describe('globalny: Enter / Tab nie zamyka klawiszy człowieka', () => {
  it('„a" + Enter — nic nie wychodzi, Enter nie jest sufiksem', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    b.dodaj('a', 1000)
    expect(b.zakoncz(1001)).toEqual([])
    expect(b.reszta()).toBe('')
    expect(b.poznySufiks(1002)).toBe(false)
  })

  it('powolne pisanie człowieka + Enter — nic nie wychodzi', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    const { t } = wystukaj(b, 'abcdefghij', 1000, 200)
    expect(b.zakoncz(t)).toEqual([])
  })

  it('krótki szybki ciąg (< 8 znaków) + Enter — nic nie wychodzi', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    b.dodaj('ab', 1000)
    expect(b.zakoncz(1001)).toEqual([])
  })

  it('skan w tempie skanera + Enter — wychodzi; ucięta sztuka w tempie skanera — błąd', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    wystukaj(b, 'SCARTON|k3', 1000, 2)
    expect(kody(b.zakoncz(1030))).toEqual(['SCARTON|k3'])
    wystukaj(b, 'U|ac82b8f61e', 2000, 2)
    expect(kody(b.zakoncz(2030))).toEqual(['!niepelny'])
  })

  it('kompletna kartka palety + Enter — wychodzi także przy wolniejszym tempie', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    const { t } = wystukaj(b, 'PAL|o1|3', 1000, 100)
    expect(kody(b.zakoncz(t))).toEqual(['PAL|o1|3'])
  })
})

describe('zacięcie Bluetooth i śmieci', () => {
  it('sztuka z pauzą 500 ms w środku przychodzi w CAŁOŚCI', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'U|ac82b8f61e', 1000, 10)
    expect(b.tik(a.t + 500)).toEqual([])
    const c = wystukaj(b, '2545a4867b', a.t + 500, 10)
    expect(kody([...a.out, ...c.out])).toEqual([`U|${ID}`])
  })

  it('ucięta sztuka po długiej ciszy to błąd „niepełny", NIE sztuka', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'U|ac82b8f61e', 1000, 5)
    const r = b.tik(a.t + CISZA_RAMKI_MS)
    expect(r).toEqual([expect.objectContaining({ rodzaj: 'blad', powod: 'niepelny' })])
    expect(b.reszta()).toBe('')
  })

  it('obcy kod w tempie skanera idzie w całości po ciszy — nie jest dzielony', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'XYZ123456789', 1000, 2)
    expect(kody(b.tik(a.t + CISZA_RAMKI_MS))).toEqual(['XYZ123456789'])
  })

  it('śmieci z doklejoną sztuką NIE są cięte na „niby-poprawną" etykietę', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    b.dodaj(`XX${U(1)}`, 1000)
    expect(kody(b.zakoncz(1001))).toEqual([`XX${U(1)}`])
  })

  it('patologicznie długi bufor — czytelny błąd, bufor wyczyszczony', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const r = b.dodaj('x'.repeat(MAX_DLUGOSC_RAMKI + 1), 1000)
    expect(r).toEqual([expect.objectContaining({ rodzaj: 'blad', powod: 'za-dlugi' })])
    expect((r[0] as any).komunikat).toMatch(/zeskanuj ponownie/)
    expect(b.reszta()).toBe('')
  })

  it('pole: tekst wpisywany przez człowieka nie znika i nie leci sam', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'KR 8842L', 1000, 200)
    expect(b.nastepnyTik()).toBeNull()
    expect(b.tik(a.t + 60_000)).toEqual([])
    expect(b.reszta()).toBe('KR 8842L')
    expect(kody(b.zakoncz(a.t + 60_001))).toEqual(['KR 8842L'])
  })

  it('pole: poprawka Backspace nie zmienia człowieka w „skaner"', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    wystukaj(b, 'KR 8842LX', 1000, 200)
    b.zastap('KR 8842L', 5000)
    expect(b.nastepnyTik()).toBeNull()
  })

  it('globalny: pojedynczy klawisz człowieka nie dokleja się do następnego skanu', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    b.dodaj('a', 1000)
    expect(b.tik(1000 + PRZERWA_OBCA_MS)).toEqual([])
    expect(kody(b.dodaj(U(1), 1000 + PRZERWA_OBCA_MS + 1))).toEqual([U(1)])
  })

  it('globalny: spóźniony timer — stary klawisz porzucony przed nowym znakiem', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    b.dodaj('a', 1000)
    expect(kody(b.dodaj(U(1), 5000))).toEqual([U(1)])
  })
})

describe('strumień z zegarem', () => {
  afterEach(() => { vi.useRealTimers() })

  it('paleta bez Entera wychodzi po ciszy; zatrzymanie kasuje timer i ogon', () => {
    vi.useFakeTimers()
    const ramki: Ramka[] = []
    const reszty: string[] = []
    const s = utworzStrumienSkanu({ tryb: 'pole', onRamka: r => ramki.push(r), onReszta: r => reszty.push(r) })
    s.wpisz('PAL|Zam1|12')
    vi.advanceTimersByTime(CISZA_RAMKI_MS - 1)
    expect(ramki).toEqual([])
    vi.advanceTimersByTime(1)
    expect(kody(ramki)).toEqual(['PAL|Zam1|12'])
    expect(reszty).toEqual([''])

    s.wpisz('PAL|Zam1|13')
    s.zatrzymaj()
    vi.advanceTimersByTime(10_000)
    expect(kody(ramki)).toEqual(['PAL|Zam1|12'])
  })

  it('sztuki wychodzą synchronicznie, bez czekania na zegar', () => {
    vi.useFakeTimers()
    const ramki: Ramka[] = []
    const s = utworzStrumienSkanu({ tryb: 'pole', onRamka: r => ramki.push(r) })
    s.wpisz(U(1)); s.wpisz(U(2))
    expect(kody(ramki)).toEqual([U(1), U(2)])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('wyczyść: ogon przepada, nic nie wychodzi później', () => {
    vi.useFakeTimers()
    const ramki: Ramka[] = []
    const s = utworzStrumienSkanu({ tryb: 'pole', onRamka: r => ramki.push(r) })
    s.wpisz('PAL|Zam1|1')
    s.wyczysc()
    vi.advanceTimersByTime(10_000)
    expect(ramki).toEqual([])
    expect(s.reszta()).toBe('')
  })
})

describe('wyczyść w połowie kodu (zmiana kontekstu): ciąg dalszy to NIE nowy kod', () => {
  it('reszta sztuki po wyczyszczeniu — błąd „przerwany", żadnego kodu', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    const a = wystukaj(b, 'U|ac82b8f61e', 1000)
    b.wyczysc()
    const r = wystukaj(b, '2545a4867b', a.t + 5)
    expect(kody([...a.out, ...r.out, ...b.zakoncz(r.t)])).toEqual(['!przerwany'])
  })

  it('krótka reszta + Enter: błąd i Enter jako sufiks (nie dla przycisku)', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    const a = wystukaj(b, 'U|ac82b8f61e2545a48', 1000)
    b.wyczysc()
    const r = wystukaj(b, '67b', a.t + 5)
    expect(kody(b.zakoncz(r.t))).toEqual(['!przerwany'])
    expect(b.poznySufiks(r.t + 5)).toBe(true)
  })

  it('sam Enter tuż po wyczyszczonym ogonie to sufiks skanera', () => {
    const b = utworzBuforSkanu({ tryb: 'globalny' })
    const a = wystukaj(b, 'U|ac82b8f61e2545a4867', 1000)
    b.wyczysc()
    expect(b.poznySufiks(a.t + 5)).toBe(true)
    expect(b.poznySufiks(a.t + SUFIKS_MS + 50)).toBe(false)
  })

  it('następny pełny kod po ciszy przechodzi normalnie', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'U|ac82b8', 1000)
    b.wyczysc()
    const r = wystukaj(b, U(7), a.t + CISZA_RAMKI_MS + 50)
    expect(kody(r.out)).toEqual([U(7)])
  })

  it('po rozliczeniu przerwanej reszty kolejny kod (bez ciszy) już jest kodem', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, 'U|ac82b8f61e', 1000)
    b.wyczysc()
    const r = wystukaj(b, '2545a4867b\n', a.t + 5)
    const n = wystukaj(b, U(8), r.t + 20)
    expect(kody([...r.out, ...n.out])).toEqual(['!przerwany', U(8)])
  })

  it('wyczyszczenie PUSTEGO bufora niczego nie skaża', () => {
    const b = utworzBuforSkanu({ tryb: 'pole' })
    const a = wystukaj(b, U(1), 1000)
    b.wyczysc()
    const r = wystukaj(b, U(2), a.t + 5)
    expect(kody([...a.out, ...r.out])).toEqual([U(1), U(2)])
  })
})
