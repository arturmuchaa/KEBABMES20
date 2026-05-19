/**
 * ZoomControls — trzy przyciski w topbarze: − [100%] +
 * - klik na środkowy "XXX%" = reset do 100%
 * - skróty klawiszowe Ctrl+= / Ctrl+− / Ctrl+0 obsługiwane przez useZoomInit
 */
import { Minus, Plus } from 'lucide-react'
import { useZoom, ZOOM_STEPS } from './useZoom'

export function ZoomControls() {
  const { value, step, reset } = useZoom()
  const atMin = value === ZOOM_STEPS[0]
  const atMax = value === ZOOM_STEPS[ZOOM_STEPS.length - 1]

  return (
    <div className="hidden md:inline-flex items-center rounded-md border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => step(-1)}
        disabled={atMin}
        title="Pomniejsz (Ctrl + −)"
        className="px-1.5 h-7 grid place-items-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Minus size={13} />
      </button>
      <button
        onClick={reset}
        title="Reset do 100% (Ctrl + 0)"
        className="px-2 h-7 text-[11px] font-semibold tabular-nums text-gray-700 border-x border-gray-200 hover:bg-gray-100 transition-colors min-w-[44px] text-center"
      >
        {value}%
      </button>
      <button
        onClick={() => step(1)}
        disabled={atMax}
        title="Powiększ (Ctrl + =)"
        className="px-1.5 h-7 grid place-items-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Plus size={13} />
      </button>
    </div>
  )
}
