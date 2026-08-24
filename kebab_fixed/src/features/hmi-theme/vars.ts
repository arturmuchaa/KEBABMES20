import type { CSSProperties } from 'react'

/**
 * Paleta HMI hali — biel + jeden akcent indygo, kontrast zweryfikowany WCAG.
 *
 * JEDNO źródło dla WSZYSTKICH stanowisk (rozbiór, produkcja, kolejne).
 * Ludzie chodzą między stanowiskami i nie mają się uczyć drugiego wyglądu,
 * więc kolory nie mogą być kopiowane do każdego ekranu z osobna — po pierwszej
 * poprawce w jednym miejscu reszta zaczęłaby się rozjeżdżać.
 *
 * `--successSoft` / `--successLine` długo brakowało tu mimo użycia w modalu
 * „Partia zakończona" (kwadrat ikony bez tła i bez ramki) — dopisane przy
 * wydzielaniu motywu.
 */
export const HMI_VARS: CSSProperties = {
  ['--bg' as string]:          '#E7EAEE',
  ['--panel' as string]:       '#FFFFFF',
  ['--ink' as string]:         '#0F172A',
  ['--mut' as string]:         '#5B6472',
  ['--line' as string]:        '#D8DEE6',
  ['--lineSoft' as string]:    '#E2E5EA',
  ['--accent' as string]:      '#4F46E5',
  ['--accentSoft' as string]:  '#EEF2FF',
  ['--barBg' as string]:       '#D3DBF7',
  ['--success' as string]:     '#16A34A',
  ['--successSoft' as string]: '#F0FDF4',
  ['--successLine' as string]: '#BBF0D3',
  ['--amb' as string]:         '#B45309',
  ['--ambSoft' as string]:     '#FFFBF3',
  ['--ambLine' as string]:     '#F3D9AE',
  ['--red' as string]:         '#DC2626',
  ['--redSoft' as string]:     '#FEF2F2',
  ['--redLine' as string]:     '#F6C6C6',
}

/** Krój etykiet i nagłówków — ten sam na każdym stanowisku. */
export const HMI_FONT = '-apple-system, "Segoe UI", system-ui, sans-serif'
