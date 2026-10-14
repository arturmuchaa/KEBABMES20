import { parsePrinterIdentity, printerProblems, printerSummary } from '@/features/raw-batches/printerStatus'
import { readZebraStatus, withZebraPrinter, zebraWait, type ZebraDevice } from './zebra'
import { beginZebraCalibration, rememberZebraMedia, ZEBRA_PROFILES, zebraMediaSetupZpl, type ZebraProfileId } from './zebraProfiles'

export async function readZebraDiagnostics(device: ZebraDevice, profile: ZebraProfileId) {
  return withZebraPrinter(device, async io => {
    const identityRaw = await io.read('~HI')
    const identity = parsePrinterIdentity(identityRaw)
    const { status, raw } = await readZebraStatus(io)
    return [
      ...printerSummary(identity, status, ZEBRA_PROFILES[profile].height),
      ...(!status.valid ? ['Brak pełnego statusu. Sprawdź zieloną kontrolkę, papier, pokrywę i USB.'] : []),
      `~HI: ${identityRaw.trim() || '(brak odpowiedzi)'}`,
      `~HS: ${raw.trim() || '(brak odpowiedzi)'}`,
    ].join('\n')
  })
}

/** Nie ustawiamy ^LL przed pomiarem ani nie drukujemy testu automatycznie.
 * ~HS nie ma flagi „kalibracja zakończona”; czekamy na dwa stabilne, pełne,
 * bezbłędne odczyty po minimalnym czasie wysuwania taśmy. Papier ocenia operator. */
export async function calibrateZebra(device: ZebraDevice, profile: ZebraProfileId,
  onProgress: (text: string) => void = () => {}) {
  return withZebraPrinter(device, async io => {
    if (!device.sendThenRead) throw new Error('Kalibracja z kontrolą wyniku wymaga odczytu BrowserPrint. Zaktualizuj BrowserPrint na stanowisku.')
    const identity = parsePrinterIdentity(await io.read('~HI'))
    if (identity.dpi && identity.dpi !== 203) throw new Error(`Drukarka zgłasza ${identity.dpi} dpi. Te profile są przeznaczone dla GC420t 203 dpi.`)
    const before = await readZebraStatus(io)
    if (before.status.valid && (before.status.formatsInBuffer || before.status.labelsRemaining)) {
      throw new Error('Drukarka ma jeszcze zadania w buforze. Poczekaj na zakończenie wydruków przed zmianą rolki.')
    }
    // Zapisujemy deklarację założonej rolki również przy nieudanej kalibracji:
    // stary profil nie może pozwolić drukować 100×150 na nowej rolce 50×80.
    beginZebraCalibration(device.uid, profile)
    onProgress('Ustawiam czujnik przerwy i druk bez kalki…')
    await io.send(zebraMediaSetupZpl(profile))
    await io.send('~JC')
    onProgress('Trwa kalibracja — poczekaj, drukarka wysuwa etykiety. Sprawdzam odczyty…')
    await zebraWait(5000)
    const deadline = Date.now() + 30000
    let previous: number | null = null
    let last = 'Brak pełnej odpowiedzi drukarki.'
    while (Date.now() < deadline) {
      const { status } = await readZebraStatus(io)
      const problems = printerProblems(status)
      if (status.valid && problems.length) throw new Error(problems.join(' '))
      if (status.valid && !status.formatsInBuffer && !status.labelsRemaining) {
        const mm = status.labelLengthMm!
        const height = ZEBRA_PROFILES[profile].height
        const matches = mm >= height - 2 && mm <= height + 10 // przerwa i zaokrąglenie czujnika
        last = `Drukarka zgłasza ${mm} mm, wybrana etykieta ma ${height} mm długości.`
        if (previous === status.labelLengthDots && matches) {
          rememberZebraMedia(device.uid, profile)
          return { lengthMm: mm, message: `${last} Odczyt jest stabilny. Wydrukuj jedną etykietę testową i sprawdź ramkę oraz zatrzymanie na przerwie.` }
        }
        previous = status.labelLengthDots
      } else { previous = null }
      await zebraWait(1000)
    }
    throw new Error(`Nie potwierdzono wyniku kalibracji. ${last} Sprawdź założenie rolki, prowadnice i czujnik; potem powtórz kalibrację.`)
  })
}
