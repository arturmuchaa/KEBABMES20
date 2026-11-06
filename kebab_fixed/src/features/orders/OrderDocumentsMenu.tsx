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
  const closed = order.status === 'done' || order.status === 'cancelled'
  async function hdi(preliminary = false) {
    try {
      const r = await hdiApi.generate(order.id, preliminary)
      if (r.incomplete) alert(`Uwaga: HDI nie obejmuje wszystkich sztuk z zamówienia.\nHDI ${r.number} wystawiono na ${preliminary ? 'zarejestrowaną produkcję i dostępny towar' : 'zeskanowany towar'}: ${r.totals?.qty ?? 0} szt. / ${(r.totals?.kg ?? 0).toFixed(0)} kg.`)
      openDocument(`/office/hdi/${r.id}/druk`)
    } catch (e) { alert(e instanceof Error ? e.message : 'Błąd generowania HDI') }
  }
  return <><Button variant="outline" size="sm" className="order-action mr-1 gap-1.5 bg-white" aria-label={`Drukuj ${order.orderNo}`} onClick={() => openDocument(`/office/zamowienia/${order.id}/druk`)}><Printer size={14} aria-hidden="true" />Drukuj</Button><DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Dokumenty ${order.orderNo}`}><MoreHorizontal size={18} aria-hidden="true" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Dokumenty zamówienia</DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => openDocument(`/office/zamowienia/${order.id}/druk`)}><Printer aria-hidden="true" />Drukuj zamówienie</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openDocument(`/office/zamowienia/${order.id}/druk?internal=1`)}><Printer aria-hidden="true" />Lista kompletacji (wewnętrzna)</DropdownMenuItem>
      {!closed && <DropdownMenuItem onSelect={() => void hdi(true)}><FileText aria-hidden="true" />HDI wstępne — przed załadunkiem</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => void hdi()}><FileText aria-hidden="true" />{closed ? 'Podgląd HDI (zamrożone)' : 'HDI z załadunku'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate(`/office/wz/nowy?order=${order.id}`)}><Truck aria-hidden="true" />Wystaw WZ</DropdownMenuItem>
      <DropdownMenuItem onSelect={onCmr}><FileText aria-hidden="true" />Wystaw CMR</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSplit}><Split aria-hidden="true" />Podział wysyłki na fakturę i WZ</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></>
}
