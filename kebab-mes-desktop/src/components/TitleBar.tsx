/**
 * TitleBar — custom frameless window header.
 * Uses `data-tauri-drag-region` so the whole bar is draggable.
 * Window controls call Tauri's window API.
 */
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, X, Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getFacilityName } from '@/store/config'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    win.isMaximized().then(setMaximized)
    const unsub = win.onResized(async () => {
      setMaximized(await win.isMaximized())
    })
    return () => { unsub.then(fn => fn()) }
  }, [])

  async function handleMinimize() { await getCurrentWindow().minimize() }
  async function handleMaximize() {
    const win = getCurrentWindow()
    if (maximized) await win.unmaximize(); else await win.maximize()
  }
  async function handleClose()    { await getCurrentWindow().close() }

  return (
    <div
      data-tauri-drag-region
      className="flex items-center h-9 bg-titlebar-bg border-b border-titlebar-border select-none shrink-0"
      onDoubleClick={handleMaximize}
    >
      {/* ── Logo / brand ─────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 pointer-events-none">
        <div className="w-4 h-4 rounded bg-mes-accent flex items-center justify-center">
          <span className="text-[8px] font-black text-white leading-none">M</span>
        </div>
        <span className="text-[12px] font-semibold text-slate-300">
          {getFacilityName()}
        </span>
        <span className="text-[11px] text-slate-600 ml-0.5">— MES</span>
      </div>

      {/* ── Drag region fill ─────────────────────────────── */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* ── Window controls ──────────────────────────────── */}
      <div className="flex items-center h-full">
        <WinBtn onClick={handleMinimize} label="Minimalizuj">
          <Minus size={11} />
        </WinBtn>
        <WinBtn onClick={handleMaximize} label={maximized ? 'Przywróć' : 'Maksymalizuj'}>
          {maximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
        </WinBtn>
        <WinBtn onClick={handleClose} label="Zamknij" danger>
          <X size={12} />
        </WinBtn>
      </div>
    </div>
  )
}

function WinBtn({
  onClick, label, danger, children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={[
        'flex items-center justify-center w-11 h-full transition-colors',
        danger
          ? 'text-slate-500 hover:bg-red-600 hover:text-white'
          : 'text-slate-500 hover:bg-mes-elevated hover:text-slate-200',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
