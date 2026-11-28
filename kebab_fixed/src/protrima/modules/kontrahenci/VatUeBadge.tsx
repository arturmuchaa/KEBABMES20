import React from 'react'
import { ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw, Loader2 } from 'lucide-react'
import type { VatUeWynik } from '@/lib/api'

const dzien = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Status VAT UE odbiorcy z VIES (27.11.2026). Nieaktywny = tylko ostrzeżenie
 * (faktura z VAT), nigdy blokada. Gdy VIES nie odpowiada — ostatni pewny wynik
 * i ponowienie; brak wyniku / odbiorca spoza UE = nic.
 */
export function VatUeBadge({ wynik, ladowanie, onPonow }: { wynik: VatUeWynik | null; ladowanie?: boolean; onPonow?: () => void }) {
  if (ladowanie && !wynik) {
    return <span className="vatue wait" role="status"><Loader2 size={14} className="spin" /> Sprawdzam VAT UE w VIES…</span>
  }
  if (!wynik || wynik.status === 'nie_dotyczy' || wynik.status === '') return null
  if (wynik.status === 'aktywny') {
    return <span className="vatue ok" role="status" title={wynik.checkedAt ? `Sprawdzono ${new Date(wynik.checkedAt).toLocaleString('pl-PL')}` : undefined}>
      <ShieldCheck size={14} /> VAT UE aktywny{wynik.requestId ? ` · potw. ${wynik.requestId}` : ''}
    </span>
  }
  if (wynik.status === 'nieaktywny') {
    return <span className="vatue bad" role="status"><ShieldAlert size={14} /> VAT UE NIEAKTYWNY — wystaw fakturę z VAT 5 %</span>
  }
  const op = wynik.ostatniPewny
  return <span className="vatue warn" role="status" title={wynik.komunikat || undefined}>
    <ShieldQuestion size={14} />
    {op ? `VIES nie odpowiada — ostatni wynik z ${dzien(op.checkedAt)}: ${op.status}` : 'VIES nie odpowiada — nie sprawdzono'}
    {onPonow && <button type="button" className="vatue-ponow" onClick={onPonow} disabled={ladowanie}><RefreshCw size={12} /> Sprawdź ponownie</button>}
  </span>
}
