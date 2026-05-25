/**
 * Dispatcher edytora pozycji — wybiera wariant wprowadzania po propie `variant`.
 * Wszystkie warianty dzielą ten sam interfejs (LinesEditorProps), więc OrderForm
 * (stan, słowniki, sumy, zapis) pozostaje wspólny.
 */
import type { OrderLineVariant, LinesEditorProps } from './types'
import { OrderLinesCards } from './OrderLinesCards'
import { OrderLinesTable } from './OrderLinesTable'
import { OrderLinesKeyboard } from './OrderLinesKeyboard'
import { OrderLinesQuickAdd } from './OrderLinesQuickAdd'

export function LinesEditor({ variant, ...props }: { variant: OrderLineVariant } & LinesEditorProps) {
  switch (variant) {
    case 'table':    return <OrderLinesTable {...props} />
    case 'keyboard': return <OrderLinesKeyboard {...props} />
    case 'quickadd': return <OrderLinesQuickAdd {...props} />
    default:         return <OrderLinesCards {...props} />
  }
}

export type { OrderLineVariant }
