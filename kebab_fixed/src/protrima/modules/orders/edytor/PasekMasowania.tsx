import { useEffect, useMemo, useState } from 'react'
import { Calculator } from 'lucide-react'
import { materialRequirementsApi, type MaterialRequirements } from '@/lib/api'
import type { LineForm } from '@/features/orders/order-form/types'
import { kg } from '../../../data/model'
import { doPodgladu, masowaniePoRecepturach, type PozycjaPodgladu } from './masowanie'

const kgDokl = (n: number) => `${n.toFixed(2).replace('.', ',')} kg`

/**
 * Pasek pod pozycjami edytora: ile mięsa wymieszać na każdą recepturę i ile
 * surowca to oznacza — liczone na żywo przez serwer, gdy biuro wpisuje pozycje.
 * Całe zamówienie, bez wyrobu z magazynu; brakujący wyrób po zapisie pokazuje
 * „Zapotrzebowanie na masowanie” na liście zamówień.
 */
export function PasekMasowania({ lines, recipes }: { lines: LineForm[]; recipes: Array<{ id: string; name: string }> }) {
  const items = useMemo(() => doPodgladu(lines), [lines])
  const klucz = JSON.stringify(items)
  const [stan, setStan] = useState<{ klucz: string; items: PozycjaPodgladu[]; wynik: MaterialRequirements | null; blad?: string } | null>(null)

  useEffect(() => {
    if (!items.length) { setStan(null); return }
    let zywy = true
    // Odczekanie: nie pytamy serwera przy każdej cyfrze.
    const t = setTimeout(() => {
      materialRequirementsApi.preview(items)
        .then(wynik => { if (zywy) setStan({ klucz, items, wynik }) })
        .catch(e => { if (zywy) setStan({ klucz, items, wynik: null, blad: e instanceof Error ? e.message : 'błąd serwera' }) })
    }, 400)
    return () => { zywy = false; clearTimeout(t) }
  }, [klucz]) // eslint-disable-line react-hooks/exhaustive-deps

  const nazwa = useMemo(() => { const m = new Map(recipes.map(r => [r.id, r.name])); return (id: string) => m.get(id) ?? 'receptura' }, [recipes])
  const lista = useMemo(() => (stan?.wynik ? masowaniePoRecepturach(stan.items, stan.wynik, nazwa) : []), [stan, nazwa])
  const suma = lista.reduce((a, r) => a + r.miesoKg, 0)
  const swiezy = stan?.klucz === klucz

  return (
    <div className={`mix-bar${stan && !swiezy ? ' stale' : ''}`} role="region" aria-label="Masowanie i surowiec" aria-busy={!!items.length && !swiezy}>
      <span className="mb-h" data-tip={'Szacunek z receptur dla całego zamówienia, bez wyrobu z magazynu.\nMięso zaokrąglone w górę po zsumowaniu pozycji receptury.'}>
        <Calculator size={15} />Masowanie{lista.length > 0 && <b>{kg(suma)} mięsa</b>}
      </span>
      {!items.length && <span className="faint">pojawi się po wpisaniu pierwszej kompletnej pozycji</span>}
      {items.length > 0 && !stan && <span className="faint">liczenie…</span>}
      {stan?.blad && <span className="warn-ink">Nie udało się policzyć masowania: {stan.blad}</span>}
      {lista.length > 0 && <>
        <span className="mb-list">{lista.map(r => (
          <span key={r.recipeId} className={`mb-chip${r.bezSkladu ? ' warn' : ''}`}
            data-tip={r.bezSkladu
              ? `${r.nazwa}: receptura bez dodatków w składzie — mięso policzone jako cała masa wyrobu (${kg(r.wyrobKg)}). Sprawdź recepturę.`
              : `${r.nazwa}\nWyrób ${kg(r.wyrobKg)} · mięso dokładnie ${kgDokl(r.miesoDokladne)}\nDodatki i przyrost ${kg(Math.max(0, r.wyrobKg - r.miesoDokladne))}`}>
            <span className="n">{r.nazwa}</span><b>{kg(r.miesoKg)}</b>
          </span>
        ))}</span>
        {(stan?.wynik?.totalsByRaw.length ?? 0) > 0 && <span className="mb-raw" aria-label="Surowiec">
          {stan!.wynik!.totalsByRaw.map(t => (
            <span key={t.rawTypeId} data-tip={t.kgMeat > 0 && t.kgMeat < t.kgRaw ? `Z tego mięso ${kg(t.kgMeat)} — wydajność rozbioru ${Math.round(stan!.wynik!.yieldPct)}%` : undefined}>
              {t.rawName} <b>{kg(Math.ceil(t.kgRaw))}</b>
            </span>
          ))}
        </span>}
      </>}
    </div>
  )
}
