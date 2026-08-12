/**
 * HdiScanViewer — skan HDI dostawy oglądany WEWNĄTRZ MES.
 *
 * Przy kontroli trzeba pokazać, na podstawie czego przyjęto surowiec.
 * Dotąd dokument dało się tylko pobrać na komputer — czyli znaleźć potem
 * w folderze pobierania, na TYM konkretnym stanowisku. Dokument dostawy ma
 * być w MES i dostępny z każdego stanowiska w każdej chwili, więc otwieramy
 * go tutaj, z przyciskami „Drukuj" i „Pobierz" pod ręką.
 *
 * Skan pobieramy Z SESJĄ i pokazujemy jako blob — zwykły adres w ramce
 * poszedłby bez nagłówka logowania i wrócił 401.
 */
import { useEffect, useRef, useState } from 'react'
import { Printer, Download, FileWarning } from 'lucide-react'

import { receptionsApi, openDocument } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

interface HdiScanViewerProps {
  receptionId: string
  receptionNo:  string
  supplierName?: string
  open: boolean
  onClose: () => void
}

export function HdiScanViewer({
  receptionId, receptionNo, supplierName, open, onClose,
}: HdiScanViewerProps) {
  const [src,   setSrc]   = useState('')
  const [error, setError] = useState('')
  // Referencja, nie `getElementById` — na stronie stoją DWIE tabele dostaw
  // (w obiegu i historia), więc stały identyfikator groziłby trafieniem
  // w ramkę drugiej z nich.
  const ramkaRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!open || !receptionId) return
    let adres = ''
    let porzucone = false
    setSrc(''); setError('')

    receptionsApi.hdiScanBlob(receptionId)
      .then(blob => {
        if (porzucone) return
        adres = URL.createObjectURL(blob)
        setSrc(adres)
      })
      .catch(e => { if (!porzucone) setError(e?.message || 'Nie udało się wczytać skanu') })

    // Adres bloba żyje tak długo, jak otwarty jest podgląd — bez zwolnienia
    // pamięć rośnie z każdym obejrzanym dokumentem.
    return () => { porzucone = true; if (adres) URL.revokeObjectURL(adres) }
  }, [open, receptionId])

  const nazwaPliku = `HDI ${receptionNo.replace(/\//g, '-')}.pdf`

  /**
   * Drukowanie idzie przez ramkę z dokumentem, a nie przez okno MES —
   * inaczej na wydruku wyszłaby strona aplikacji zamiast HDI.
   */
  const drukuj = () => {
    try {
      ramkaRef.current?.contentWindow?.focus()
      ramkaRef.current?.contentWindow?.print()
    } catch {
      // Czytniki PDF bywają różne; gdy druk z ramki nie przejdzie, zostaje
      // otwarcie dokumentu na zewnątrz — tam Ctrl+P działa zawsze.
      void openDocument(receptionsApi.hdiScanUrl(receptionId), nazwaPliku)
        .catch(() => setError('Nie udało się wydrukować — pobierz dokument i wydrukuj z czytnika PDF.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col gap-3">
        <DialogHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <DialogTitle className="font-mono">HDI — przyjęcie {receptionNo}</DialogTitle>
            <DialogDescription>
              {supplierName ? `${supplierName} — dokument dostawy` : 'Dokument dostawy'} do okazania przy kontroli.
            </DialogDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={drukuj} disabled={!src}>
              <Printer size={14} /> Drukuj
            </Button>
            <Button
              variant="outline" size="sm" className="gap-1.5" disabled={!src}
              onClick={() => void openDocument(receptionsApi.hdiScanUrl(receptionId), nazwaPliku)
                .catch(e => setError(e?.message || 'Nie udało się pobrać dokumentu'))}>
              <Download size={14} /> Pobierz
            </Button>
          </div>
        </DialogHeader>

        {error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <FileWarning size={32} className="text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
          </div>
        ) : src ? (
          <iframe
            ref={ramkaRef}
            src={src}
            title={`Skan HDI przyjęcia ${receptionNo}`}
            className="flex-1 w-full rounded border bg-muted/20"
          />
        ) : (
          <Skeleton className="flex-1 w-full" />
        )}
      </DialogContent>
    </Dialog>
  )
}
