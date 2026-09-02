/**
 * haccpBadge — znacznik stanu kontroli HACCP w wierszu listy przyjęć.
 *
 * Osobny moduł, bo ten sam znacznik pojawia się w trzech miejscach
 * (lista przyjęć, podgląd dostawy, kafel pulpitu) i nazwy muszą być
 * wszędzie te same — inaczej „brak" na liście i „niepełne" na pulpicie
 * wyglądają jak dwa różne problemy.
 */
import type { CheckStatus } from './receptionCheck'

export function haccpBadge(status: CheckStatus): {
  label: string; tone: 'ok' | 'warn' | 'todo'
} {
  if (status === 'komplet') return { label: 'HACCP', tone: 'ok' }
  if (status === 'niepelne') return { label: 'HACCP: niepełne', tone: 'warn' }
  return { label: 'HACCP: brak', tone: 'todo' }
}
