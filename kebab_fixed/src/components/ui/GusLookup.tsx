/**
 * GusLookup — wyszukiwanie danych firmy po NIP przez dataport.pl
 * Przepisane z biuro.html ERP v26 do React.
 */
import { useState } from 'react'
import { Search, CheckCircle, AlertTriangle } from 'lucide-react'
import { companyApi } from '@/lib/api'

export interface GusCompanyData {
  nip:            string
  regon?:         string
  nazwa:          string
  ulica?:         string
  numer_budynku?: string
  numer_lokalu?:  string
  kod_pocztowy?:  string
  miasto?:        string
  adres?:         string
}

interface GusLookupProps { onFound: (d: GusCompanyData) => void }


type GusStatus = 'idle' | 'loading' | 'found' | 'error'

export function GusLookup({ onFound }: GusLookupProps) {
  const [nip,    setNip]    = useState('')
  const [status, setStatus] = useState<GusStatus>('idle')
  const [msg,    setMsg]    = useState('')
  const [result, setResult] = useState<GusCompanyData | null>(null)

  async function fetchGus() {
    const clean = nip.replace(/[^0-9]/g, '')
    if (clean.length !== 10) { setStatus('error'); setMsg('NIP musi mieć dokładnie 10 cyfr'); return }
    setStatus('loading'); setResult(null); setMsg('')
    try {
      const data = await companyApi.gus(clean)   // autoryzowane (Bearer token) — bez 401
      if (!data?.nazwa) { setStatus('error'); setMsg('Nie znaleziono firmy w rejestrze (MF/GUS)'); return }
      const company: GusCompanyData = {
        nip: clean, regon: data.regon, nazwa: data.nazwa ?? '',
        ulica: data.ulica, numer_budynku: data.numer_budynku,
        numer_lokalu: data.numer_lokalu, kod_pocztowy: data.kod_pocztowy, miasto: data.miasto,
        adres: data.adres,
      }
      setResult(company); setStatus('found'); onFound(company)
    } catch (e) {
      setStatus('error')
      setMsg('Błąd połączenia z GUS. Wpisz dane ręcznie klikając „— Wpisz ręcznie" poniżej.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-brand-light border border-brand-border rounded-xl px-4 py-3 text-xs text-brand font-medium">
        <strong>Polska firma</strong> — wpisz NIP i kliknij „Pobierz z GUS".
        Dane uzupełnią się automatycznie.
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[11px] font-bold uppercase tracking-wide text-ink-3 block mb-1">NIP (10 cyfr)</label>
          <input
            type="text" inputMode="numeric" maxLength={13} placeholder="0000000000"
            value={nip}
            onChange={e => setNip(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={e => e.key === 'Enter' && fetchGus()}
            className="w-full h-10 px-3 text-sm font-mono font-bold rounded-xl border-2 border-surface-4 bg-surface-2 focus:outline-none focus:border-brand focus:bg-white transition-colors"
          />
        </div>
        <button onClick={fetchGus} disabled={status === 'loading'}
          className="h-10 px-4 rounded-xl bg-brand text-white text-xs font-bold flex items-center gap-2 disabled:opacity-50 hover:bg-brand-dark transition-colors whitespace-nowrap flex-shrink-0">
          {status === 'loading'
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Search size={13} />}
          {status === 'loading' ? 'Pobieranie...' : 'Pobierz z GUS'}
        </button>
      </div>

      {status === 'found' && result && (
        <div className="bg-success-light border border-success-border rounded-xl px-4 py-3 animate-fade-in">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={13} className="text-success" />
            <span className="text-xs font-bold text-success">Dane pobrane z GUS</span>
          </div>
          <div className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-0.5 text-xs">
            <span className="text-ink-3 font-semibold">Nazwa</span>
            <span className="font-bold text-ink">{result.nazwa}</span>
            {result.regon && <><span className="text-ink-3 font-semibold">REGON</span><span className="font-mono text-ink">{result.regon}</span></>}
            <span className="text-ink-3 font-semibold">NIP</span>
            <span className="font-mono text-ink">{result.nip}</span>
            {result.miasto && <>
              <span className="text-ink-3 font-semibold">Adres</span>
              <span className="text-ink">
                {[result.ulica, result.numer_budynku].filter(Boolean).join(' ')}
                {result.miasto ? `, ${result.kod_pocztowy ?? ''} ${result.miasto}` : ''}
              </span>
            </>}
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-start gap-2 bg-warn-light border border-warn-border rounded-xl px-4 py-3 animate-fade-in">
          <AlertTriangle size={13} className="text-warn flex-shrink-0 mt-0.5" />
          <span className="text-xs font-semibold text-warn">{msg}</span>
        </div>
      )}
    </div>
  )
}
