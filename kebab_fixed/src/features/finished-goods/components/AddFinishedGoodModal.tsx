/**
 * Ręczne dodanie wyrobu gotowego (biuro).
 *
 * Produkcja i masownia nie mają jeszcze komputerów, więc wyrób wprowadza
 * biuro. Wpis ma zrobić to samo, co zrobiłby kiosk: postawić sztuki na
 * magazynie, zdjąć tuleje, zdjąć mięso przyprawione i policzyć się do
 * pokrycia zamówienia.
 *
 * Dlatego DOMYŚLNĄ drogą jest „z zamówienia": pokrycie liczy się po trójce
 * numer zamówienia + receptura + waga sztuki, a wpisywanie ich z ręki kończy
 * się wyrobem, który wisi obok zamówienia zamiast je domykać.
 */
import { useEffect, useMemo, useState } from 'react'
import { clientOrdersApi, finishedGoodsApi, packagingApi, recipesApi, seasonedMeatApi } from '@/lib/api'
import { fmtKg } from '@/lib/utils'
import {
  manualGoodsIssues, manualGoodsPayload, remainingOnLine, liczba, type ManualGoodsForm,
} from '../manualGoods'

const dzisiaj = () => new Date().toISOString().slice(0, 10)

const PUSTY: ManualGoodsForm = {
  qty: '', kgPerUnit: '', producedDate: dzisiaj(),
  recipeId: '', recipeName: '', productTypeId: '', productTypeName: '',
  packagingId: '', packagingName: '', clientId: '', clientName: '', clientOrderNo: '',
  batchNos: [], consumeSeasoned: false,
}

export function AddFinishedGoodModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tryb, setTryb] = useState<'zamowienie' | 'magazyn'>('zamowienie')
  const [form, setForm] = useState<ManualGoodsForm>(PUSTY)
  const [zamowienia, setZamowienia] = useState<any[]>([])
  const [partie, setPartie] = useState<any[]>([])
  const [tuleje, setTuleje] = useState<any[]>([])
  const [receptury, setReceptury] = useState<any[]>([])
  const [wybranaPozycja, setWybranaPozycja] = useState('')
  const [zajety, setZajety] = useState(false)
  const [blad, setBlad] = useState('')
  const [pokazBledy, setPokazBledy] = useState(false)

  useEffect(() => {
    clientOrdersApi.list().then(r => setZamowienia(Array.isArray(r) ? r : [])).catch(() => setZamowienia([]))
    seasonedMeatApi.list().then(r => setPartie(Array.isArray(r) ? r : [])).catch(() => setPartie([]))
    packagingApi.all().then(r => setTuleje((Array.isArray(r) ? r : [])
      .filter((p: any) => String(p.type || '').toLowerCase() === 'tuleja'))).catch(() => setTuleje([]))
    recipesApi.list().then(r => setReceptury(Array.isArray(r) ? r : [])).catch(() => setReceptury([]))
  }, [])

  const otwarte = useMemo(
    () => zamowienia.filter(o => o.status !== 'done' && o.status !== 'cancelled'),
    [zamowienia],
  )

  // Pozycja zamówienia wypełnia WSZYSTKIE pola powiązania naraz — po to,
  // żeby operator nie mógł wpisać receptury innej niż zamówiona.
  const wezZPozycji = (order: any, l: any) => {
    setWybranaPozycja(l.id)
    setForm(f => ({
      ...f,
      qty: String(remainingOnLine(l) || l.qty || ''),
      kgPerUnit: String(l.kgPerUnit ?? ''),
      recipeId: l.recipeId ?? '', recipeName: l.recipeName ?? '',
      productTypeId: l.productTypeId ?? '', productTypeName: l.productTypeName ?? '',
      packagingId: l.packagingId ?? '', packagingName: l.packagingName ?? '',
      clientId: order.clientId ?? '', clientName: order.clientName ?? '',
      clientOrderNo: order.orderNo ?? '',
    }))
  }

  const przelaczPartie = (batchNo: string) => setForm(f => {
    const ma = f.batchNos.includes(batchNo)
    const batchNos = ma ? f.batchNos.filter(b => b !== batchNo) : [...f.batchNos, batchNo]
    // Wskazanie partii samo włącza zdejmowanie mięsa: to domyślna, poprawna
    // droga. Odznaczenie zostawiamy na wpisy historyczne.
    return { ...f, batchNos, consumeSeasoned: batchNos.length > 0 && (ma ? f.consumeSeasoned : true) }
  })

  const bledy = manualGoodsIssues(form)
  const sztuk = Math.round(liczba(form.qty))
  const kgRazem = Math.round(sztuk * liczba(form.kgPerUnit) * 100) / 100

  const zapisz = async () => {
    setPokazBledy(true)
    if (bledy.length) return
    setZajety(true); setBlad('')
    try {
      await finishedGoodsApi.create(manualGoodsPayload(form))
      onSaved()
      onClose()
    } catch (e: any) {
      setBlad(e?.message || 'Nie udało się zapisać wyrobu')
    } finally {
      setZajety(false)
    }
  }

  const pole = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-full w-[900px] max-w-full flex-col gap-4 overflow-auto rounded-xl bg-background p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold">Dodaj wyrób gotowy</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Wpis zastępuje pracę kiosku: sztuki wchodzą na magazyn, tuleje i mięso schodzą ze stanu.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij"
            className="ml-auto text-xl text-muted-foreground">✕</button>
        </div>

        <div className="flex gap-2">
          {([['zamowienie', 'Z zamówienia'], ['magazyn', 'Na magazyn']] as const).map(([k, label]) => (
            <button key={k} type="button" data-testid={`tryb-${k}`}
              onClick={() => { setTryb(k); if (k === 'magazyn') { setWybranaPozycja(''); setForm(f => ({ ...f, clientOrderNo: '', clientId: '', clientName: '' })) } }}
              className={`rounded-md border px-4 py-2 text-sm font-semibold ${
                tryb === k ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
              {label}
            </button>
          ))}
        </div>

        {tryb === 'zamowienie' && (
          <div className="flex flex-col gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Pozycja zamówienia
            </div>
            <div className="flex max-h-52 flex-col gap-1.5 overflow-auto">
              {otwarte.flatMap(o => (o.lines ?? []).map((l: any) => (
                <button key={l.id} type="button" data-testid={`pozycja-${l.id}`}
                  onClick={() => wezZPozycji(o, l)}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm ${
                    wybranaPozycja === l.id ? 'border-primary bg-primary/5' : 'border-input'}`}>
                  <span className="font-mono font-bold">{o.orderNo}</span>
                  <span className="flex-1">{o.clientName} · {l.recipeName} {fmtKg(l.kgPerUnit)} kg</span>
                  <span className="tabular-nums text-muted-foreground">
                    zostało {remainingOnLine(l)} z {l.qty} szt.
                  </span>
                </button>
              )))}
              {otwarte.length === 0 && (
                <div className="px-1 py-4 text-sm text-muted-foreground">
                  Brak otwartych zamówień — wpisz wyrób „na magazyn".
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold">
            Receptura
            <select data-testid="pole-receptura" className={pole} value={form.recipeId}
              disabled={tryb === 'zamowienie'}
              onChange={e => {
                const r = receptury.find((x: any) => x.id === e.target.value)
                setForm(f => ({ ...f, recipeId: e.target.value, recipeName: r?.name ?? '' }))
              }}>
              <option value="">— wybierz —</option>
              {receptury.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Waga sztuki (kg)
            <input data-testid="pole-waga" className={pole} inputMode="decimal" value={form.kgPerUnit}
              disabled={tryb === 'zamowienie'}
              onChange={e => setForm(f => ({ ...f, kgPerUnit: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Sztuk
            <input data-testid="pole-sztuki" className={pole} inputMode="numeric" value={form.qty}
              onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold">
            Tuleja
            <select data-testid="pole-tuleja" className={pole} value={form.packagingId}
              onChange={e => {
                const p = tuleje.find((x: any) => x.id === e.target.value)
                setForm(f => ({ ...f, packagingId: e.target.value, packagingName: p?.name ?? '' }))
              }}>
              <option value="">— bez tulei —</option>
              {tuleje.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({Math.floor(Number(p.kgAvailable) || 0)} szt.)</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs font-semibold">
            Data produkcji
            <input data-testid="pole-data" type="date" className={pole} value={form.producedDate}
              onChange={e => setForm(f => ({ ...f, producedDate: e.target.value }))} />
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Partia z masowni — z niej powstanie numer partii wyrobu
          </div>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
            {partie.map((p: any) => (
              <button key={p.id} type="button" data-testid={`partia-${p.batchNo}`}
                onClick={() => przelaczPartie(p.batchNo)}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  form.batchNos.includes(p.batchNo) ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                <span className="font-mono">{p.batchNo}</span>
                <span className="ml-2 opacity-70">{p.recipeName} · {fmtKg(p.kgAvailable)} kg</span>
              </button>
            ))}
            {partie.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Masownia nie ma wolnych partii — wyrób wejdzie bez wsadu, z numerem z daty.
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="zdejmij-mieso" checked={form.consumeSeasoned}
              onChange={e => setForm(f => ({ ...f, consumeSeasoned: e.target.checked }))} />
            Zdejmij mięso przyprawione ze stanu masowni
          </label>
        </div>

        <div data-testid="podsumowanie" className="rounded-lg border border-input bg-muted/40 px-4 py-3 text-sm">
          <b>{sztuk || 0} szt. × {form.kgPerUnit || 0} kg = {kgRazem} kg</b>
          {form.recipeName ? ` · ${form.recipeName}` : ''}
          {form.packagingName ? ` · ${form.packagingName}` : ''}
          {form.clientName ? ` · ${form.clientName}` : ' · na magazyn'}
          {form.clientOrderNo ? ` · ${form.clientOrderNo}` : ''}
        </div>

        <div data-testid="skutki" className="text-sm text-muted-foreground">
          Ze stanu zejdzie: {form.packagingId ? `${sztuk} szt. tulei` : 'brak tulei'}
          {form.consumeSeasoned && form.batchNos.length
            ? ` · ${kgRazem} kg mięsa przyprawionego (${form.batchNos.join(', ')})`
            : ' · mięso bez zmian'}
        </div>

        {pokazBledy && bledy.length > 0 && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {bledy[0]}
          </div>
        )}
        {blad && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">{blad}</div>
        )}

        <div className="flex gap-3">
          <button type="button" data-testid="zapisz-wyrob" onClick={zapisz} disabled={zajety}
            className="flex-1 rounded-md bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {zajety ? 'Zapisuję…' : 'Dodaj wyrób'}
          </button>
          <button type="button" onClick={onClose}
            className="rounded-md border border-input px-6 py-3 text-sm font-semibold">Anuluj</button>
        </div>
      </div>
    </div>
  )
}
