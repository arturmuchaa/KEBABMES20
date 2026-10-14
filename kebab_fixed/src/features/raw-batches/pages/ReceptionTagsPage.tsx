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
import { useCallback, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useApi } from '@/hooks/useApi'
import { receptionsApi, suppliersApi } from '@/lib/apiClient'
import { getDevices, probeBrowserPrint, readZebraStatus, sendZplJobs, withZebraPrinter, zebraErrorMessage } from '@/lib/zebra'
import { ZebraPrinterPanel } from '@/components/ZebraPrinterPanel'

import { ReceptionTags } from '../components/ReceptionTags'
import { DEFAULT_CONTAINERS_PER_PALLET } from '../palletTags'
import {
  IDENTIFY_ZPL, parsePrinterIdentity, printerSummary,
} from '../printerStatus'
import type { ReceptionTagInput } from '../receptionTagZpl'
import { receptionTagsPrintJobs, tagPrintDelayMs } from '../receptionTagsPrint'

import {
  calibrationTestZpl, LABEL_LENGTH_MIN_MM, LABEL_LENGTH_MAX_MM, loadCalibration, saveCalibration,
  tearOffZpl, type TagPrinterCalibration,
} from '../tagPrinterCalibration'

const LIST_PATH = '/office/raw-batches'

export function ReceptionTagsPage() {
  const { receptionId = '' } = useParams()
  const navigate = useNavigate()

  const reception = useApi(() => receptionsApi.byId(receptionId), [receptionId])
  const suppliers = useApi(() => suppliersApi.list())

  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  const [printerBusy, setPrinterBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // Nastawa jest cechą TEGO stanowiska (drukarka + rolka), więc czytamy ją z
  // localStorage, a nie z bazy — drugie biurko ma inną drukarkę.
  const [calibration, setCalibration] = useState<TagPrinterCalibration>(loadCalibration)
  // Surowa odpowiedź drukarki — pokazujemy ją tak, jak przyszła.
  const [printerInfo, setPrinterInfo] = useState<string | null>(null)
  // Długość etykiety ZMIERZONA przez drukarkę; to ona rozstrzyga spór o skok taśmy.
  const [printerLabelLengthMm, setPrinterLabelLengthMm] = useState<number | null>(null)

  const dostawca = (suppliers.data ?? []).find(s => s.id === reception.data?.supplierId)

  /** Wyślij ciąg zadań na drukarkę etykiet; komunikat błędu tłumaczy sonda. */
  const send = useCallback(async (jobs: string[], ok: string) => {
    if (printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    setMessage(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona i podłączona do tego komputera.')
      // Przerwa MIĘDZY zawieszkami, nie po ostatniej: BrowserPrint oddaje
      // sterowanie w chwili przekazania danych, więc bez niej cała seria
      // ląduje w buforze naraz i GC420t dojeżdża do punktu odrywania dopiero
      // po ostatniej etykiecie — wcześniejsze biuro odrywało w poprzek
      // (zgłoszenie 26.08.2026).
      await sendZplJobs(dev, jobs, {
        delayMs: tagPrintDelayMs(calibration.labelLengthMm),
        onProgress: (sent, total) => setMessage({ ok: true, text: `Przekazano do BrowserPrint: ${sent}/${total} zadań…` }),
      })
      setMessage({ ok: true, text: ok })
    } catch (e: any) {
      // Zwykle to nie błąd druku, tylko brak/zablokowana usługa BrowserPrint —
      // sonda mówi biuru wprost, co jest nie tak.
      const probe = await probeBrowserPrint()
      setMessage({
        ok: false,
        text: `${zebraErrorMessage(e)}${!probe.ok && probe.reason ? ` ${probe.reason}` : ''}`,
      })
    } finally {
      setPrinting(false)
      printingRef.current = false
    }
  }, [calibration.labelLengthMm])

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

  const testPrint = useCallback(() => void send(
    [calibrationTestZpl(calibration)],
    'Wydruk testowy wysłany — sprawdź, czy ramka mieści się w całości na etykiecie.',
  ), [calibration, send])

  /**
   * Zapytaj drukarkę o JEJ ustawienia zamiast zgadywać z tej strony.
   *
   * `^HH` odpadło: GC420t oddaje na nie pustkę (biuro 22.08.2026), choć zapis
   * działa. Stara seria G zna komendy natychmiastowe `~HI` i `~HS`, a `~HS`
   * niesie DŁUGOŚĆ ETYKIETY w punktach. Brak odpowiedzi nie potwierdza
   * gotowości i nie uruchamia automatycznie kolejnego wydruku.
   */
  const readPrinter = useCallback(async () => {
    if (printingRef.current) return
    printingRef.current = true
    setPrinting(true)
    setMessage(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet')

      const { surowaId, status, surowyStatus } = await withZebraPrinter(dev, async io => {
        const surowaId = await io.read(IDENTIFY_ZPL)
        const result = await readZebraStatus(io)
        return { surowaId, status: result.status, surowyStatus: result.raw }
      })
      const identity = parsePrinterIdentity(surowaId)
      const podsumowanie = printerSummary(identity, status, calibration.labelLengthMm)
      setPrinterLabelLengthMm(status.valid ? status.labelLengthMm : null)

      setPrinterInfo([
        ...podsumowanie,
        ...(!status.valid ? ['Brak pełnego statusu. Sprawdź zieloną kontrolkę, papier, pokrywę i USB.'] : []),
        '',
        `~HI: ${surowaId.trim() || '(brak odpowiedzi)'}`,
        `~HS: ${surowyStatus.trim() || '(brak odpowiedzi)'}`,
      ].join('\n'))
      setMessage({ ok: status.valid, text: status.valid ? 'Odczytano ustawienia drukarki' : 'Nie otrzymano pełnego statusu drukarki' })
    } catch (e: any) {
      setPrinterInfo(null)
      setPrinterLabelLengthMm(null)
      setMessage({ ok: false, text: e?.message || 'Nie udało się odczytać ustawień drukarki' })
    } finally {
      setPrinting(false)
      printingRef.current = false
    }
  }, [calibration.labelLengthMm])

  /** Przenieś ZMIERZONĄ przez drukarkę długość etykiety do nastawy stanowiska.
   *  Spór o skok taśmy rozstrzyga drukarka, nie nasza stała 100 mm: po `~JC`
   *  zmierzyła 658 pkt (82,3 mm), a my wysyłaliśmy 639 — i te 2,4 mm różnicy
   *  wypychały odrywanie dokładnie na nagłówek następnej zawieszki. */
  const applyPrinterLabelLength = useCallback(() => {
    if (printerLabelLengthMm === null) return
    if (printerLabelLengthMm < LABEL_LENGTH_MIN_MM || printerLabelLengthMm > LABEL_LENGTH_MAX_MM) {
      toast.error('Odczyt nie pasuje do zawieszki 80 × 100 mm. Sprawdź rolkę i kalibrację.')
      return
    }
    changeCalibration({ ...calibration, labelLengthMm: printerLabelLengthMm })
    toast.success(`Skok taśmy z drukarki: ${String(printerLabelLengthMm).replace('.', ',')} mm`)
  }, [printerLabelLengthMm, calibration, changeCalibration])

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
    <div className="space-y-4">
    <ZebraPrinterPanel defaultProfile="80x100" disabled={printing} onBusyChange={setPrinterBusy}
      onCalibrated={(profile, mm) => { if (profile === '80x100') setPrinterLabelLengthMm(mm) }} />
    <ReceptionTags
      reception={reception.data}
      defaultContainersPerPallet={dostawca?.containersPerPallet ?? DEFAULT_CONTAINERS_PER_PALLET}
      onPrint={print}
      onRememberLayout={dostawca ? rememberLayout : undefined}
      onClose={() => navigate(LIST_PATH)}
      printing={printing || printerBusy}
      message={message}
      calibration={calibration}
      onCalibrationChange={changeCalibration}
      onTestPrint={testPrint}
      onReadPrinter={readPrinter}
      printerInfo={printerInfo}
      printerLabelLengthMm={printerLabelLengthMm}
      onApplyPrinterLabelLength={applyPrinterLabelLength}
    />
    </div>
  )
}
