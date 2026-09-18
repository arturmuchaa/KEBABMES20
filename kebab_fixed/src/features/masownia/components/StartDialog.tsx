/**
 * Pytanie po załadunku: puszczamy tę masownicę teraz czy czekamy na pozostałe?
 *
 * Maszyna NIE rusza sama (właściciel, 18.09.2026: „żeby się nie puszczały
 * automatycznie, tylko operator świadomie potwierdzał albo świadomie czekał
 * i puścił wszystkie równocześnie"). Hala ładuje trzy masownice po kolei i
 * często chce je puścić razem — inaczej pierwsza kończy 20 minut przed
 * ostatnią i odbiór rozjeżdża się na cały dzień.
 *
 * Oba wyjścia są jednakowo widoczne: „później" nie jest wersją gorszą,
 * tylko drugim planem pracy, więc nie chowamy go w drobnym druku.
 */
export function StartDialog({ machineId, czekaINnych, busy, onStart, onLater }: {
  machineId: number
  /** Ile INNYCH masownic stoi już załadowanych i czeka na wspólny start. */
  czekaINnych: number
  busy?: boolean
  onStart: () => void
  onLater: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-9"
      style={{ background: 'rgba(15,23,42,.5)' }}>
      <div className="rounded-2xl w-[720px] flex flex-col overflow-hidden" style={{ background: 'var(--panel)' }}>
        <div className="p-5 px-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <h3 className="m-0 text-[26px] font-extrabold">Masownica {machineId} załadowana</h3>
          <p className="m-0 mt-1.5 text-[15px]" style={{ color: 'var(--mut)' }}>
            {czekaINnych > 0
              ? `Czekają też ${czekaINnych === 1 ? 'inna masownica' : `inne masownice (${czekaINnych})`} — możesz puścić wszystkie razem.`
              : 'Maszyna stoi pełna i czeka. Cykl zacznie się dopiero po starcie.'}
          </p>
        </div>
        <div className="p-6 flex gap-4">
          <button type="button" disabled={busy} onClick={onStart}
            className="flex-1 min-h-[132px] rounded-xl p-5 text-left flex flex-col gap-2"
            style={{ background: 'var(--success)', color: '#fff' }}>
            <span className="text-[26px] font-extrabold leading-none">Rozpocznij teraz</span>
            <span className="text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,.85)' }}>
              Maszyna rusza i zaczyna odliczać cykl.
            </span>
          </button>
          <button type="button" disabled={busy} onClick={onLater}
            className="flex-1 min-h-[132px] rounded-xl p-5 text-left flex flex-col gap-2"
            style={{ background: 'var(--panel)', border: '2px solid var(--amb)', color: 'var(--amb)' }}>
            <span className="text-[26px] font-extrabold leading-none">Później</span>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--mut)' }}>
              Załaduj pozostałe i puść je razem — przycisk czeka na ekranie głównym.
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
