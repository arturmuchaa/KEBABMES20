/**
 * DdfipRegisterPrintPage — karta 1.3.1 oPRP („Karta przyjęcia art. pomocniczych").
 *
 * Miesięczny rejestr dostaw przypraw, dodatków, osłonek, folii i opakowań.
 * Oprawa, siatka i CSS są WSPÓLNE z kartami 1.1.1 (`RegisterCard`) — to ta
 * sama księga, więc obie karty muszą wyglądać jak jedna rodzina.
 *
 * Różnica wobec 1.1.1: ta karta drukuje się KOMPLETNA. Przy mięsie kolumny
 * oceny powstają przy aucie i zostają puste do wypełnienia długopisem; tutaj
 * żadna wartość nie pochodzi z pomiaru — wszystko wpisuje biuro przy
 * rejestrowaniu dostawy, więc wydruk podpina się do księgi gotowy.
 */
import { useSearchParams } from 'react-router-dom'

import { ingredientReceptionsApi } from '@/lib/apiClient'
import { ddfipRows } from '@/lib/ddfipRegisterRows'
import { Legend, RegisterCard, type Col } from './ReceptionRegisterPrintPage'

/** Pusty wiersz do dopisania ręką — tyle, ile mieści się na kartce. */
const ROWS = 14

/** Szerokości w mm; muszą sumować się do szerokości kolumny tekstu (283 mm).
 *  Pilnuje tego test — rozjazd o 2 mm wypycha ostatnią kolumnę poza kartkę. */
export const DDFIP_COLS: Col[] = [
  { letter: 'a', w: 22, label: 'Numer przyjęcia' },
  { letter: 'b', w: 32, label: 'Skrócona nazwa dostawcy' },
  { letter: 'c', w: 46, label: 'Asortyment' },
  { letter: 'd', w: 18, label: 'Data' },
  { letter: 'e', w: 30, label: 'Faktura / atest' },
  { letter: 'f', w: 22, label: 'Ocena wizualna dostawy' },
  { letter: 'g', w: 26, label: 'Zgodność z zamówieniem. Długi termin przydatności' },
  { letter: 'h', w: 32, label: 'Uwagi' },
  { letter: 'i', w: 18, label: 'Ocena dostawy' },
  { letter: 'j', w: 19, label: 'Wykonał' },
  { letter: 'k', w: 18, label: 'Sprawdził' },
]

export function DdfipRegisterPrintPage() {
  const [params] = useSearchParams()
  return (
    <RegisterCard
      od={params.get('od')}
      isPdf={params.get('pdf') === '1'}
      withData={params.get('dane') === '1'}
      build={ddfipRows}
      fetch={range => ingredientReceptionsApi.list(range)}
      title="Rejestr przyjęcia opakowań, przypraw i dodatków technologicznych"
      subtitle="Artykuły pomocnicze (DDFiP) — wpis dla każdej dostawy, w dniu jej przyjęcia"
      cols={DDFIP_COLS}
      rows={ROWS}
      card="Karta 1.3.1 do instrukcji 1.3 — operacyjne programy warunków wstępnych (oPRP)"
      /* Oznaczenia DOKŁADNIE wg instrukcji 1.3 (b/z, N, K) — te same, co na
         karcie 1.1.1, żeby audytor nie musiał uczyć się drugiego alfabetu. */
      legend={<Legend items={[
        'numer przyjęcia — seria DF, osobna od przyjęcia mięsa; numeracja od 1 każdego miesiąca',
        'kol. f, g — ocena: b/z bez zastrzeżeń albo N niezgodne',
        'kol. i — kwalifikacja: K dostawa przyjęta albo N odmowa przyjęcia',
        'niezgodność ilościowa: wpisać ilość rzeczywiście przyjętą, uwagę w kol. h i wyegzekwować korektę dokumentów od dostawcy',
        'dostawę odrzuconą również się rejestruje — służy do oceny dostawców',
      ]} />}
    />
  )
}
