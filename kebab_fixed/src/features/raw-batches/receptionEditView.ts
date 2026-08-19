import type { HdiLine, ReceptionGroup } from './receptionSplit'
import type { ReceptionHeader } from './types'

/**
 * Dostawa z API ↔ stan pełnego formularza przyjęcia.
 *
 * POWÓD ISTNIENIA: edycja dostawy otwierała modal na osiem pól, choć
 * rejestracja ma pełny formularz z pozycjami HDI i podziałem na numery
 * porządkowe. Poprawienie czegokolwiek poza nagłówkiem wymagało więc
 * anulowania dostawy i wpisania jej od nowa — z nowym numerem i drugim
 * dokumentem (prod 2026-08-19: dwa dokumenty KOKO na jedną dostawę).
 *
 * Mapowanie jest czystą funkcją, żeby dało się je sprawdzić testem bez DOM-u:
 * to tu ginęły dotąd kilogramy pozycji HDI przy rozjeździe nazw pól.
 */

export interface EditableDelivery {
  header: ReceptionHeader
  groups: ReceptionGroup[]
  /** Powód zamrożenia per `batchId` — formularz wyszarza po nim wiersz. */
  frozen: Record<string, string>
}

export interface UpdateReceptionDto {
  receivedDate:   string
  materialTypeId: string
  documentNo:     string
  hdiNo:          string
  notes:          string
  pricePerKg:     number
  groups: {
    batchId?:         string
    internalBatchNo?: string
    kgReceived:       number
    supplierBatches: {
      supplierBatchNo: string
      kgReceived:      number
      slaughterDate:   string
      expiryDate:      string
    }[]
    slaughterDate?:    string
    expiryDate?:       string
    containerKg?:      number | null
    containersCount?:  number | null
    palletsH1?:        number
    palletsOther?:     number
    palletsOtherKind?: string | null
  }[]
}

const num = (v: unknown, dflt = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export function documentToForm(rec: any): EditableDelivery {
  const batches: any[] = rec?.batches ?? []
  const frozen: Record<string, string> = {}
  const groups: ReceptionGroup[] = batches.map((b, i) => {
    if (b?.frozenReason) frozen[b.id] = String(b.frozenReason)
    const lines: HdiLine[] = (b?.supplierBatches ?? []).map((l: any) => ({
      supplierBatchNo: String(l?.supplierBatchNo ?? ''),
      kgReceived:      num(l?.kg ?? l?.kgReceived),
      slaughterDate:   String(l?.slaughterDate ?? ''),
      expiryDate:      String(l?.expiryDate ?? ''),
      group:           i,
    }))
    return {
      index: i,
      kg: num(b?.kgReceived),
      lines,
      supplierNos: lines.map(l => l.supplierBatchNo).filter(Boolean),
      slaughterDate: String(b?.slaughterDate ?? lines[0]?.slaughterDate ?? ''),
      expiryDate:    String(b?.expiryDate ?? lines[0]?.expiryDate ?? ''),
      batchNo: String(b?.internalBatchNo ?? ''),
      // Numer istniejącej pozycji NIE jedzie jako „ręczna poprawka" — partia
      // już go ma. sendBatchNo wypełnia dopiero ołówek.
      containersCount: b?.containersCount ?? null,
      batchId: b?.id,
    }
  })

  const pierwsza = batches[0] ?? {}
  return {
    header: {
      receptionNo:      String(rec?.receptionNo ?? ''),
      receivedDate:     String(rec?.receivedDate ?? ''),
      supplierId:       String(rec?.supplierId ?? ''),
      materialTypeId:   String(pierwsza?.materialTypeId ?? ''),
      documentNo:       String(rec?.documentNo ?? ''),
      hdiNo:            String(rec?.hdiNo ?? ''),
      hdiScanId:        '',
      docKg:            num(rec?.docKg),
      docContainers:    num(rec?.docContainers),
      pricePerKg:       num(pierwsza?.pricePerKg),
      containerKg:      pierwsza?.containerKg ?? null,
      palletsH1:        num(pierwsza?.palletsH1),
      palletsOther:     num(pierwsza?.palletsOther),
      palletsOtherKind: String(pierwsza?.palletsOtherKind ?? ''),
      isService:        Boolean(rec?.isService),
      notes:            String(rec?.notes ?? ''),
    },
    groups,
    frozen,
  }
}

export function formToUpdatePayload(
  header: ReceptionHeader, groups: ReceptionGroup[],
): UpdateReceptionDto {
  return {
    receivedDate:   header.receivedDate,
    materialTypeId: header.materialTypeId,
    documentNo:     header.documentNo,
    hdiNo:          header.hdiNo,
    notes:          header.notes,
    pricePerKg:     header.pricePerKg,
    // Grupa zdjęta przez operatora po prostu nie wchodzi do żądania — backend
    // wnioskuje z jej braku, że numer ma zostać zdjęty z dokumentu.
    groups: groups.map(g => ({
      batchId: g.batchId,
      internalBatchNo: g.sendBatchNo || (g.batchId ? undefined : g.batchNo) || undefined,
      kgReceived: g.kg,
      supplierBatches: g.lines.map(l => ({
        supplierBatchNo: l.supplierBatchNo,
        kgReceived:      l.kgReceived,
        slaughterDate:   l.slaughterDate,
        expiryDate:      l.expiryDate,
      })),
      slaughterDate:   g.slaughterDate || undefined,
      expiryDate:      g.expiryDate || undefined,
      containersCount: g.containersCount ?? null,
    })),
  }
}

/**
 * Grupy z powrotem na wiersze, którymi żyje formularz (`lines` + `groupCount`).
 *
 * Numer porządkowy wpisany BEZ rozpisywania pozycji HDI — a takich jest
 * większość — nie ma żadnego wiersza, a kilogramy grupy liczą się właśnie
 * z wierszy. Bez wiersza zastępczego taka pozycja wróciłaby z formularza
 * z zerem i edycja „bez zmian" wyzerowałaby dostawę.
 */
export function groupsToLines(groups: ReceptionGroup[]): HdiLine[] {
  return groups.flatMap((g, i) => (
    g.lines.length > 0
      ? g.lines.map(l => ({ ...l, group: i }))
      : [{
          supplierBatchNo: '',
          kgReceived:      g.kg,
          slaughterDate:   g.slaughterDate,
          expiryDate:      g.expiryDate,
          group:           i,
        }]
  ))
}

/**
 * Przywraca powiązanie grupy z partią po indeksie.
 *
 * Formularz przelicza grupy z wierszy przy każdej zmianie i `batchId` mu przy
 * tym ginie — a bez niego backend potraktowałby istniejące pozycje jako
 * dołożone i założył drugi komplet numerów porządkowych.
 */
export function withBatchIds(
  groups: ReceptionGroup[], ids: (string | undefined)[],
): ReceptionGroup[] {
  return groups.map((g, i) => ({ ...g, batchId: ids[i] }))
}
