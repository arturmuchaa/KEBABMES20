import React, { useEffect, useRef, useState } from 'react'
import { FileDown, RefreshCw } from 'lucide-react'
import { podgladDrukuApi } from '@/lib/api'
import { FlagIcon } from '../../ui/Glyphs'

const A4_PX = 820          // kartka 794 px + margines strony wydruku
const A4_WYS = 1160

/**
 * Podgląd = strona wydruku w ramce — ta sama, z której serwer składa PDF, więc wygląda
 * identycznie, a pokazuje się od razu (bez uruchamiania Chrome na serwerze przy każdym kliknięciu).
 * Kartkę skalujemy do szerokości panelu. Chwila zwłoki: przechodzenie strzałkami po liście nie
 * otwiera strony dla każdego wiersza.
 */
export function Podglad({ rodzaj, id, tytul, onOtworz }: { rodzaj: 'wz' | 'cmr' | 'hdi'; id: string; tytul: string; onOtworz: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [skala, setSkala] = useState(0.6)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let zywe = true
    setSrc(null); setBlad(null)
    const t = window.setTimeout(() => {
      podgladDrukuApi.adres(rodzaj, id).then(a => { if (zywe) setSrc(a) })
        .catch(e => { if (zywe) setBlad(e instanceof Error ? e.message : 'błąd') })
    }, 250)
    return () => { zywe = false; window.clearTimeout(t) }
  }, [rodzaj, id])
  useEffect(() => {
    const el = wrap.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setSkala(Math.min(1, Math.max(0.3, (el.clientWidth - 24) / A4_PX))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  if (blad) return (
    <div className="dk-podglad-blad note warn" role="alert"><FlagIcon level="warn" size={15} />
      <div><b>Nie udało się wczytać podglądu.</b> {blad}<div style={{ marginTop: 8 }}><button className="btn sm" onClick={onOtworz}><FileDown size={14} />Otwórz PDF</button></div></div></div>
  )
  return (
    <div className="dk-podglad-skala" ref={wrap}>
      {!src ? <div className="dk-podglad-ladowanie" aria-live="polite"><RefreshCw size={16} className="spin" aria-hidden="true" /><div><b>Wczytywanie podglądu…</b></div></div>
        : <div className="dk-kartka" style={{ width: A4_PX * skala, height: A4_WYS * skala }}>
            <iframe className="dk-podglad" title={`Podgląd ${tytul}`} src={src}
              style={{ width: A4_PX, height: A4_WYS, transform: `scale(${skala})`, transformOrigin: '0 0' }} />
          </div>}
    </div>
  )
}
