import { MoreHorizontal, Printer, FileText, Truck, Split } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { hdiApi } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'

function openDocument(url: string) {
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
}

export function OrderDocumentsMenu({ order, onCmr, onSplit }: { order: ClientOrder; onCmr: () => void; onSplit: () => void }) {
  const navigate = useNavigate()
  async function hdi() {
    try {
      const r = await hdiApi.generate(order.id)
      if (r.incomplete) alert(`Uwaga: nie wszystkie sztuki z zamówienia zostały wyprodukowane.\nHDI ${r.number} wystawiono na stan faktyczny: ${r.totals?.qty ?? 0} szt. / ${(r.totals?.kg ?? 0).toFixed(0)} kg.`)
      openDocument(`/office/hdi/${r.id}/druk`)
    } catch (e) { alert(e instanceof Error ? e.message : 'Błąd generowania HDI') }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Dokumenty ${order.orderNo}`}><MoreHorizontal size={18} aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Dokumenty zamówienia</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => openDocument(`/office/zamowienia/${order.id}/druk`)}><Printer aria-hidden="true" />Drukuj zamówienie</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void hdi()}><FileText aria-hidden="true" />{order.status === 'done' || order.status === 'cancelled' ? 'Podgląd HDI (zamrożone)' : 'Generuj HDI'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate(`/office/wz/nowy?order=${order.id}`)}><Truck aria-hidden="true" />Wystaw WZ</DropdownMenuItem>
      <DropdownMenuItem onSelect={onCmr}><FileText aria-hidden="true" />Wystaw CMR</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSplit}><Split aria-hidden="true" />Podział wysyłki na fakturę i WZ</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}
