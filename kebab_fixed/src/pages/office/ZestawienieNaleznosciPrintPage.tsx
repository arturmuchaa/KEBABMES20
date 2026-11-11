/**
 * „Zestawienie należności” — osobna kartka A4 z tabelką salda (spec p. 10.2).
 *
 * Ta sama treść co pod WZ, z nagłówkiem firmy i kontrahenta. Drukowana
 * z karty klienta („na dzień”, domyślnie dziś) i w dokumentach wysyłki,
 * gdy wszystko idzie na fakturę.
 *
 * /office/rozliczenia/:clientId/zestawienie/druk?na_dzien= — auto-druk
 * (?pdf=1 wyłącza; tak renderuje serwer do PDF).
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { rozliczeniaApi, settingsApi, type CompanySettings } from '@/lib/api'
import { drukuj } from '@/lib/print'
import { PrintToolbar } from '@/components/print/PrintToolbar'
import { TabelaSalda } from '@/features/rozliczenia/TabelaSalda'
import { CSS_DRUKU, NaglowekDruku, STYL_STRONY } from '@/features/rozliczenia/NaglowekDruku'
import type { Zestawienie } from '@/features/rozliczenia/druk'

export function ZestawienieNaleznosciPrintPage() {
  const { clientId = '' } = useParams()
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const naDzien = sp.get('na_dzien') || ''
  const [z, setZ] = useState<Zestawienie | null>(null)
  // undefined = jeszcze się wczytuje; null = nie udało się (drukujemy bez niej)
  const [firma, setFirma] = useState<CompanySettings | null | undefined>(undefined)
  const [err, setErr] = useState('')

  useEffect(() => {
    rozliczeniaApi.zestawienie(clientId, naDzien)
      .then(setZ).catch(e => setErr(String(e?.message || e)))
    settingsApi.getCompany().then(setFirma).catch(() => setFirma(null))
  }, [clientId, naDzien])

  useEffect(() => {
    if (z && firma !== undefined && !isPdf) setTimeout(() => void drukuj(), 300)
  }, [z, firma, isPdf])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!z || firma === undefined) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  return (
    <div style={STYL_STRONY}>
      <PrintToolbar powrot="/office" />
      <style>{CSS_DRUKU}</style>
      <NaglowekDruku firma={firma} klient={z.klient} tytul="Zestawienie należności" />
      <TabelaSalda z={z} />
    </div>
  )
}
