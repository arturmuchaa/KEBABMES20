/**
 * Formularz przyjęcia surowca (nowe + edycja) — stan i mapowanie bez Reacta.
 *
 * Reguły podziału dostawy, numerów porządkowych i kontroli z HDI NIE są tu
 * pisane od nowa: biorą je moduły starego MES (`receptionSplit`,
 * `receptionEditView`, `validateReception`). Tu jest tylko to, co łączy je
 * w jeden formularz PROTRIMA, i DTO zapisu identyczne ze starym hookiem
 * `useCreateReception` (backend przyjmuje oba kształty tymi samymi aliasami).
 */
import {
  groupLines, nextSupplierBatchNo, ordinalLabels, ordinalsToSend, withContainers,
  type HdiLine, type ReceptionGroup,
} from '@/features/raw-batches/receptionSplit'
import { documentToForm, formToUpdatePayload, groupsToLines, withBatchIds, type UpdateReceptionDto } from '@/features/raw-batches/receptionEditView'
import { containersForKg } from '@/lib/containers'
import type { CreateReceptionDto, ReceptionHeader } from '@/features/raw-batches/types'

/** Usługa dotyczy WYŁĄCZNIE mięsa z/s — tylko ono bywa powierzone przez klienta. */
export const SERVICE_MATERIAL_ID = 'mat-mieso-zs'
/** Domyślny termin przydatności od uboju (jak stary formularz). */
export const DNI_WAZNOSCI = 7

const p2 = (n: number) => String(n).padStart(2, '0')
const isoLok = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** Dzisiejsza data w czasie LOKALNYM — `toISOString()` po północy dawał wczoraj. */
export const dzisIso = (d = new Date()) => isoLok(d)
export function plusDni(iso: string, dni: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  return isoLok(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dni))
}

export interface FormPrzyjecia {
  header: ReceptionHeader
  lines: HdiLine[]
  groupCount: number
  /** Numer porządkowy poprawiony ołówkiem — po indeksie grupy. */
  ordinalOverride: Record<number, string>
  /** Ręcznie przeliczone pojemniki — po indeksie grupy; null = z kalibru. */
  containerOverride: Record<number, number | null>
  /** Edycja: partia, którą JEST grupa (po indeksie). Pusty = pozycja dołożona. */
  batchIds: (string | undefined)[]
  /** Edycja: numery nadane dokumentowi (po indeksie). */
  numeryDokumentu: string[]
}

export function pustyNaglowek(dzis: string, materialTypeId = 'mat-cwiartka'): ReceptionHeader {
  return {
    receptionNo: '', receivedDate: dzis, supplierId: '',
    materialTypeId, documentNo: '', hdiNo: '', hdiScanId: '',
    docKg: 0, docContainers: 0, pricePerKg: 0,
    // Domyślny kaliber zakładu to pojemnik 15 kg — 20 kg zdarza się przy filecie.
    containerKg: 15, palletsH1: 0, palletsOther: 0, palletsOtherKind: 'net_e1',
    isService: false, notes: '',
    storageState: 'chlodzony',
  }
}

export function pustaPozycja(dzis: string, group = 0): HdiLine {
  return { supplierBatchNo: '', kgReceived: 0, slaughterDate: dzis, expiryDate: plusDni(dzis, DNI_WAZNOSCI), group }
}

/**
 * Kolejny wiersz HDI podpowiadany z poprzedniego: te same daty i numer partii +1.
 * Na HDI od KOKO osiem pozycji ma te same daty i kolejne numery; wagę operator
 * wpisuje zawsze, bo tylko ona naprawdę różni pozycje.
 */
export function kolejnaPozycja(prev: HdiLine | undefined, dzis: string, group = prev?.group ?? 0): HdiLine {
  if (!prev) return pustaPozycja(dzis, group)
  return { supplierBatchNo: nextSupplierBatchNo(prev.supplierBatchNo), kgReceived: 0, slaughterDate: prev.slaughterDate, expiryDate: prev.expiryDate, group }
}

/** Zmiana daty uboju przesuwa ważność — termin liczy się od uboju. */
export function zmianaUboju(l: HdiLine, slaughter: string): HdiLine {
  return { ...l, slaughterDate: slaughter, expiryDate: slaughter ? plusDni(slaughter, DNI_WAZNOSCI) : l.expiryDate }
}

export function nowyFormularz(dzis: string, materialTypeId?: string): FormPrzyjecia {
  return {
    header: pustyNaglowek(dzis, materialTypeId), lines: [pustaPozycja(dzis)], groupCount: 1,
    ordinalOverride: {}, containerOverride: {}, batchIds: [], numeryDokumentu: [],
  }
}

/** Zapisana dostawa (odpowiedź `receptionsApi.byId`) → formularz + powody zamrożenia. */
export function zDokumentu(rec: unknown): { f: FormPrzyjecia; frozen: Record<string, string> } {
  const { header, groups, frozen } = documentToForm(rec)
  return {
    frozen,
    f: {
      header,
      // Numer porządkowy bez rozpisanych pozycji HDI dostaje wiersz zastępczy —
      // inaczej zapis „bez zmian” wyzerowałby jego kilogramy.
      lines: groupsToLines(groups),
      groupCount: Math.max(1, groups.length),
      ordinalOverride: {},
      // Ręcznie przeliczone pojemniki wracają jako nadpisania (saldo nośników
      // dostawcy nie może się po cichu wyrównać do wzoru przy edycji).
      containerOverride: Object.fromEntries(groups.flatMap((g, i) => (g.containersCount == null ? [] : [[i, g.containersCount]]))),
      batchIds: groups.map(g => g.batchId),
      numeryDokumentu: groups.map(g => g.batchNo ?? ''),
    },
  }
}

/** Numery, które grupy dostaną (nowe) albo mają (edycja; dołożona = „nowy”). */
export function numeryGrup(f: FormPrzyjecia, edycja: boolean, suggestedBatchNo: string): string[] {
  return edycja
    ? Array.from({ length: f.groupCount }, (_, i) => f.ordinalOverride[i] ?? f.numeryDokumentu[i] ?? 'nowy')
    : ordinalLabels(suggestedBatchNo, f.groupCount, f.ordinalOverride)
}

/** Grupy do ekranu i do zapisu — jedno źródło liczby pojemników (kaliber albo przeliczenie). */
export function grupy(f: FormPrzyjecia, edycja: boolean, suggestedBatchNo: string): ReceptionGroup[] {
  const nos = numeryGrup(f, edycja, suggestedBatchNo)
  // Nowe: numery jadą tylko po poprawce ołówkiem (sekwencja jest źródłem prawdy).
  // Edycja: wyłącznie numer poprawiony na DOŁOŻONEJ pozycji — etykieta „nowy”
  // nie jest numerem i backend odrzuciłby ją („Numer partii musi być liczbą”).
  const send = edycja
    ? nos.map((n, i) => ((f.ordinalOverride[i] ?? '').trim() ? n : undefined))
    : ordinalsToSend(f.ordinalOverride, nos)
  const gs = withContainers(groupLines(f.lines, f.groupCount), f.header.containerKg ?? null, f.containerOverride, containersForKg)
    .map((g, i) => ({ ...g, batchNo: nos[i], sendBatchNo: send[i] }))
  // Formularz przelicza grupy z wierszy i gubi `batchId` — bez niego backend
  // uznałby istniejące pozycje za dołożone.
  return edycja ? withBatchIds(gs, f.batchIds) : gs
}

/** Grupa należy do pozycji użytej w produkcji — backend odrzuci jej zmianę. */
export const zamrozona = (f: FormPrzyjecia, frozen: Record<string, string>, group: number) => frozen[f.batchIds[group] ?? ''] ?? ''

/**
 * PUT /api/receptions/{id} — `formToUpdatePayload` starego MES z jedną poprawką:
 * dołożona pozycja bez ręcznego numeru NIE wysyła etykiety „nowy” (stary
 * formularz ją wysyłał i backend odrzucał zapis), tylko pusty numer → sekwencja.
 */
export function doEdycji(h: ReceptionHeader, groups: ReceptionGroup[]): UpdateReceptionDto {
  const dto = formToUpdatePayload(h, groups)
  return { ...dto, groups: dto.groups.map((g, i) => ({ ...g, internalBatchNo: groups[i].sendBatchNo || undefined })) }
}

/** POST /api/receptions — ten sam kształt co `useCreateReception.confirmSubmit`. */
export function doUtworzenia(h: ReceptionHeader, groups: ReceptionGroup[]): CreateReceptionDto {
  const usluga = h.isService && h.materialTypeId === SERVICE_MATERIAL_ID
  return {
    receptionNo: h.receptionNo,
    receivedDate: h.receivedDate,
    supplierId: h.supplierId,
    materialTypeId: h.materialTypeId,
    documentNo: h.documentNo,
    hdiNo: h.hdiNo,
    hdiScanId: h.hdiScanId,
    // 0 = pole niewypełnione; null, żeby „nie podano” nie udawało zera kg.
    docKg: h.docKg || null,
    docContainers: h.docContainers || null,
    pricePerKg: h.pricePerKg,
    notes: h.notes,
    isService: usluga,
    storageState: h.storageState,
    groups: groups.map((g, i) => ({
      // Pusty = numer nadaje sekwencja backendu; wypełniony tylko po poprawce ołówkiem.
      internalBatchNo: g.sendBatchNo,
      kgReceived: g.kg,
      slaughterDate: g.slaughterDate,
      expiryDate: g.expiryDate,
      supplierBatches: g.lines.map(l => ({
        supplierBatchNo: l.supplierBatchNo.trim(),
        kgReceived: l.kgReceived,
        slaughterDate: l.slaughterDate,
        expiryDate: l.expiryDate,
      })),
      containerKg: h.containerKg,
      containersCount: g.containersCount ?? null,
      // Palety liczy się na całą dostawę (saldo nośników per dostawca) —
      // wieszamy je na pierwszej grupie, żeby nie policzyć ich N razy.
      palletsH1: i === 0 ? h.palletsH1 : 0,
      palletsOther: i === 0 ? h.palletsOther : 0,
      palletsOtherKind: h.palletsOtherKind,
    })) as CreateReceptionDto['groups'],
  }
}

export interface SkanHdi {
  hdiNo: string; documentNo: string; shippedDate: string
  totalKg: number | null; containers: number | null; pallets: number | null
  scanId: string
  supplier: { id: string; name: string; matchedBy: string } | null
  lines: Array<{ supplierBatchNo: string; kgReceived: number; slaughterDate: string; expiryDate: string }>
}

/**
 * Odczyt skanu HDI → formularz. Wszystko ląduje w JEDNYM numerze porządkowym:
 * podział to decyzja operatora, której na dokumencie nie ma.
 */
export function zSkanu(f: FormPrzyjecia, scan: SkanHdi): FormPrzyjecia {
  const h = { ...f.header }
  if (scan.hdiNo) h.hdiNo = scan.hdiNo
  if (scan.documentNo) h.documentNo = scan.documentNo
  if (scan.shippedDate) h.receivedDate = scan.shippedDate
  if (scan.totalKg) h.docKg = scan.totalKg
  if (scan.containers) h.docContainers = scan.containers
  if (scan.pallets) h.palletsH1 = scan.pallets
  h.hdiScanId = scan.scanId
  // Dostawca tylko przy jednoznacznym rozpoznaniu — przy dwóch backend nie wybiera.
  if (scan.supplier) h.supplierId = scan.supplier.id
  return {
    ...f, header: h, groupCount: 1, containerOverride: {}, ordinalOverride: {},
    lines: scan.lines.map(l => ({ ...l, kgRaw: String(l.kgReceived).replace('.', ','), group: 0 })),
  }
}
