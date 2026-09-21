import { useEffect, useState } from 'react'
import { carriersApi, type Carrier } from '@/lib/api'

/**
 * Dane transportu na CMR: przewoźnik, auto, numer faktury, instrukcje.
 *
 * Biuro (19.09.2026): „jak wystawiam CMR pod fakturę lub na całość, nie mogę
 * wpisać nr faktury oraz danych przewoźnika — to duży problem". Okno podziału
 * wysyłało do wystawienia SAMO `{hdi_fv}`, więc oba listy przewozowe
 * powstawały z pustego formularza: bez przewoźnika, bez numeru auta i bez
 * numeru faktury. Backend te pola miał od początku (`CmrForm`) — nie miał ich
 * kto podać.
 *
 * Komponent jest wspólny, żeby komplet z podziału i osobne „Wystaw CMR"
 * pytały o DOKŁADNIE to samo. Rozjazd między dwoma formularzami na ten sam
 * dokument skończyłby się listem przewozowym, który zależy od tego, którym
 * przyciskiem go wystawiono.
 *
 * `bezFaktury` — przewoźnik i auto są WSPÓLNE dla całego kursu, ale numer
 * faktury nie: każdy odbiorca dostaje własną fakturę. Ekran papierów kursu
 * pyta więc o numer przy KAŻDYM odbiorcy z osobna i chowa tu to pole, żeby
 * nie było dwóch miejsc na tę samą daną (biuro, 21.09.2026: kurs na czterech
 * klientów dostał jeden numer faktury na wszystkich czterech CMR-ach).
 */
export type DaneTransportu = {
  carrier_id: string
  plate: string
  invoice_no: string
  instructions: string
}

export const DOMYSLNE_DANE_TRANSPORTU: DaneTransportu = {
  carrier_id: '',
  plate: '',
  invoice_no: '',
  instructions: 'TRANSPORT MROŻNICZY -22',
}

/** Czy list przewozowy pojedzie bez tego, co kierowca musi mieć na papierze. */
export function brakujeDanychPrzewoznika(d: DaneTransportu): boolean {
  return !d.carrier_id || !d.plate.trim()
}

export function CmrDaneTransportu({
  wartosc, onChange, disabled = false, bezFaktury = false,
}: {
  wartosc: DaneTransportu
  onChange: (d: DaneTransportu) => void
  disabled?: boolean
  /** Numer faktury zbiera wołający — per odbiorca, nie na cały kurs. */
  bezFaktury?: boolean
}) {
  const [carriers, setCarriers] = useState<Carrier[]>([])

  useEffect(() => { carriersApi.list().then(setCarriers).catch(() => {}) }, [])

  // Po wyborze przewoźnika podpowiedz jego domyślny numer rejestracyjny —
  // tak samo jak w osobnym oknie „Wystaw CMR". Nie nadpisujemy tego, co biuro
  // wpisało ręcznie: auto bywa zastępcze.
  function ustawPrzewoznika(id: string) {
    const c = carriers.find(x => x.id === id)
    onChange({
      ...wartosc,
      carrier_id: id,
      plate: wartosc.plate.trim() ? wartosc.plate : (c?.defaultPlate ?? ''),
    })
  }

  const pole = 'w-full rounded border border-surface-4 px-2 py-1.5 text-[12.5px] disabled:opacity-50'
  const etykieta = 'block text-[11px] font-semibold uppercase tracking-wide text-ink-3 mb-0.5'

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="col-span-2">
        <span className={etykieta}>Przewoźnik</span>
        <select
          className={pole}
          data-testid="cmr-przewoznik"
          value={wartosc.carrier_id}
          disabled={disabled}
          onChange={e => ustawPrzewoznika(e.target.value)}
        >
          <option value="">— wybierz —</option>
          {carriers.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={etykieta}>Nr rejestracyjny</span>
        <input
          className={pole}
          data-testid="cmr-auto"
          value={wartosc.plate}
          disabled={disabled}
          onChange={e => onChange({ ...wartosc, plate: e.target.value })}
        />
      </label>
      {!bezFaktury && (
        <label>
          <span className={etykieta}>Nr faktury (pole 5)</span>
          <input
            className={pole}
            data-testid="cmr-faktura"
            placeholder="FV 11/09/2026"
            value={wartosc.invoice_no}
            disabled={disabled}
            onChange={e => onChange({ ...wartosc, invoice_no: e.target.value })}
          />
        </label>
      )}
      <label className="col-span-2">
        <span className={etykieta}>Instrukcje (pole 13)</span>
        <input
          className={pole}
          data-testid="cmr-instrukcje"
          value={wartosc.instructions}
          disabled={disabled}
          onChange={e => onChange({ ...wartosc, instructions: e.target.value })}
        />
      </label>
    </div>
  )
}
