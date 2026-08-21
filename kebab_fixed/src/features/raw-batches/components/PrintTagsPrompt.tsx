/**
 * Pytanie o zawieszki, zadawane ZARAZ po zapisaniu dostawy.
 *
 * Palety jadą do chłodni w kilka minut po rozładunku — jeżeli biuro nie
 * wydrukuje zawieszek teraz, nieoznaczony stos rozpoznaje się potem tylko
 * po pamięci magazyniera. „Nie teraz" nie zamyka sprawy: ten sam druk czeka
 * w rejestrze dostaw.
 */
import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { fmtKg } from '@/lib/utils'

export interface PrintTagsPromptProps {
  open: boolean
  receptionNo: string
  batchNos: string[]
  kg: number
  onPrint: () => void
  onSkip: () => void
}

export function PrintTagsPrompt({
  open, receptionNo, batchNos, kg, onPrint, onSkip,
}: PrintTagsPromptProps) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onSkip() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Przyjęcie {receptionNo} zapisane</DialogTitle>
          <DialogDescription>
            {fmtKg(kg, 1)} kg na {batchNos.length === 1 ? 'numerze porządkowym' : 'numerach porządkowych'}{' '}
            <span className="font-mono font-bold text-primary">{batchNos.join(', ')}</span>.
            {' '}Wydrukować zawieszki na palety?
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-ink-4">
          Druk można powtórzyć w każdej chwili — przycisk „Zawieszki" jest przy
          dostawie w rejestrze przyjęć.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onSkip}>Nie teraz</Button>
          <Button onClick={onPrint} className="gap-2">
            <Printer size={14} /> Drukuj zawieszki
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
