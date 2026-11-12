import React, { useState } from 'react'
import { Scale } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { rozliczeniaApi } from '@/lib/api'
import { dataPl, kwota } from '@/features/rozliczenia/druk'
import { dodajDni, doGroszy, kwotaBezWaluty, kwotaSalda, liczba, znakSalda, type Karta, type Ksiega } from './model'
import { OdmowaSerwera, PoleKwoty, Segment, klasaSalda, naEnter, tekstBledu, useZapis } from './wspolne'

type Kierunek = 'winien' | 'nadplata'
type Stan = { kierunek: Kierunek; tekst: string; zalegle: string; uwagi: string }

const KIERUNKI = [['winien', 'klient winien'], ['nadplata', 'nadpłata']] as const
const KSIEGI: Ksiega[] = ['wz', 'fv']
const NAZWA: Record<Ksiega, 'WZ' | 'Faktury'> = { wz: 'WZ', fv: 'Faktury' }
const SKROT: Record<Ksiega, string> = { wz: 'WZ', fv: 'FV' }
const BLAD_KWOTY = 'Wpisz kwotę bez znaku — kierunek wybierz wyżej'

const poczatek = (k: Karta, ks: Ksiega): Stan => {
  const o = k.otwarcia[ks]
  if (!o) return { kierunek: 'winien', tekst: '', zalegle: '', uwagi: '' }
  return {
    kierunek: znakSalda(o.kwota) > 0 ? 'nadplata' : 'winien',
    tekst: znakSalda(o.kwota) === 0 ? '' : kwotaBezWaluty(Math.abs(o.kwota)),
    zalegle: o.zalegleOd ?? '', uwagi: o.uwagi,
  }
}

/** Kwota bez znaku z pola (puste = 0); ze znakiem albo nie liczba — NaN. */
const kwotaBezZnaku = (t: string) => {
  if (!t.trim()) return 0
  if (/^\s*[-+−–]/.test(t)) return NaN
  const x = liczba(t)
  return Number.isFinite(x) && x >= 0 ? doGroszy(x) : NaN
}

type Dto = { kwota: number; zalegle_od: string | null; uwagi: string }

/**
 * Saldo otwarcia z karty w kształcie `doApi` — punkt odniesienia „co się zmieniło”.
 * `null` — klient nie ma jeszcze żadnego salda otwarcia: zapisać trzeba obie księgi,
 * także puste (= 0), bo dopiero wtedy saldo zaczyna drukować się na WZ.
 */
const zKarty = (k: Karta, ks: Ksiega): Dto | null => {
  const o = k.otwarcia[ks]
  if (!o && !k.otwarcia.wz && !k.otwarcia.fv) return null
  return { kwota: o?.kwota ?? 0, zalegle_od: o?.zalegleOd ?? null, uwagi: o?.uwagi ?? '' }
}

/** Wartość do API: minus — klient winien, plus — nadpłata; „zaległe od” tylko przy długu. */
const doApi = (s: Stan): Dto => {
  const k = kwotaBezZnaku(s.tekst)
  return {
    kwota: k === 0 ? 0 : s.kierunek === 'winien' ? -k : k,
    zalegle_od: s.kierunek === 'winien' && s.zalegle ? s.zalegle : null,
    uwagi: s.uwagi.trim(),
  }
}

/**
 * Saldo otwarcia — stan z arkusza biura na początek dnia startu, osobno dla
 * WZ i faktur. Biuro wybiera kierunek słowem („klient winien” / „nadpłata”)
 * i wpisuje kwotę bez znaku; znak dokłada okno.
 */
export function OtwarcieDialog({ karta, ksiega, onClose, onZapisano, onOdswiez }: {
  karta: Karta; onClose: () => void; onZapisano: () => void
  /** Księga, z której otwarto okno (klik w wiersz „Saldo otwarcia”) — tam fokus. */
  ksiega?: Ksiega
  /** Odświeżenie karty bez zamykania okna — gdy zapisała się tylko jedna księga. */
  onOdswiez?: () => void
}) {
  const app = useApp()
  const w = karta.klient.waluta
  const [stan, setStan] = useState<Record<Ksiega, Stan>>(() => ({ wz: poczatek(karta, 'wz'), fv: poczatek(karta, 'fv') }))
  const zapis = useZapis('Nie udało się zapisać salda otwarcia')
  // Stan na serwerze: z karty, a po częściowym zapisie — z tego, co już przeszło (ponowny zapis wysyła tylko resztę).
  const [zapisane, setZapisane] = useState<Record<Ksiega, Dto | null>>(() => ({ wz: zKarty(karta, 'wz'), fv: zKarty(karta, 'fv') }))
  const nowyKlient = !karta.otwarcia.wz && !karta.otwarcia.fv
  const zmien = (ks: Ksiega, z: Partial<Stan>) => setStan(s => ({ ...s, [ks]: { ...s[ks], ...z } }))

  const bladKwoty = (ks: Ksiega) => (Number.isNaN(kwotaBezZnaku(stan[ks].tekst)) ? BLAD_KWOTY : null)
  const bladZaleglych = (ks: Ksiega) => (stan[ks].kierunek === 'winien' && stan[ks].zalegle && stan[ks].zalegle > karta.start
    ? `Data „zaległe od” nie może być po dacie startu (${dataPl(karta.start)})` : null)
  const zmieniona = (ks: Ksiega) => {
    const teraz = doApi(stan[ks]), przed = zapisane[ks]
    if (!przed) return true
    return doGroszy(teraz.kwota) !== doGroszy(przed.kwota)
      || (znakSalda(teraz.kwota) < 0 && teraz.zalegle_od !== przed.zalegle_od) || teraz.uwagi !== przed.uwagi
  }
  const bledne = KSIEGI.some(ks => bladKwoty(ks) || bladZaleglych(ks))
  const doZapisu = KSIEGI.filter(zmieniona)
  const ok = !bledne && doZapisu.length > 0
  const tip = bledne ? 'Popraw zaznaczone pola' : !doZapisu.length ? 'Nic nie zmieniono' : undefined

  const zapisz = () => {
    if (!ok) return
    void zapis.zapisz(async () => {
      const opisy: string[] = []
      const gotowe: Ksiega[] = []
      for (const ks of doZapisu) {
        const dto = doApi(stan[ks])
        try {
          await rozliczeniaApi.ustawOtwarcie(karta.klient.id, ks, dto)
        } catch (e) {
          if (!gotowe.length) throw e
          // Część przeszła: karta ma to pokazać, a komunikat — powiedzieć, co jest zapisane.
          onOdswiez?.()
          throw new Error(`Saldo otwarcia ${SKROT[ks]} nie zapisano — ${tekstBledu(e, 'błąd serwera')}. `
            + `Saldo otwarcia ${gotowe.map(g => SKROT[g]).join(' i ')} jest już zapisane.`)
        }
        gotowe.push(ks)
        setZapisane(z => ({ ...z, [ks]: dto }))
        opisy.push(`${SKROT[ks]}: ${znakSalda(dto.kwota) < 0 ? `klient winien ${kwota(-dto.kwota, w)}` : znakSalda(dto.kwota) > 0 ? `nadpłata ${kwota(dto.kwota, w)}` : 'zero'}`)
      }
      app.toast({ kind: 'ok', title: 'Saldo otwarcia zapisane', detail: opisy.join(' · ') })
      onZapisano()
    })
  }

  // Stan z arkusza to dzień przed startem (np. start 09.11 → „stan na 08.11”).
  const podpowiedzUwag = `np. z arkusza, stan na ${dataPl(dodajDni(karta.start, -1)).slice(0, 5)}`
  return (
    <Dialog wide icon={<Scale size={20} />} onClose={onClose}
      title={<>Saldo otwarcia <span className="rr-dlg-klient">{karta.klient.nazwa}</span></>}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn primary" disabled={!ok || zapis.busy} data-tip={tip} onClick={zapisz}>
          {zapis.busy ? 'Zapisuję…' : 'Zapisz saldo otwarcia'}
        </button>
      </>}>
      <div className="note"><FlagIcon level="info" size={15} />
        <div>Stan na początek dnia {dataPl(karta.start)}. Dokumenty z tego dnia i późniejsze liczą się już w systemie.</div>
      </div>
      {nowyKlient && (
        <div className="note warn"><FlagIcon level="warn" size={15} />
          <div>Klient nie ma jeszcze salda otwarcia, więc saldo nie drukuje się na WZ ani w papierach kursu. Wpisz stan z arkusza — puste pole to 0 (klient nic nie jest winien) i też można je zapisać.</div>
        </div>
      )}
      <div className="rr-otw">
        {KSIEGI.map(ks => {
          const s = stan[ks], n = NAZWA[ks], dto = doApi(s)
          return (
            <section key={ks} className="rr-otw-k" role="group" aria-label={`Saldo otwarcia — ${n}`}>
              <h3>{n}</h3>
              <div className="fld"><span className="label">Na początek dnia startu</span>
                <Segment label={`Kierunek ${n}`} value={s.kierunek} opcje={KIERUNKI} onChange={k => zmien(ks, { kierunek: k })} />
              </div>
              <div className="fld"><span className="label">Kwota ({w})</span>
                <PoleKwoty label={`Kwota ${n}`} value={s.tekst} onChange={t => zmien(ks, { tekst: t })} waluta={w} blad={bladKwoty(ks)}
                  onEnter={zapisz} autofocus={ks === (ksiega ?? 'wz')} placeholder="0,00 — brak salda" />
                {!bladKwoty(ks) && (
                  <span className="rr-pole-pod">na start księgi: <b className={`tnum${klasaSalda(dto.kwota)}`}>{kwotaSalda(dto.kwota, w)}</b></span>
                )}
              </div>
              {s.kierunek === 'winien' && (
                <label className="fld"><span className="label">Zaległe od (opcjonalnie)</span>
                  <input type="date" className={`field${bladZaleglych(ks) ? ' invalid' : ''}`} value={s.zalegle} max={karta.start}
                    aria-label={`Zaległe od ${n}`} onChange={e => zmien(ks, { zalegle: e.target.value })} onKeyDown={naEnter(zapisz)} />
                  {bladZaleglych(ks)
                    ? <span className="rr-pole-blad">{bladZaleglych(ks)}</span>
                    : <span className="rr-pole-pod">dni po terminie policzą się od tej daty, nie od dnia startu</span>}
                </label>
              )}
              <label className="fld"><span className="label">Uwagi</span>
                <input className="field" value={s.uwagi} aria-label={`Uwagi ${n}`} placeholder={podpowiedzUwag}
                  onChange={e => zmien(ks, { uwagi: e.target.value })} onKeyDown={naEnter(zapisz)} />
              </label>
            </section>
          )
        })}
      </div>
      <OdmowaSerwera blad={zapis.blad} />
    </Dialog>
  )
}
