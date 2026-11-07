/**
 * Rozbiór — korekty biura: czysta logika (bez Reacta).
 *
 * Stary MES (Panel rozbioru, `EntryFixDialogs`) miał „Popraw wpis”, „Zmień partię”
 * i „Usuń”, ale dla pobrań rozliczanych per pracownik (mięso → grzbiety → kości —
 * dziś cały rozbiór) serwer odmawiał wszystkiego poza usunięciem. Prod 07.11.2026:
 * pobranie na złym pracowniku dało się tylko usunąć i szukać jego wag w bazie.
 * Tu: zmiana pracownika działa na każdym rozliczonym wpisie (wagi zostają), usunięte
 * wpisy mają listę z wagami i „Przywróć” — także na innego pracownika.
 */

export type StanWpisu = 'rozliczony' | 'w_rozliczeniu' | 'czeka'

export interface WpisRozbioru {
  id: string
  rawBatchNo: string
  workerId: string
  workerName: string
  kgQuarter: number
  kgMeat: number
  kgBacks: number
  kgBones: number
  yieldPct: number
  /** Pobranie z rozliczeniem pracownika (mięso → grzbiety → kości). */
  rozliczeniePracownika: boolean
  stan: StanWpisu
  at: string
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export function mapujWpis(r: Record<string, unknown>): WpisRozbioru {
  const status = String(r.status ?? 'complete')
  const etap = r.settlementStage ? String(r.settlementStage) : ''
  return {
    id: String(r.id ?? ''),
    rawBatchNo: String(r.rawBatchNo ?? ''),
    workerId: String(r.workerId ?? ''),
    workerName: String(r.workerName ?? ''),
    kgQuarter: n(r.kgTaken ?? r.kgQuarter),
    kgMeat: n(r.kgMeat), kgBacks: n(r.kgBacks), kgBones: n(r.kgBones),
    yieldPct: n(r.yieldPct),
    rozliczeniePracownika: !!etap,
    stan: status === 'complete' ? 'rozliczony' : etap ? 'w_rozliczeniu' : 'czeka',
    at: String(r.completedAt || r.createdAt || ''),
  }
}

export const ETYKIETA_STANU: Record<StanWpisu, string> = {
  rozliczony: 'rozliczony', w_rozliczeniu: 'w rozliczeniu na hali', czeka: 'czeka na mięso',
}

/** Bilans wpisu: (mięso + grzbiety + kości) / ćwiartka — tylko gdy uboczne są przy wpisie. */
export function bilansWpisu(w: WpisRozbioru): number | null {
  if (w.stan !== 'rozliczony' || w.kgQuarter <= 0 || (w.kgBacks <= 0 && w.kgBones <= 0)) return null
  return ((w.kgMeat + w.kgBacks + w.kgBones) / w.kgQuarter) * 100
}

/** Co biuro może zrobić z wpisem — i dlaczego nie, gdy nie może (podpowiedź przy przycisku). */
export function akcjeWpisu(w: WpisRozbioru): { zmienPracownika: string | true; poprawKg: string | true; usun: true } {
  return {
    zmienPracownika: w.stan === 'rozliczony' ? true : 'Pobranie jest jeszcze rozliczane na hali — pracownika zmienisz po zakończeniu',
    poprawKg: w.stan !== 'rozliczony' ? 'Wpis nie jest jeszcze rozliczony'
      : w.rozliczeniePracownika ? 'Kilogramy rozliczonego pobrania poprawia korekta ważenia na hali — waga jest dowodem' : true,
    usun: true,
  }
}

export interface UsunietyWpis {
  id: string
  entryId: string
  deletedAt: string
  bySubject: string
  reason: string
  workerName: string
  rawBatchNo: string
  kgQuarter: number
  kgMeat: number
  kgBacks: number
  kgBones: number
  workDate: string
  restoredEntryId: string | null
  restoredWorkerName: string | null
  restorable: boolean
}

/** Jedna linia historii korekt — każdy rodzaj śladu po swojemu (zmiana, usunięcie, przywrócenie, wyjątek). */
export function opisKorekty(changes: Record<string, unknown>): string {
  const c = changes ?? {}
  const kg = (v: unknown) => `${String(n(v)).replace('.', ',')} kg`
  if (c.usuniety && typeof c.usuniety === 'object') {
    const u = c.usuniety as Record<string, unknown>
    return `usunięty: ${u.worker ?? '—'}, ćwiartka ${kg(u.kgQuarter)}, mięso ${kg(u.kgMeat)}`
  }
  if (c.przywrocony && typeof c.przywrocony === 'object') {
    const p = c.przywrocony as Record<string, unknown>
    return `przywrócony z usuniętego wpisu ${p.fromWorker ?? '—'} → ${p.toWorker ?? '—'}`
  }
  const czesci: string[] = []
  const zmiana = (k: string, t: string, f: (v: unknown) => string) => {
    const z = c[k] as { from?: unknown; to?: unknown } | undefined
    if (z && typeof z === 'object' && 'to' in z) czesci.push(`${t}: ${f(z.from)} → ${f(z.to)}`)
  }
  zmiana('worker', 'pracownik', v => String(v ?? '—') || '—')
  zmiana('kgQuarter', 'ćwiartka', kg)
  zmiana('kgMeat', 'mięso', kg)
  if (czesci.length) return czesci.join('; ')
  if ('differenceKg' in c) return `bilans poza tolerancją zatwierdzony kodem kierownika (różnica ${kg(c.differenceKg)})`
  return 'zmiana wpisu'
}

/** Pracownicy rozbioru do wyboru — jak na hali (rola rozbioru), alfabetycznie; obecny zawsze na liście. */
export function pracownicyRozbioru(lista: Array<{ id: string; name: string; role?: string; active?: boolean }>, obecny?: { id: string; name: string }) {
  const r = lista.filter(u => u.role === 'WORKER_DEBONING' && u.active !== false)
    .map(u => ({ id: u.id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  if (obecny?.id && !r.some(u => u.id === obecny.id)) r.unshift({ id: obecny.id, name: obecny.name || '—' })
  return r
}
