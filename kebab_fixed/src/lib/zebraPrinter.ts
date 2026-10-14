import { parsePrinterIdentity, printerSummary } from '@/features/raw-batches/printerStatus'
import { readZebraStatus, withZebraPrinter, type ZebraDevice } from './zebra'
import { ZEBRA_PROFILES, type ZebraProfileId } from './zebraProfiles'

export { calibrateZebra } from './zebra'

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
