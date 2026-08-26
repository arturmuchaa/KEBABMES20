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
import { getDevices, probeBrowserPrint, sendThenReadZpl, sendZpl } from '@/lib/zebra'

import { LABEL_H_MM } from '@/features/deboning/byproductLabelZpl'

import { ReceptionTags } from '../components/ReceptionTags'
import { DEFAULT_CONTAINERS_PER_PALLET } from '../palletTags'
import {
  IDENTIFY_ZPL, PRINT_CONFIG_ZPL, SET_ZPL_MODE, STATUS_ZPL,
  epLModeSuspected, parsePrinterIdentity, parsePrinterStatus, printerSummary,
} from '../printerStatus'
import type { ReceptionTagInput } from '../receptionTagZpl'
import { receptionTagsPrintJobs, tagPrintDelayMs } from '../receptionTagsPrint'

/** Czekanie między zawieszkami — patrz komentarz w `send`. */
const pauza = (ms: number) => new Promise<void>(res => setTimeout(res, ms))
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
  // Surowa odpowiedź drukarki — pokazujemy ją tak, jak przyszła.
  const [printerInfo, setPrinterInfo] = useState<string | null>(null)
  // Długość etykiety ZMIERZONA przez drukarkę; to ona rozstrzyga spór o skok taśmy.
  const [printerLabelLengthMm, setPrinterLabelLengthMm] = useState<number | null>(null)
  const [eplPodejrzenie, setEplPodejrzenie] = useState(false)

  const dostawca = (suppliers.data ?? []).find(s => s.id === reception.data?.supplierId)

  /** Wyślij ciąg zadań na drukarkę etykiet; komunikat błędu tłumaczy sonda. */
  const send = useCallback(async (jobs: string[], ok: string) => {
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
      for (let i = 0; i < jobs.length; i++) {
        await sendZpl(dev, jobs[i])
        if (i < jobs.length - 1) await pauza(tagPrintDelayMs(calibration.labelLengthMm))
      }
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

  /** Trwałe przestawienie drukarki na ZPL — raz na drukarkę. */
  const setZplMode = useCallback(() => void send(
    [SET_ZPL_MODE],
    'Wysłano przestawienie na ZPL. Wyłącz i włącz drukarkę, potem odczytaj ustawienia ponownie.',
  ), [send])

  const calibratePrinter = useCallback(() => void send(
    [CALIBRATE_ZPL],
    'Kalibracja uruchomiona — drukarka wypuści kilka etykiet i zmierzy taśmę.',
  ), [send])

  const testPrint = useCallback(() => void send(
    [calibrationTestZpl(calibration)],
    'Wydruk testowy wysłany — sprawdź, czy ramka mieści się w całości na etykiecie.',
  ), [calibration, send])

  /**
   * Zapytaj drukarkę o JEJ ustawienia zamiast zgadywać z tej strony.
   *
   * `^HH` odpadło: GC420t oddaje na nie pustkę (biuro 22.08.2026), choć zapis
   * działa. Stara seria G zna komendy natychmiastowe `~HI` i `~HS`, a `~HS`
   * niesie DŁUGOŚĆ ETYKIETY w punktach — jedyną liczbę, która rozstrzyga, czy
   * drukarka i my mówimy o tej samej etykiecie. Gdy i to milczy, każemy jej
   * WYDRUKOWAĆ etykietę konfiguracyjną (`~WC`) — z papieru odczyta się zawsze.
   */
  const readPrinter = useCallback(async () => {
    setPrinting(true)
    setMessage(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet')

      const surowaId = await sendThenReadZpl(dev, IDENTIFY_ZPL).catch(() => '')
      const surowyStatus = await sendThenReadZpl(dev, STATUS_ZPL).catch(() => '')

      const identity = parsePrinterIdentity(surowaId)
      const status = parsePrinterStatus(surowyStatus)
      const podsumowanie = printerSummary(identity, status, calibration.labelLengthMm)
      setPrinterLabelLengthMm(status.labelLengthMm)

      if (podsumowanie.length === 0) {
        // Drukarka nie gada — niech wydrukuje konfigurację na taśmie.
        setPrinterLabelLengthMm(null)
        await sendZpl(dev, PRINT_CONFIG_ZPL)
        setPrinterInfo(
          'Drukarka nie odpowiada na pytania (stary firmware).\n'
          + 'Wysłałem polecenie wydruku etykiety konfiguracyjnej — wyjdzie z drukarki.\n'
          + 'Szukaj na niej wiersza LABEL LENGTH i porównaj go z 80 mm.',
        )
        setMessage({ ok: true, text: 'Drukarka wypuści etykietę z konfiguracją' })
        return
      }

      // Milczące `~HI` przy działającym `~HS` znaczy, że drukarka stoi
      // w EPL — wtedy trwałe nastawy ZPL (punkt odrywania, śledzenie taśmy)
      // przechodzą bez echa i biuro widzi „wpisane, a nic nie zmienia".
      const epl = epLModeSuspected({ identify: surowaId, status: surowyStatus })
      setEplPodejrzenie(epl)
      setPrinterInfo([
        ...podsumowanie,
        ...(epl ? [
          '',
          '⚠ Drukarka pracuje w trybie EPL, nie ZPL.',
          'Formaty jeszcze się drukują, ale punkt odrywania i śledzenie taśmy',
          'nie mają się gdzie zapisać — stąd urwane etykiety i czerwona kontrolka.',
          'Kliknij „Przestaw na ZPL" — to nastawa trwała, raz na drukarkę.',
        ] : []),
        '',
        `~HI: ${surowaId.trim() || '(brak odpowiedzi)'}`,
        `~HS: ${surowyStatus.trim() || '(brak odpowiedzi)'}`,
      ].join('\n'))
      setMessage({ ok: true, text: 'Odczytano ustawienia drukarki' })
    } catch (e: any) {
      setPrinterInfo(null)
      setPrinterLabelLengthMm(null)
      setMessage({ ok: false, text: e?.message || 'Nie udało się odczytać ustawień drukarki' })
    } finally {
      setPrinting(false)
    }
  }, [])

  /** Przenieś ZMIERZONĄ przez drukarkę długość etykiety do nastawy stanowiska.
   *  Spór o skok taśmy rozstrzyga drukarka, nie nasza stała 80 mm: po `~JC`
   *  zmierzyła 658 pkt (82,3 mm), a my wysyłaliśmy 639 — i te 2,4 mm różnicy
   *  wypychały odrywanie dokładnie na nagłówek następnej zawieszki. */
  const applyPrinterLabelLength = useCallback(() => {
    if (printerLabelLengthMm === null) return
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
      onReadPrinter={readPrinter}
      printerInfo={printerInfo}
      printerLabelLengthMm={printerLabelLengthMm}
      onApplyPrinterLabelLength={applyPrinterLabelLength}
    />
  )
}
