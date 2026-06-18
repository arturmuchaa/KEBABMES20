/**
 * Wyszukiwarka pojedynczej sztuki po QR — dla biura.
 * Biuro wkleja/skanuje kod sztuki i widzi jej lokalizację (ta sama logika co mobile).
 */
import { useState } from 'react'
import { finishedUnitsApi, type FinishedUnitCard } from '@/lib/api'
import { unitLocation } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'
import { Input } from '@/components/ui/input'
import { QrCode, Search, X } from 'lucide-react'

export function OfficeUnitLookup() {
  const clientDisplay = useClientNames()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<FinishedUnitCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const code = value.trim()
    if (!code || busy) return
    setBusy(true); setError(null); setCard(null)
    try {
      setCard(await finishedUnitsApi.lookup(code))
    } catch (e: any) {
      setError((e?.message ?? '').includes('404') ? 'Nie znaleziono sztuki' : (e?.message || 'Błąd'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <form
        onSubmit={e => { e.preventDefault(); submit() }}
        className="relative w-full max-w-xs"
      >
        <QrCode size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-9 pr-8 text-sm"
          placeholder="Lokalizacja sztuki — QR…"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink" title="Szukaj">
          <Search size={14} />
        </button>
      </form>

      {(card || error) && (
        <div className="absolute z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <button
            onClick={() => { setCard(null); setError(null); setValue('') }}
            className="absolute right-2 top-2 text-slate-400 hover:text-slate-700"
          ><X size={14} /></button>
          {error && <div className="text-sm font-semibold text-red-600">{error}</div>}
          {card && (
            <div className="space-y-1 text-sm">
              <div className="font-mono text-base font-black">{card.batchNo || '—'}</div>
              <div className="text-slate-600">{card.productTypeName || card.recipeName || '—'}</div>
              <div className="text-slate-600">Tuleja: <b>{card.tuleja || '—'}</b></div>
              <div className="text-slate-600">Klient: {clientDisplay(card.clientName) || '—'}</div>
              <div className="mt-1 rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">
                {unitLocation({ status: card.status, cartonNo: card.cartonNo, clientName: card.clientName })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
