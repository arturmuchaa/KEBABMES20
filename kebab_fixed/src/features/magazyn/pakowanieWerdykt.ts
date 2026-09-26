/**
 * Co panel robi po skanie sztuki — czysta funkcja, bez Reacta.
 *
 * Trzy ścieżki spec §5.3 i jedna zasada §5.4: CISZA ZNACZY DOBRZE.
 *   ACTIVE    → nic nie gra, nic nie miga (licznik po prostu rośnie),
 *   OTHER     → krótki inny ton + bursztyn w pasku „poszła do kartonu X";
 *               aktywny karton ZOSTAJE — za jedną sztuką nikt nie wraca,
 *   NO_PLACE  → ostry błąd na cały ekran, z podpowiedzią co dalej.
 *
 * Decyzja, DO KTÓREGO kartonu, zapada w backendzie
 * (`magazyn_pakowanie_service.skanuj_sztuke`). Tu tylko tłumaczymy wynik
 * na to, co człowiek usłyszy i zobaczy.
 */
import type { SkanPakowania } from '@/lib/api'
import type { StanAlarmu } from './magazynTypes'

export interface Uwaga { naglowek: string; szczegol: string }

export interface WerdyktPakowania {
  dzwiek: 'cisza' | 'inny' | 'blad'
  /** Pełnoekranowy alarm (tylko to, co NIE przeszło). */
  alarm: Omit<StanAlarmu, 'ts'> | null
  /** Bursztynowa linia w pasku pakowania — przeszło, ale zerknij. */
  uwaga: Uwaga | null
  /** Id kartonu, który ma być aktywny po tym skanie. */
  aktywny: string | null
  /** Numer kartonu, który tym skanem się zapełnił (do etykiety). */
  pelny: string | null
}

function blad(naglowek: string, szczegol: string, gdzie?: string): Omit<StanAlarmu, 'ts'> {
  return { skaner: 'L', ton: 'blad', naglowek, szczegol, ...(gdzie ? { gdzie } : {}) }
}

export function werdyktPakowania(w: SkanPakowania, aktywny: string | null): WerdyktPakowania {
  const baza: WerdyktPakowania = { dzwiek: 'cisza', alarm: null, uwaga: null, aktywny, pelny: null }
  const k = w.container

  switch (w.result) {
    case 'ACTIVE': {
      const out = { ...baza, aktywny: k?.id ?? aktywny }
      if (w.activeClosed && k) {
        out.dzwiek = 'inny'
        out.uwaga = { naglowek: 'POPRZEDNI KARTON ZAMKNIĘTY',
          szczegol: `Ktoś go dopełnił — sztuka poszła do kartonu ${k.cartonNo} · ${k.clientName}.` }
      }
      if (w.full && k) {
        out.pelny = k.cartonNo
        out.uwaga = { naglowek: `KARTON ${k.cartonNo} PEŁNY`,
          szczegol: 'Komplet sztuk. Zaklej karton i wstaw go do mroźni.' }
      }
      return out
    }
    case 'OTHER':
      return {
        ...baza,
        dzwiek: 'inny',
        pelny: w.full && k ? k.cartonNo : null,
        uwaga: {
          naglowek: `ODŁÓŻ DO KARTONU ${k?.cartonNo ?? '?'}`,
          szczegol: `${w.unit} → karton ${k?.cartonNo ?? '?'} · ${k?.clientName ?? ''}`.trim(),
        },
      }
    case 'ALREADY':
      if (w.sameCarton) return baza
      return { ...baza, dzwiek: 'blad',
        alarm: blad('JUŻ SPAKOWANA', `${w.unit} leży już w innym kartonie.`,
          w.where ? `KARTON ${w.where}` : undefined) }
    case 'NO_PLACE':
      // Hala 25.09.2026: „nie ma gdzie" brzmiało jak nierozpoznany kod, a to
      // sztuka rozpoznana — tylko biuro nie założyło dla niej kartonu.
      return { ...baza, dzwiek: 'blad',
        alarm: blad('BRAK KARTONU DLA TEJ SZTUKI',
          `${w.unit} — nie ma otwartego kartonu dla tego klienta i tej wagi.`,
          'Odłóż sztukę · biuro musi założyć karton') }
    case 'NOT_PRODUCED':
      return { ...baza, dzwiek: 'blad',
        alarm: blad('NIE ZESZŁA Z PRODUKCJI',
          `${w.unit || 'Ta sztuka'} nie ma skanu produkcji — najpierw skan na linii.`) }
    case 'INVALID':
    default:
      return { ...baza, dzwiek: 'blad',
        alarm: blad('NIEZNANY KOD', 'To nie jest etykieta sztuki kebaba.') }
  }
}
