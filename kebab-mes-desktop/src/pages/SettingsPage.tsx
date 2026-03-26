import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Save, LogOut, CheckCircle, AlertCircle } from 'lucide-react'
import { getApiUrl, setApiUrl, getFacilityName, setFacilityName, clearApiUrl } from '@/store/config'
import { resetClient } from '@/api/client'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/toast-utils'
import axios from 'axios'

export function SettingsPage() {
  const navigate = useNavigate()
  const [url,      setUrl]      = useState(getApiUrl() || '')
  const [facility, setFacility] = useState(getFacilityName())
  const [checking, setChecking] = useState(false)
  const [connOk,   setConnOk]   = useState<boolean | null>(null)
  const [errMsg,   setErrMsg]   = useState('')

  async function handleTest() {
    setChecking(true); setConnOk(null); setErrMsg('')
    try {
      await axios.get(`${url.replace(/\/+$/, '')}/api/health`, { timeout: 5_000 })
      setConnOk(true)
    } catch (e: any) {
      setConnOk(false); setErrMsg(e?.message || 'Błąd')
    } finally {
      setChecking(false)
    }
  }

  function handleSave() {
    setApiUrl(url)
    setFacilityName(facility)
    resetClient()
    toast.success('Ustawienia zapisane')
  }

  function handleReset() {
    clearApiUrl()
    navigate('/setup', { replace: true })
  }

  return (
    <div className="max-w-lg space-y-6 animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle>Połączenie z backendem</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="URL serwera API"
            value={url}
            onChange={e => { setUrl(e.target.value); setConnOk(null) }}
            placeholder="http://localhost:8000"
            leftIcon={<Server size={14} />}
          />
          <Input
            label="Nazwa zakładu"
            value={facility}
            onChange={e => setFacility(e.target.value)}
          />

          {connOk === true && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle size={13} /> Backend dostępny
            </div>
          )}
          {connOk === false && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/40 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /> {errMsg}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleTest} loading={checking} className="flex-1">
              Test połączenia
            </Button>
            <Button onClick={handleSave} className="flex-1">
              <Save size={14} /> Zapisz
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Akcje</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleReset} size="sm">
            <LogOut size={13} /> Resetuj konfigurację
          </Button>
          <p className="text-xs text-slate-500 mt-2">
            Usuwa zapisany adres API i wraca do ekranu konfiguracji.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
