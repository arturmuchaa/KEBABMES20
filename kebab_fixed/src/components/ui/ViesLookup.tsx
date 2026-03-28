/**
 * ViesLookup — wyszukiwanie firm po NIP (PL) lub VAT-UE (VIES)
 * PL: Biała Lista MF (pełne dane)
 * EU: EC VIES REST API (weryfikacja aktywności)
 */
import { useState } from 'react'
import { Search, Loader2, CheckCircle, AlertTriangle, Globe, Building2 } from 'lucide-react'

export interface ViesCompanyData {
  vatNumber:    string
  countryCode:  string
  traderName:   string
  traderAddress:string
  valid:        boolean
}

interface Props {
  onFound: (data: ViesCompanyData) => void
}

const _isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const _envUrl  = import.meta.env.VITE_API_URL as string | undefined
const API_BASE = _isTauri
  ? `${_envUrl || 'http://204.168.166.34'}/api`
  : _envUrl ? `${_envUrl}/api` : '/api'

const EU_COUNTRIES: Record<string, string> = {
  AT:'Austria', BE:'Belgia', BG:'Bułgaria', CY:'Cypr', CZ:'Czechy',
  DE:'Niemcy', DK:'Dania', EE:'Estonia', EL:'Grecja', ES:'Hiszpania',
  FI:'Finlandia', FR:'Francja', HR:'Chorwacja', HU:'Węgry', IE:'Irlandia',
  IT:'Włochy', LT:'Litwa', LU:'Luksemburg', LV:'Łotwa', MT:'Malta',
  NL:'Holandia', PL:'Polska', PT:'Portugalia', RO:'Rumunia', SE:'Szwecja',
  SI:'Słowenia', SK:'Słowacja',
}

type Mode = 'nip' | 'vies'

export function ViesLookup({ onFound }: Props) {
  const [mode,     setMode]     = useState<Mode>('nip')
  const [nipInput, setNipInput] = useState('')
  const [vatInput, setVatInput] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ViesCompanyData | null>(null)
  const [error,    setError]    = useState('')

  async function handleNipSearch() {
    const nip = nipInput.replace(/\D/g, '')
    if (nip.length !== 10) { setError('NIP musi mieć 10 cyfr'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res  = await fetch(`${API_BASE}/nip/lookup?nip=${nip}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Błąd ${res.status}`)
      if (!data.valid) { setError(`NIP ${nip} nie znaleziony w Białej Liście MF`); return }
      setResult({
        vatNumber:     'PL' + nip,
        countryCode:   'PL',
        traderName:    data.name    || '',
        traderAddress: data.address || '',
        valid:         true,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wyszukiwania NIP')
    } finally { setLoading(false) }
  }

  async function handleViesSearch() {
    const vat = vatInput.trim().toUpperCase().replace(/\s/g, '')
    if (!vat || vat.length < 4) { setError('Wpisz numer VAT-UE (np. DE123456789)'); return }
    setLoading(true); setError(''); setResult(null)
    try {
      const res  = await fetch(`${API_BASE}/vies/lookup?vat=${encodeURIComponent(vat)}`)
      const ct   = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) throw new Error(`Błąd serwera (${res.status})`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Błąd ${res.status}`)
      if (!data.valid) { setError(`Numer ${vat} nie jest aktywny w systemie VIES`); return }
      setResult({
        vatNumber:     data.vatNumber    || vat,
        countryCode:   data.countryCode  || vat.slice(0, 2),
        traderName:    data.traderName   || '',
        traderAddress: data.traderAddress || '',
        valid:         true,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wyszukiwania VIES')
    } finally { setLoading(false) }
  }

  function handleApply() {
    if (result) { onFound(result); setResult(null); setNipInput(''); setVatInput('') }
  }

  return (
    <div className="space-y-3">
      {/* Przełącznik trybu */}
      <div className="flex rounded-xl overflow-hidden border border-slate-200 text-[12px] font-semibold">
        <button
          onClick={() => { setMode('nip'); setResult(null); setError('') }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${mode === 'nip' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
        >
          <Building2 size={12} /> NIP (Polska)
        </button>
        <button
          onClick={() => { setMode('vies'); setResult(null); setError('') }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${mode === 'vies' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
        >
          <Globe size={12} /> VAT-UE (Europa)
        </button>
      </div>

      {/* Formularz NIP */}
      {mode === 'nip' && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="np. 5213003772"
            value={nipInput}
            onChange={e => { setNipInput(e.target.value.replace(/\D/g, '')); setResult(null); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleNipSearch()}
            maxLength={10}
            className="flex-1 h-10 pl-3 text-sm font-mono border border-slate-200 focus:outline-none focus:border-blue-400 bg-white rounded-lg"
          />
          <button
            onClick={handleNipSearch}
            disabled={loading || nipInput.replace(/\D/g,'').length !== 10}
            className="h-10 px-4 bg-blue-600 text-white rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Szukaj
          </button>
        </div>
      )}

      {/* Formularz VAT-UE */}
      {mode === 'vies' && (
        <div className="flex gap-2">
          <select
            value={vatInput.slice(0, 2).toUpperCase()}
            onChange={e => { const p = e.target.value; setVatInput(p + vatInput.replace(/^[A-Z]{2}/, '')); setResult(null); setError('') }}
            className="h-10 px-2 text-sm font-bold border border-slate-200 focus:outline-none focus:border-blue-400 bg-white rounded-lg w-28"
          >
            <option value="">Kraj...</option>
            {Object.entries(EU_COUNTRIES).filter(([c]) => c !== 'PL').map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="np. 129274202"
            value={vatInput.replace(/^[A-Z]{2}/, '')}
            onChange={e => { setVatInput((vatInput.slice(0,2) || '') + e.target.value.toUpperCase()); setResult(null); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleViesSearch()}
            className="flex-1 h-10 pl-3 text-sm font-mono border border-slate-200 focus:outline-none focus:border-blue-400 bg-white rounded-lg"
          />
          <button
            onClick={handleViesSearch}
            disabled={loading || vatInput.trim().length < 4}
            className="h-10 px-4 bg-blue-600 text-white rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Szukaj
          </button>
        </div>
      )}

      {mode === 'vies' && (
        <p className="text-[10px] text-slate-400">
          Weryfikacja aktywności VAT-UE. Dane firmy zależą od polityki kraju — niektóre kraje nie udostępniają nazwy/adresu.
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          <AlertTriangle size={13} className="flex-shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="border-2 border-green-300 bg-green-50 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
            <span className="text-[12px] font-bold text-green-700">
              {result.countryCode === 'PL' ? 'Firma z Białej Listy MF' : `Aktywny podatnik VAT-UE · ${EU_COUNTRIES[result.countryCode] || result.countryCode}`}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase">NIP / VAT</div>
              <div className="font-mono font-bold text-slate-900">{result.vatNumber}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase">Kraj</div>
              <div className="font-semibold text-slate-900">{EU_COUNTRIES[result.countryCode] || result.countryCode}</div>
            </div>
            {result.traderName ? (
              <div className="col-span-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Nazwa firmy</div>
                <div className="font-semibold text-slate-900">{result.traderName}</div>
              </div>
            ) : (
              <div className="col-span-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                Dane firmy niedostępne — uzupełnij nazwę ręcznie po dodaniu
              </div>
            )}
            {result.traderAddress && (
              <div className="col-span-2">
                <div className="text-[10px] font-bold text-slate-400 uppercase">Adres</div>
                <div className="text-slate-600">{result.traderAddress}</div>
              </div>
            )}
          </div>
          <button
            onClick={handleApply}
            className="w-full h-9 bg-green-600 text-white rounded-lg font-bold text-sm hover:bg-green-700 transition-colors"
          >
            ✓ Użyj tych danych
          </button>
        </div>
      )}
    </div>
  )
}
