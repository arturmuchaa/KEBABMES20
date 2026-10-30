import { useMemo, useState } from 'react'
import { FileDown, ClipboardList } from 'lucide-react'
import { Dialog, type AppApi } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { downloadDocPdf, haccpFormsApi } from '@/lib/api'
import { receptionCards } from '@/lib/haccpCardHistory'

/** Karta 1.1.1 (rejestr dostaw) albo 1.1.1/2 (rozbicie na numery porządkowe). */
export type RodzajKarty = '111' | '1112'

/**
 * Adres PDF karty — PDF składa serwer z tego samego wzoru co stary MES
 * (`/api/karty-haccp/rejestr-przyjecia[-szczegolowy]/pdf`), więc karta wygląda
 * dokładnie tak, jak zatwierdziło ją biuro (trzy numery, podpisy w jednej linii).
 * `dane` = wypełniona z systemu; bez — pusty formularz na miesiąc.
 */
export function adresKarty(rodzaj: RodzajKarty, miesiac: string, dane: boolean): string {
  const url = rodzaj === '111' ? haccpFormsApi.receptionPdfUrl(miesiac) : haccpFormsApi.receptionDetailPdfUrl(miesiac)
  return `${url}${dane ? '&dane=1' : ''}`
}

export async function pobierzKarte(app: Pick<AppApi, 'toast'>, rodzaj: RodzajKarty, miesiac: string, dane: boolean, nr: string) {
  const plik = `Karta-${rodzaj === '111' ? '1.1.1' : '1.1.1-2'}-${nr.replace(/[\\/]/g, '-')}${dane ? '-dane' : ''}.pdf`
  try { await downloadDocPdf(adresKarty(rodzaj, miesiac, dane), plik) }
  catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać karty', detail: e instanceof Error ? e.message : '' }) }
}

/** Karta bieżącego miesiąca — do szybkiego wydruku z paska poleceń. */
export const kartaBiezaca = () => receptionCards(1)[0]

/**
 * Karty HACCP przyjęć z poprzednich miesięcy (jak „Historia kart” w starym MES):
 * karty nie są przechowywane — to formularze, które w danym miesiącu powinny istnieć.
 */
export function KartyHaccpDialog({ app, onClose }: { app: Pick<AppApi, 'toast'>; onClose: () => void }) {
  const [dane, setDane] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const karty = useMemo(() => receptionCards(12), [])
  const pobierz = async (rodzaj: RodzajKarty, miesiac: string, nr: string) => {
    setBusy(`${rodzaj}-${miesiac}`)
    await pobierzKarte(app, rodzaj, miesiac, dane, nr)
    setBusy(null)
  }
  return (
    <Dialog title="Karty HACCP przyjęć (1.1.1)" icon={<ClipboardList size={20} />} wide onClose={onClose}
      footer={<button className="btn" onClick={onClose} data-autofocus>Zamknij</button>}>
      <div className="row-wrap">
        <div className="seg" role="group" aria-label="Rodzaj wydruku">
          <button type="button" aria-pressed={dane} onClick={() => setDane(true)}>Wypełniona z systemu</button>
          <button type="button" aria-pressed={!dane} onClick={() => setDane(false)}>Pusta do ręcznego wypełnienia</button>
        </div>
      </div>
      {dane && <div className="note info"><FlagIcon level="info" size={15} /><div>
        <b>Karta 1.1.1/2</b> drukuje się kompletna — ręcznie zostają uwagi i podpis. <b>Karta 1.1.1</b> dostaje z systemu
        kolumny a–e (numery, dostawca, asortyment, data, dokument) i kontrolę HACCP wpisaną w systemie (PROTRIMA albo stary MES); to,
        czego nie wpisano przy aucie, zostaje puste.
      </div></div>}
      <div className="box"><table className="tbl">
        <thead><tr><th>Miesiąc</th><th>Numer karty</th><th className="r">Karta 1.1.1</th><th className="r">Karta 1.1.1/2</th></tr></thead>
        <tbody>{karty.map((k, i) => (
          <tr key={k.day} className={`row${i % 2 ? ' zebra' : ''}`}>
            <td className="strong">{k.when}{k.current && <span className="tag info" style={{ marginLeft: 8 }}>bieżący</span>}</td>
            <td className="code">{k.no}</td>
            <td className="r"><button className="btn sm" disabled={!!busy} onClick={() => void pobierz('111', k.day, k.no)} aria-label={`Karta 1.1.1 — ${k.when}`}>
              <FileDown size={14} />{busy === `111-${k.day}` ? 'Pobieranie…' : 'PDF'}</button></td>
            <td className="r"><button className="btn sm" disabled={!!busy} onClick={() => void pobierz('1112', k.day, k.no)} aria-label={`Karta 1.1.1/2 — ${k.when}`}>
              <FileDown size={14} />{busy === `1112-${k.day}` ? 'Pobieranie…' : 'PDF'}</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Dialog>
  )
}
