/**
 * ReceptionTagsPage — strona druku zawieszek na palety przyjętej dostawy.
 *
 * Wchodzi się tu zaraz po zarejestrowaniu dostawy (pytanie „wydrukować
 * zawieszki?") ALBO później z rejestru przyjęć — bo druk lubi się nie udać:
 * BrowserPrint bywa wyłączony, taśma się kończy, a zawieszka gubi się po
 * drodze do chłodni. Ekran nic nie zapisuje w księdze, więc druk można
 * powtórzyć do skutku.
 *
 * Sam rachunek i tabela siedzą w `ReceptionTags`; tutaj tylko wczytanie
 * dokumentu i most do drukarki.
 */
import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useApi } from '@/hooks/useApi'
import { receptionsApi, suppliersApi } from '@/lib/apiClient'
import { getDevices, probeBrowserPrint, sendZpl } from '@/lib/zebra'

import { ReceptionTags } from '../components/ReceptionTags'
import { DEFAULT_CONTAINERS_PER_PALLET } from '../palletTags'
import { receptionTagZpl, type ReceptionTagInput } from '../receptionTagZpl'

const LIST_PATH = '/office/raw-batches'

export function ReceptionTagsPage() {
  const { receptionId = '' } = useParams()
  const navigate = useNavigate()

  const reception = useApi(() => receptionsApi.byId(receptionId), [receptionId])
  const suppliers = useApi(() => suppliersApi.list())

  const [printing, setPrinting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const dostawca = (suppliers.data ?? []).find(s => s.id === reception.data?.supplierId)

  const print = useCallback(async (tags: ReceptionTagInput[]) => {
    setPrinting(true)
    setMessage(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona i podłączona do tego komputera.')
      // Zawieszka po zawieszce, a nie jednym ^PQ: każda ma inny numer palety
      // i inną wagę, więc kopie drukarki nie wchodzą w grę.
      for (const tag of tags) await sendZpl(dev, receptionTagZpl(tag))
      setMessage({ ok: true, text: `Wysłano na drukarkę: ${tags.length} zawieszek` })
    } catch (e: any) {
      // Zwykle to nie błąd druku, tylko brak/zablokowana usługa BrowserPrint —
      // sonda mówi biuru wprost, co jest nie tak.
      const probe = await probeBrowserPrint()
      setMessage({
        ok: false,
        text: probe.ok
          ? (e?.message || 'Nie udało się wydrukować zawieszek')
          : (probe.reason ?? 'Brak połączenia z drukarką etykiet'),
      })
    } finally {
      setPrinting(false)
    }
  }, [])

  const rememberLayout = useCallback(async (perPallet: number) => {
    if (!dostawca) return
    try {
      await suppliersApi.setPalletLayout(dostawca.id, perPallet)
      toast.success(`Zapamiętano: ${perPallet} pojemników na palecie u ${dostawca.name}`)
      void suppliers.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie udało się zapisać układu palety')
    }
  }, [dostawca, suppliers])

  if (!reception.data) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {reception.error ?? 'Wczytywanie dostawy…'}
      </div>
    )
  }

  return (
    <ReceptionTags
      reception={reception.data}
      defaultContainersPerPallet={dostawca?.containersPerPallet ?? DEFAULT_CONTAINERS_PER_PALLET}
      onPrint={print}
      onRememberLayout={dostawca ? rememberLayout : undefined}
      onClose={() => navigate(LIST_PATH)}
      printing={printing}
      message={message}
    />
  )
}
