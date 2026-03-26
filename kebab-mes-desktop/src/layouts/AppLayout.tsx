import { Outlet } from 'react-router-dom'
import { TitleBar } from '@/components/TitleBar'
import { Sidebar }  from '@/components/Sidebar'
import { TopBar }   from '@/components/TopBar'
import { Toaster }  from 'sonner'

/**
 * Root shell layout:
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │  TitleBar  (custom frameless, drag region)        │  h-9
 *  ├────────┬─────────────────────────────────────────┤
 *  │        │  TopBar  (page title + status)           │  h-12
 *  │ Side-  ├─────────────────────────────────────────┤
 *  │  bar   │                                         │
 *  │        │   <Outlet />  — page content             │
 *  │  w-56  │                                         │
 *  └────────┴─────────────────────────────────────────┘
 */
export function AppLayout() {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-mes-bg">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-col flex-1 overflow-hidden">
          <TopBar />

          {/* ── Page content ─────────────────────────────── */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-6 animate-fade-in">
            <Outlet />
          </main>
        </div>
      </div>

      {/* ── Global toast container ───────────────────────── */}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          classNames: {
            toast:       'bg-mes-elevated border border-mes-border text-white',
            title:       'text-slate-100 font-semibold text-sm',
            description: 'text-slate-400 text-xs',
            actionButton:'bg-mes-accent text-white text-xs',
            cancelButton:'bg-mes-muted text-slate-300 text-xs',
            error:       'border-red-500/40 bg-red-950/60',
            success:     'border-emerald-500/40 bg-emerald-950/60',
            warning:     'border-amber-500/40 bg-amber-950/60',
          },
        }}
        richColors
      />
    </div>
  )
}
