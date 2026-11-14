import React, { useEffect, useState } from 'react'
import { FileDown } from 'lucide-react'
import { fetchBlob } from '@/lib/api'
import { FlagIcon } from '../../ui/Glyphs'

/** Podgląd = PDF z serwera, ten sam, który wyjdzie z drukarki. Błąd → komunikat, nie pusta ramka. */
export function Podglad({ url, tytul, onOtworz }: { url: string; tytul: string; onOtworz: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  useEffect(() => {
    let zywe = true, obj: string | null = null
    setSrc(null); setBlad(null)
    fetchBlob(url).then(b => { if (!zywe) return; obj = URL.createObjectURL(b); setSrc(obj) })
      .catch(e => { if (zywe) setBlad(e instanceof Error ? e.message : 'błąd') })
    return () => { zywe = false; if (obj) URL.revokeObjectURL(obj) }
  }, [url])
  if (blad) return (
    <div className="dk-podglad-blad note warn" role="alert"><FlagIcon level="warn" size={15} />
      <div><b>Nie udało się wczytać podglądu.</b> {blad}<div style={{ marginTop: 8 }}><button className="btn sm" onClick={onOtworz}><FileDown size={14} />Otwórz PDF</button></div></div></div>
  )
  if (!src) return <div className="dk-podglad-ladowanie muted">Wczytywanie podglądu…</div>
  return <iframe className="dk-podglad" title={`Podgląd ${tytul}`} src={`${src}#toolbar=1&view=FitH`} />
}
