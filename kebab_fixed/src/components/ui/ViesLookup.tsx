/**
 * ViesLookup — wyszukiwanie firm zagranicznych po numerze VAT-UE przez VIES API
 * API: viesapi.eu  ID: MyDWn3QuH2rJ  KEY: 1cVi2cO97cKT
 */
import { useState } from 'react'
import { Search, Loader2, CheckCircle, AlertTriangle, Globe } from 'lucide-react'

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

// Mapowanie kodów krajów UE
const EU_COUNTRIES: Record<string, string> = {
  AT:'Austria', BE:'Belgia', BG:'Bułgaria', CY:'Cypr', CZ:'Czechy',
  DE:'Niemcy', DK:'Dania', EE:'Estonia', EL:'Grecja', ES:'Hiszpania',
  FI:'Finlandia', FR:'Francja', HR:'Chorwacja', HU:'Węgry', IE:'Irlandia',
  IT:'Włochy', LT:'Litwa', LU:'Luksemburg', LV:'Łotwa', MT:'Malta',
  NL:'Holandia', PL:'Polska', PT:'Portugalia', RO:'Rumunia', SE:'Szwecja',
  SI:'Słowenia', SK:'Słowacja',
}

export function ViesLookup({ onFound }: Props) {
  const [vatInput, setVatInput] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ViesCompanyData | null>(null)
  const [error,    setError]    = useState('')

  async function handleSearch() {
    const vat = vatInput.trim().toUpperCase().replace(/\s/g, '')
    if (!vat || vat.length < 4) {
      setError('Wpisz numer VAT-UE (np. DE123456789)')
      return
    }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      // Wywołanie przez backend proxy aby ukryć klucz API
      const res = await fetch(`/api/vies/lookup?vat=${encodeURIComponent(vat)}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Błąd połączenia z VIES' }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()

      if (!data.valid) {
        setError(`Numer ${vat} nie jest aktywny w systemie VIES`)
        return
      }

      const company: ViesCompanyData = {
        vatNumber:    data.vatNumber    || vat,
        countryCode:  data.countryCode  || vat.slice(0, 2),
        traderName:   data.traderName   || '',
        traderAddress:data.traderAddress || '',
        valid:        true,
      }
      setResult(company)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wyszukiwania VIES')
    } finally {
      setLoading(false)
    }
  }

  function handleApply() {
    if (result) {
      onFound(result)
      setResult(null)
      setVatInput('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Globe size={13} className="text-blue-600" />
        <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">
          Wyszukaj zagraniczny VAT-UE (VIES)
        </span>
      </div>

      {/* Wybór kraju + numer */}
      <div className="flex gap-2">
        <select
          value={vatInput.slice(0, 2).toUpperCase()}
          onChange={e => {
            const prefix = e.target.value
            const rest = vatInput.replace(/^[A-Z]{2}/, '')
            setVatInput(prefix + rest)
            setResult(null); setError('')
          }}
          className="h-10 px-2 text-sm font-bold border border-slate-200 focus:outline-none focus:border-brand bg-white rounded-lg w-28"
        >
          <option value="">Kraj...</option>
          {Object.entries(EU_COUNTRIES).map(([code, name]) => (
            <option key={code} value={code}>{code} — {name}</option>
          ))}
        </select>

        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="np. DE123456789"
            value={vatInput}
            onChange={e => { setVatInput(e.target.value.toUpperCase()); setResult(null); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            className="w-full h-10 pl-3 pr-10 text-sm font-mono border border-slate-200 focus:outline-none focus:border-brand bg-white rounded-lg"
          />
        </div>

        <button
          onClick={handleSearch}
          disabled={loading || !vatInput.trim()}
          className="h-10 px-4 bg-blue-600 text-white rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading
            ? <Loader2 size={14} className="animate-spin" />
            : <Search size={14} />
          }
          Szukaj
        </button>
      </div>

      {/* Błąd */}
      {error && (
        <div className="flex items-center gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
          <AlertTriangle size={13} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Wynik */}
      {result && (
        <div className="border-2 border-green-300 bg-green-50 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={15} className="text-green-600 flex-shrink-0" />
            <span className="text-[12px] font-bold text-green-700">
              Aktywny podatnik VAT-UE · {EU_COUNTRIES[result.countryCode] || result.countryCode}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div>
              <div className="text-[10px] font-bold text-slate-900-4 uppercase">Numer VAT</div>
              <div className="font-mono font-bold text-slate-900">{result.vatNumber}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-slate-900-4 uppercase">Kraj</div>
              <div className="font-semibold text-slate-900">{EU_COUNTRIES[result.countryCode] || result.countryCode}</div>
            </div>
            {result.traderName && (
              <div className="col-span-2">
                <div className="text-[10px] font-bold text-slate-900-4 uppercase">Nazwa firmy</div>
                <div className="font-semibold text-slate-900">{result.traderName}</div>
              </div>
            )}
            {result.traderAddress && (
              <div className="col-span-2">
                <div className="text-[10px] font-bold text-slate-900-4 uppercase">Adres</div>
                <div className="text-slate-900-3">{result.traderAddress}</div>
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
