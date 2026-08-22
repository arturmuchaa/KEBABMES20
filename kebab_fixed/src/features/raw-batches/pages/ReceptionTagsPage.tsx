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
 * dokumentu, most do drukarki i nastawa kalibracyjna stanowiska
 * (`tagPrinterCalibration` — tam opisane, dlaczego wychodziła „co druga krzywo").
 */
import { useCallback, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useApi } from '@/hooks/useApi'
import { receptionsApi, suppliersApi } from '@/lib/apiClient'
import { getDevices, probeBrowserPrint, sendZpl } from '@/lib/zebra'

import { ReceptionTags } from '../components/ReceptionTags'
import { DEFAULT_CONTAINERS_PER_PALLET } from '../palletTags'
import type { ReceptionTagInput } from '../receptionTagZpl'
import { receptionTagsPrintJobs } from '../receptionTagsPrint'
import {
  CALIBRATE_ZPL, calibrationTestZpl, loadCalibration, saveCalibration,
  tearOffZpl, type TagPrinterCalibration,
} from '../tagPrinterCalibration'

const LIST_PATH = '/office/raw-batches'

export function ReceptionTagsPage() {
  const { receptionId = '' } = useParams()
  const navigate = useNavigate()

  const reception = useApi(() => receptionsApi.byId(receptionId), [receptionId])
  const suppliers = useApi(() => suppliersApi.list())

  const [printing, setPrinting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Nastawa jest cechą TEGO stanowiska (drukarka + rolka), więc czytamy ją z
  // localStorage, a nie z bazy — drugie biurko ma inną drukarkę.
  const [calibration, setCalibration] = useState<TagPrinterCalibration>(loadCalibration)

  const dostawca = (suppliers.data ?? []).find(s => s.id === reception.data?.supplierId)

  /** Wyślij ciąg zadań na drukarkę etykiet; komunikat błędu tłumaczy sonda. */
  const send = useCallback(async (jobs: string[], ok: string) => {
    setPrinting(true)
    setMessage(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona i podłączona do tego komputera.')
      for (const zpl of jobs) await sendZpl(dev, zpl)
      setMessage({ ok: true, text: ok })
    } catch (e: any) {
      // Zwykle to nie błąd druku, tylko brak/zablokowana usługa BrowserPrint —
      // sonda mówi biuru wprost, co jest nie tak.
      const probe = await probeBrowserPrint()
      setMessage({
        ok: false,
        text: probe.ok
          ? (e?.message || 'Nie udało się wysłać na drukarkę')
          : (probe.reason ?? 'Brak połączenia z drukarką etykiet'),
      })
    } finally {
      setPrinting(false)
    }
  }, [])

  // UWAGA: druk NIE wysyła `~TA`.
  //
  // Punkt odrywania to nastawa TRWAŁA, zapisana w drukarce — ustawiona raz
  // (ręcznie na urządzeniu albo przyciskiem w panelu) ma tam zostać. Wysyłanie
  // go przed każdą serią kasowało tę nastawę wartością z ekranu: przy domyślnym
  // zerze każdy wydruk cichaczem robił `~TA000` i taśma stawała w innym miejscu
  // niż przez cały poprzedni rok (biuro 22.08.2026: „cięcie na wysokości numeru
  // przyjęcia"). Zmiana punktu odrywania idzie na drukarkę WYŁĄCZNIE wtedy, gdy
  // operator ruszy suwak — patrz `changeCalibration`.
  const print = useCallback((tags: ReceptionTagInput[]) => send(
    receptionTagsPrintJobs(tags, calibration),
    `Wysłano na drukarkę: ${tags.length} zawieszek`,
  ), [calibration, send])

  /** Zapisz nastawę stanowiska; zmianę punktu odrywania od razu na drukarkę,
   *  żeby biuro widziało efekt kroku, a nie dopiero przy następnej serii. */
  const changeCalibration = useCallback((next: TagPrinterCalibration) => {
    const zapisana = saveCalibration(next)
    // Porównanie PRZED setState, nie w updaterze: efekt uboczny w updaterze
    // React w trybie ścisłym odpala dwa razy (ta sama pułapka co kod 0099).
    const odrywanieZmienione = zapisana.tearOffMm !== calibration.tearOffMm
    setCalibration(zapisana)
    if (odrywanieZmienione) {
      void send([tearOffZpl(zapisana.tearOffMm)],
        `Punkt odrywania: ${zapisana.tearOffMm > 0 ? '+' : ''}${zapisana.tearOffMm} mm`)
    }
  }, [calibration.tearOffMm, send])

  const calibratePrinter = useCallback(() => void send(
    [CALIBRATE_ZPL],
    'Kalibracja uruchomiona — drukarka wypuści kilka etykiet i zmierzy taśmę.',
  ), [send])

  const testPrint = useCallback(() => void send(
    [calibrationTestZpl(calibration)],
    'Wydruk testowy wysłany — sprawdź, czy ramka mieści się w całości na etykiecie.',
  ), [calibration, send])

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
      calibration={calibration}
      onCalibrationChange={changeCalibration}
      onCalibratePrinter={calibratePrinter}
      onTestPrint={testPrint}
    />
  )
}
