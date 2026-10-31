/**
 * Zawieszki palet przyjęcia — czysta logika (bez Reacta), reguły 1:1 ze starego
 * MES (`features/raw-batches/components/ReceptionTags.tsx`): rachunek palet robi
 * `planPalletTags`, ZPL składa `receptionTagZpl`. Tu tylko ustawienia ekranu
 * (kaliber, układ palety) i złożenie danych jednej zawieszki.
 *
 * Ekran nic nie zapisuje w księdze — druk można powtarzać do skutku. Jedyny
 * zapis to opcjonalne zapamiętanie układu palety u dostawcy.
 */
import { DEFAULT_CONTAINERS_PER_PALLET, planPalletTags, type PalletTagPlan } from '@/features/raw-batches/palletTags'
import type { ReceptionTagInput } from '@/features/raw-batches/receptionTagZpl'
import type { Reception, ReceptionBatch } from '@/features/raw-batches/types'

/** Układy, których używają dostawcy: 9 albo 8 pojemników na warstwę × 4 warstwy. */
export const UKLADY = [{ naWarstwe: 9, perPallet: 36 }, { naWarstwe: 8, perPallet: 32 }] as const

export interface Ustawienie {
  containerKg: number | null
  perPallet: number
  /** Liczba pojemników przeliczona ręcznie na rampie — obowiązuje, dopóki biuro nie zmieni kalibru. */
  reczneLiczenie: boolean
}

export interface WierszZawieszek { batch: ReceptionBatch; ustawienie: Ustawienie; plan: PalletTagPlan }

/** Anulowany numer porządkowy nie pojechał do chłodni — zawieszka byłaby na paletę, której nie ma. */
export const numeryDoZawieszek = (r: Reception) => r.batches.filter(b => b.status !== 'cancelled')

export const ustawieniePoczatkowe = (b: ReceptionBatch, uklad: number): Ustawienie => ({
  containerKg: b.containerKg ?? null,
  perPallet: uklad || DEFAULT_CONTAINERS_PER_PALLET,
  reczneLiczenie: b.containersCount != null,
})

export function wierszeZawieszek(r: Reception, ustawienia: Record<string, Ustawienie>, uklad: number): WierszZawieszek[] {
  return numeryDoZawieszek(r).map(b => {
    const u = ustawienia[b.id] ?? ustawieniePoczatkowe(b, uklad)
    return {
      batch: b, ustawienie: u,
      plan: planPalletTags({
        batchNo: b.internalBatchNo, kg: b.kgReceived, containerKg: u.containerKg,
        // Zmiana kalibru unieważnia ręczne liczenie — wtedy biuro pyta właśnie o przeliczenie na nowo.
        containersCount: u.reczneLiczenie ? b.containersCount : null,
        containersPerPallet: u.perPallet,
      }),
    }
  })
}

/** Zawieszki jednego numeru porządkowego, gotowe do ZPL. */
export function zawieszkiWiersza(r: Reception, w: WierszZawieszek): ReceptionTagInput[] {
  return w.plan.tags.map(t => ({
    receptionNo: r.receptionNo,
    supplierName: r.supplierName,
    batchNo: t.batchNo,
    netKg: t.netKg,
    containers: t.containers,
    containerKg: w.ustawienie.containerKg,
    palletIndex: t.palletIndex,
    palletCount: t.palletCount,
    batchKg: w.batch.kgReceived,
    // Loty z HDI (przy partii łączonej z kilogramami każdego), a bez HDI — numer wpisany na przyjęciu.
    supplierLots: (w.batch.supplierBatches ?? []).length > 0
      ? w.batch.supplierBatches.map(sb => ({ no: sb.supplierBatchNo, kg: sb.kgReceived }))
      : [{ no: w.batch.supplierBatchNo }],
    slaughterDate: w.batch.slaughterDate,
    expiryDate: w.batch.expiryDate,
    receivedDate: w.batch.receivedDate || r.receivedDate,
    full: t.full,
  }))
}
