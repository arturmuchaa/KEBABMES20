/**
 * SetupPage — shown on first launch (no API URL configured).
 * User enters the backend server URL and facility name.
 * On save, redirects to the main app.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { setApiUrl, setFacilityName, resetClient } from '@/store/config'
import { resetClient as resetAxios } from '@/api/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import axios from 'axios'

// allow importing both resetClient names — store has no resetClient, api/client does
function applyConfig(url: string) {
  setApiUrl(url)
  resetAxios()
}

type CheckState = 'idle' | 'checking' | 'ok' | 'error'

export function SetupPage() {
  const navigate = useNavigate()

  const [url,      setUrl]      = useState('http://localhost:8000')
  const [facility, setFacility] = useState('Kebab MES')
  const [check,    setCheck]    = useState<CheckState>('idle')
  const [errMsg,   setErrMsg]   = useState('')

  async function handleTest() {
    setCheck('checking')
    setErrMsg('')
    try {
      const clean = url.replace(/\/+$/, '')
      await axios.get(`${clean}/api/health`, { timeout: 5_000 })
      setCheck('ok')
    } catch (e: any) {
      setCheck('error')
      setErrMsg(e?.message || 'Nie można połączyć')
    }
  }

  function handleSave() {
    const clean = url.replace(/\/+$/, '')
    applyConfig(clean)
    setFacilityName(facility)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="h-screen w-screen bg-mes-bg flex items-center justify-center p-8">
      {/* ── Card ────────────────────────────────────────── */}
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-mes-accent flex items-center justify-center shadow-mes-glow">
            <span className="text-lg font-black text-white leading-none">M</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Kebab MES</h1>
            <p className="text-xs text-slate-500">Konfiguracja połączenia</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-mes-surface border border-mes-border rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Serwer API</h2>
            <p className="text-xs text-slate-500">
              Adres serwera FastAPI (backend MES). Przykład: http://192.168.1.10:8000
            </p>
          </div>

          <Input
            label="URL serwera API"
            value={url}
            onChange={e => { setUrl(e.target.value); setCheck('idle') }}
            placeholder="http://localhost:8000"
            leftIcon={<Server size={14} />}
            hint="Bez ukośnika na końcu"
          />

          <Input
            label="Nazwa zakładu"
            value={facility}
            onChange={e => setFacility(e.target.value)}
            placeholder="Kebab MES"
          />

          {/* Test result */}
          {check === 'ok' && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle size={14} /> Połączenie z backendem OK
            </div>
          )}
          {check === 'error' && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/40 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errMsg}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleTest}
              loading={check === 'checking'}
            >
              {check === 'checking' ? 'Testowanie…' : 'Test połączenia'}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!url}
            >
              Zapisz i uruchom
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">
          Ustawienia możesz zmienić w dowolnym momencie w sekcji Ustawienia.
        </p>
      </div>
    </div>
  )
}
