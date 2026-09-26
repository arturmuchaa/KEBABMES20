export function StanPolaczenia({ blad, aktualizacja, ladowanie = false }: {
  blad: boolean; aktualizacja: Date | null; ladowanie?: boolean
}) {
  return <div role="status" className="shrink-0 px-6 py-2 text-sm font-bold"
    style={{ background: blad ? 'var(--redSoft)' : 'var(--panel)', color: blad ? 'var(--red)' : 'var(--mut)' }}>
    {blad ? 'Brak aktualnych danych — sprawdź połączenie. ' : ladowanie ? 'Wczytuję stan… ' : 'Połączono. '}
    {aktualizacja ? `Ostatnia aktualizacja: ${aktualizacja.toLocaleTimeString('pl-PL')}` : ''}
  </div>
}
