/**
 * Reguła auto-wysyłki skanu: co wolno wysłać bez Entera i kiedy.
 *
 * Zakład, 17.09.2026: DS2278 bez sufiksu Enter wpisywał kod w pole i nic się
 * nie działo — paleta zostawała `created`, bo żądanie nie wychodziło.
 */
import { describe, it, expect } from 'vitest'
import { czyKompletnyKod, czyKompletnyKodPalety, czyKompletnyKodSztuki, czyWpisalSkaner,
         czyZaczetyKod, idKartonu, kodKartki, MAX_MS_NA_ZNAK, MIN_ZNAKOW_SKANU, OPOZNIENIE_ZACZETEGO_MS,
         opoznienieWysylki, utworzStraznikaWysylki } from './skanKodu'

describe('rozpoznanie kompletnego kodu palety', () => {
  it('token z kartki', () => {
    expect(czyKompletnyKodPalety('PAL|6890e863376444ceaa10|7')).toBe(true)
  })

  it('adres z kodu QR — także z hosta aplikacji desktopowej', () => {
    // Kartki drukowane z Tauri niosą `tauri.localhost`; backend i tak parsuje
    // samą ścieżkę, więc host nie może decydować o auto-wysyłce.
    expect(czyKompletnyKodPalety('http://tauri.localhost/m/p/6890e863376444ceaa10/7')).toBe(true)
    expect(czyKompletnyKodPalety('http://91.98.105.107:8080/m/p/abc/12')).toBe(true)
  })

  it('NIEkompletny kod czeka na Enter', () => {
    expect(czyKompletnyKodPalety('')).toBe(false)
    expect(czyKompletnyKodPalety('   ')).toBe(false)
    expect(czyKompletnyKodPalety('7')).toBe(false)
    expect(czyKompletnyKodPalety('PAL|6890e863')).toBe(false)          // ucięty
    expect(czyKompletnyKodPalety('PAL|6890e863|')).toBe(false)         // bez numeru
    expect(czyKompletnyKodPalety('/m/p/abc')).toBe(false)              // bez numeru
    expect(czyKompletnyKodPalety('YALCIN/Z/6/09/26')).toBe(false)      // numer zamówienia
  })

  it('kod w trakcie wpisywania nie odpala się przedwcześnie', () => {
    const docelowy = 'PAL|abc|7'
    for (let i = 1; i < docelowy.length; i++) {
      expect(czyKompletnyKodPalety(docelowy.slice(0, i))).toBe(false)
    }
    expect(czyKompletnyKodPalety(docelowy)).toBe(true)
  })
})

describe('strażnik podwójnej wysyłki', () => {
  it('pierwszy skan przechodzi', () => {
    const s = utworzStraznikaWysylki()
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
  })

  it('Enter tuż po auto-wysyłce jest ignorowany', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|7', 1150)).toBe(false)   // Enter 150 ms później
  })

  it('INNY kod przechodzi od razu — kolejna paleta nie czeka', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|8', 1050)).toBe(true)
  })

  it('ten sam kod PO oknie przechodzi — blokada nie jest wieczna', () => {
    // Powtórny skan tej samej palety (np. po jej cofnięciu) musi być możliwy.
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    expect(s.wolno('PAL|abc|7', 3100)).toBe(true)
  })

  it('po nieudanej wysyłce wolno ponowić od razu', () => {
    const s = utworzStraznikaWysylki(2000)
    expect(s.wolno('PAL|abc|7', 1000)).toBe(true)
    s.zwolnij()
    expect(s.wolno('PAL|abc|7', 1100)).toBe(true)
  })

  it('pusty kod nigdy nie leci', () => {
    const s = utworzStraznikaWysylki()
    expect(s.wolno('', 1000)).toBe(false)
    expect(s.wolno('   ', 1000)).toBe(false)
  })
})

describe('rozpoznanie skanera po tempie', () => {
  it('skaner: kilkanaście znaków w kilkadziesiąt ms', () => {
    expect(czyWpisalSkaner(52, 40)).toBe(true)     // adres z QR
    expect(czyWpisalSkaner(24, 12)).toBe(true)     // token palety
  })

  it('człowiek piszący z klawiatury NIE odpala auto-wysyłki', () => {
    expect(czyWpisalSkaner(24, 4800)).toBe(false)  // ~200 ms/znak
    expect(czyWpisalSkaner(12, 2000)).toBe(false)
  })

  it('krótki ciąg nigdy — mógł wpaść przypadkiem', () => {
    expect(czyWpisalSkaner(3, 5)).toBe(false)
    expect(czyWpisalSkaner(7, 10)).toBe(false)
  })

  it('skaner BEZPRZEWODOWY (~20 ms/znak) też jest skanerem', () => {
    // Hala 25.09.2026: kod sztuki 22 znaki w ~450 ms stał w polu i czekał
    // na Enter, bo próg był 250 ms na cały kod.
    expect(czyWpisalSkaner(22, 450)).toBe(true)
  })

  it('granice są jawne, nie magiczne', () => {
    const n = MIN_ZNAKOW_SKANU
    expect(czyWpisalSkaner(n, n * MAX_MS_NA_ZNAK)).toBe(true)
    expect(czyWpisalSkaner(n, n * MAX_MS_NA_ZNAK + 1)).toBe(false)
  })
})

describe('kod sztuki i kartonu — po kształcie, nie po „|"', () => {
  const ID = 'ac82b8f61e2545a4867b'
  it.each([`U|${ID}`, `u|${ID.toUpperCase()}`, `U<${ID}`, `U#${ID}`, `U${ID}`])(
    'sztuka %s jest kompletnym kodem', kod => {
      expect(czyKompletnyKodSztuki(kod)).toBe(true)
      expect(czyKompletnyKod(kod)).toBe(true)
    })

  it('sztuka w trakcie wpisywania nie odpala się', () => {
    expect(czyKompletnyKodSztuki(`U|${ID.slice(0, 19)}`)).toBe(false)
  })

  it('karta kartonu: dokładna i z przekręconym separatorem', () => {
    expect(idKartonu(`SCARTON|${ID}`)).toBe(ID)
    expect(idKartonu(`scarton<${ID.toUpperCase()}`)).toBe(ID)
    expect(idKartonu(`U|${ID}`)).toBeNull()
  })
})

describe('karta kartonu z CapsLockiem i kartki palet (kodKartki)', () => {
  const ID = 'ac82b8f61e2545a4867b'

  it('dokładne SCARTON|<20 hex> WIELKIMI literami daje id małymi — jak w bazie', () => {
    expect(idKartonu(`SCARTON|${ID.toUpperCase()}`)).toBe(ID)
    expect(idKartonu(`scarton|${ID.toUpperCase()}`)).toBe(ID)
  })

  it('id, które nie jest 20 hex (stare kartki, testy), zostaje bez zmian', () => {
    expect(idKartonu('SCARTON|k3')).toBe('k3')
    expect(idKartonu('SCARTON|AbC123')).toBe('AbC123')
  })

  it('karton magazynowy → postać kanoniczna do wysłania', () => {
    expect(kodKartki(`\u0002]Q1SCARTON|${ID.toUpperCase()}\r`)).toEqual({ rodzaj: 'stock', id: ID, kod: `SCARTON|${ID}` })
  })

  it('kartka palety: token i adres QR — bez zmiany wielkości liter zamówienia', () => {
    expect(kodKartki('PAL|6890E863aBc|7')).toEqual({ rodzaj: 'order', kod: 'PAL|6890E863aBc|7' })
    expect(kodKartki('http://tauri.localhost/m/p/AbC123/12'))
      .toEqual({ rodzaj: 'order', kod: 'http://tauri.localhost/m/p/AbC123/12' })
  })

  it('prefiks AIM i znaki sterujące są zdejmowane także z kartki palety', () => {
    // Backend palet (`pallets_service.parse_code`) ich nie zdejmuje.
    expect(kodKartki(']Q1PAL|Zam1|2\u0003')).toEqual({ rodzaj: 'order', kod: 'PAL|Zam1|2' })
    expect(kodKartki('\u0002]Q1http://h/m/p/Zam1/2')).toEqual({ rodzaj: 'order', kod: 'http://h/m/p/Zam1/2' })
  })

  it('sztuka i śmieci to NIE kartka', () => {
    expect(kodKartki(`U|${ID}`)).toBeNull()
    expect(kodKartki('PAL|abc')).toBeNull()
    expect(kodKartki('YALCIN/Z/6/09/26')).toBeNull()
  })
})

describe('kod ze śmieciami doklejonymi przez skaner', () => {
  const ID = 'ac82b8f61e2545a4867b'
  it('prefiks AIM „]Q1" i znaki sterujące są zdejmowane', () => {
    expect(czyKompletnyKodSztuki(`]Q1U|${ID}`)).toBe(true)
    expect(idKartonu(`]Q1SCARTON|${ID}`)).toBe(ID)
    expect(idKartonu(`\u0002SCARTON|${ID}\u0003`)).toBe(ID)
  })
})

describe('kartka palety zniekształcona przez skaner (29.09.2026)', () => {
  // Hala: „skanuję kartkę na paletę, a pokazuje: to nie jest sztuka kebab".
  // Skaner w innym układzie klawiatury / z CapsLockiem psuje „/" i „|" oraz
  // wielkość liter — tak samo jak 25.09 przy sztukach i kartonach.
  const ID = '6890e863376444ceaa10'

  it('adres QR WIELKIMI literami → postać kanoniczna PAL|id|nr', () => {
    expect(kodKartki(`HTTP://TAURI.LOCALHOST/M/P/${ID.toUpperCase()}/7`))
      .toEqual({ rodzaj: 'order', kod: `PAL|${ID}|7` })
  })

  it('inny separator zamiast „/" i „|"', () => {
    expect(kodKartki(`http:--tauri.localhost-m-p-${ID}-12`)).toEqual({ rodzaj: 'order', kod: `PAL|${ID}|12` })
    expect(kodKartki(`PAL<${ID}<3`)).toEqual({ rodzaj: 'order', kod: `PAL|${ID}|3` })
    expect(kodKartki(`pal\\${ID.toUpperCase()}\\3`)).toEqual({ rodzaj: 'order', kod: `PAL|${ID}|3` })
    expect(czyKompletnyKod(`HTTP://TAURI.LOCALHOST/M/P/${ID.toUpperCase()}/7`)).toBe(true)
  })

  it('ucięta kartka nie jest kartką', () => {
    expect(kodKartki(`HTTP://TAURI.LOCALHOST/M/P/${ID.toUpperCase().slice(0, 10)}`)).toBeNull()
  })
})

describe('kod zaczęty, ale jeszcze niekompletny — czekamy dłużej', () => {
  const ID = 'ac82b8f61e2545a4867b'
  it('początki znanych kodów', () => {
    expect(czyZaczetyKod('U|ac82b8f6')).toBe(true)
    expect(czyZaczetyKod('SCARTON|ac82')).toBe(true)
    expect(czyZaczetyKod('http://tauri.localhost/m/p/68')).toBe(true)
    expect(czyZaczetyKod('HTTP://TAURI.LOC')).toBe(true)
    expect(czyZaczetyKod('PAL|6890e8')).toBe(true)
  })
  it('kompletny kod i obce napisy — nie', () => {
    expect(czyZaczetyKod(`U|${ID}`)).toBe(false)
    expect(czyZaczetyKod(`SCARTON|${ID}`)).toBe(false)
    expect(czyZaczetyKod('WX12345')).toBe(false)
  })
  it('opóźnienie wysyłki: kompletny szybko, zaczęty długo', () => {
    expect(opoznienieWysylki(`U|${ID}`, 150)).toBe(150)
    expect(opoznienieWysylki('U|ac82b8f6', 150)).toBe(OPOZNIENIE_ZACZETEGO_MS)
    expect(opoznienieWysylki('WX12345678', 150)).toBe(150)
  })
})
