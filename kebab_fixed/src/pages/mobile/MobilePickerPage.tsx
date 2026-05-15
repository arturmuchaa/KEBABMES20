import { Link } from 'react-router-dom'
import { Snowflake, Truck, ArrowLeft } from 'lucide-react'

export function MobilePickerPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/office/dashboard" className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Biuro
        </Link>
        <div className="text-xs uppercase tracking-wider text-slate-500">Skanowanie palet</div>
      </header>

      <main className="flex flex-1 flex-col items-stretch gap-4 p-4 sm:items-center sm:justify-center">
        <Link
          to="/mobile/mroznia"
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-sky-500 px-6 py-10 text-center text-white shadow-lg hover:bg-sky-600 active:scale-[0.99] sm:w-96"
        >
          <Snowflake size={56} />
          <div className="text-2xl font-bold uppercase tracking-wide">Mroźnia</div>
          <div className="text-sm text-sky-50">Wjazd palety po pakowaniu</div>
        </Link>

        <Link
          to="/mobile/zaladunek"
          className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-amber-500 px-6 py-10 text-center text-white shadow-lg hover:bg-amber-600 active:scale-[0.99] sm:w-96"
        >
          <Truck size={56} />
          <div className="text-2xl font-bold uppercase tracking-wide">Załadunek</div>
          <div className="text-sm text-amber-50">Wjazd na samochód</div>
        </Link>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-center text-xs text-slate-500">
        Kebab MES · skan QR
      </footer>
    </div>
  )
}
