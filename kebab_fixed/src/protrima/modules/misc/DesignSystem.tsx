import React from 'react'
import { Plus, Search, Printer } from 'lucide-react'
import { CommandBar } from '../../shell/context'
import { Logo, AppIcon } from '../../brand/Logo'
import { OrderStatusLabel, StageNode, FlagIcon, PalletFlow, PalletStatusLabel } from '../../ui/Glyphs'
import { CoverMeter, ProdMeter, MeasureLegend } from '../../ui/Meters'
import type { OrderStatus } from '../../data/model'

const SW: Array<[string, string, string]> = [
  ['--canvas', 'Tło robocze', 'za panelami'], ['--surface', 'Panel', 'tabele, karty'], ['--surface-alt', 'Nagłówek', 'nagłówki tabel'], ['--field', 'Pole', 'formularze'],
  ['--line', 'Linia', 'obramowania'], ['--ink-1', 'Tekst', 'podstawowy'], ['--ink-3', 'Etykieta', 'opisy'], ['--bar', 'Pasek roboczy', 'karty modułów'],
  ['--accent', 'Kobalt', 'wybór, fokus, akcja'], ['--accent-tint', 'Zaznaczenie', 'wybrany wiersz'],
  ['--crit', 'Krytyczne', 'zaległe, blokuje'], ['--warn', 'Uwaga', 'zagrożone'], ['--ok', 'W normie', 'gotowe'],
  ['--m-prod', 'Produkcja', 'zgłoszono'], ['--m-stock', 'Magazyn', 'przydzielone'], ['--m-ship', 'Wydano', 'na WZ'],
]

export function DesignSystem() {
  return (
    <>
      <CommandBar title="System projektowy" count="wspólny język dla wszystkich modułów PROTRIMA" cmds={[]} />
      <div className="ds">
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-h"><h2>Znak</h2><span className="sub">krzywe z paczki grafika (Koncepcja 02) · zmienione tylko kolory</span></div>
          <div className="panel-b">
            <div className="row-wrap" style={{ gap: 14, alignItems: 'stretch' }}>
              <div className="box" style={{ padding: '18px 22px', background: 'var(--chrome-1)', display: 'flex', flexDirection: 'column', gap: 8 }}><Logo height={34} /><span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Aplikacja: „pr” w kolorze akcentu, nazwa w graficie</span></div>
              <div className="box" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}><Logo height={34} mono /><span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Dokumenty i druk: jeden kolor (grafit #2C3840)</span></div>
              <div className="box" style={{ padding: '14px 18px', display: 'flex', gap: 12, alignItems: 'center' }}><AppIcon size={48} /><AppIcon size={32} /><AppIcon size={24} /><AppIcon size={16} /><AppIcon size={48} tone="type" /><span className="muted" style={{ fontSize: 'var(--fs-xs)', maxWidth: 160 }}>Ikona aplikacji 48 · 32 · 24 · 16 px i wariant grafitowy</span></div>
            </div>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Pliki źródłowe (SVG/ICO/PNG) są w projekcie: src/brand/files i public/brand. To wektory robocze — po dopracowaniu przez grafika wystarczy podmienić ścieżki w src/brand/Logo.tsx; kolory pochodzą z tokenów --logo-mark i --logo-type.</p>
          </div>
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-h"><h2>Zasady</h2></div>
          <div className="panel-b">
            <ol className="principles">
              <li><b>Wyjątek jest głośny, norma jest cicha.</b> Kolor czerwony, bursztynowy i zielony pojawia się tylko przy problemie lub gotowości. Statusy cyklu życia są neutralne i kodowane kształtem.</li>
              <li><b>Trzy miary, trzy liczby.</b> Produkcja (zgłoszono), pokrycie (magazyn + wydano) i wysyłka (wydano) mają osobne kolory i nigdy nie są sumowane w jeden procent.</li>
              <li><b>Klasyczne okno, trzy pasy u góry.</b> Logo i konto, pod nim menu (Plik, Edycja, Widok…), pod nim pasek narzędzi programu. Akcje zaznaczonego rekordu są niżej, w pasku modułu, a następny krok — w panelu szczegółów. Żadna akcja nie powtarza się w dwóch miejscach.</li>
              <li><b>Lista + dolny panel + karty robocze.</b> Każdy moduł ma ten sam szkielet: widoki zapisane, filtry, tabela, panel szczegółów z zakładkami; dowolny rekord można otworzyć w osobnej karcie.</li>
              <li><b>Klawiatura jest pełnoprawna.</b> Ctrl+K szuka wszędzie, strzałki i Spacja obsługują listy, Alt+cyfra przełącza zakładki, F2 edytuje.</li>
              <li><b>Gęstość zamiast pomniejszania.</b> Na 1366 × 768 zmienia się wysokość wierszy, nawigacja zwija się do ikon, a mniej ważne kolumny chowają się. Tekst nie schodzi poniżej 12 px.</li>
              <li><b>Bez mgły.</b> Tła nie są czysto białe, tekst nie jest czysto czarny, ale linie i etykiety mają kontrast min. 4,5 : 1. Cienie tylko dla warstw pływających.</li>
            </ol>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Kolory</h2><span className="sub">tokeny — w motywie grafitowym te same nazwy</span></div>
          <div className="panel-b"><div className="swatches">
            {SW.map(([v, n, d]) => <div key={v} className="sw"><i style={{ background: `var(${v})` }} /><b>{n}</b><span>{d}</span><span className="code">{v}</span></div>)}
          </div></div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Typografia</h2><span className="sub">IBM Plex Sans · cyfry tabelaryczne w kolumnach</span></div>
          <div className="panel-b">
            <div className="type-row"><span className="muted">Tytuł modułu</span><span style={{ fontSize: 'var(--fs-xl)', fontWeight: 600 }}>Zamówienia</span></div>
            <div className="type-row"><span className="muted">Liczba główna</span><span style={{ fontSize: 'var(--fs-fig)', fontWeight: 600 }}>9 860 kg</span></div>
            <div className="type-row"><span className="muted">Nagłówek sekcji</span><span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Pokrycie pozycji</span></div>
            <div className="type-row"><span className="muted">Treść / tabela</span><span className="num">ZAM-2026-0412 · Anatolia Food GmbH · 2 120 kg</span></div>
            <div className="type-row"><span className="muted">Etykieta</span><span className="label">Termin wyjazdu</span></div>
            <div className="type-row"><span className="muted">Kody</span><span className="code">karton 000214 · P-261028-04</span></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Statusy i sygnały</h2></div>
          <div className="panel-b">
            <div className="label">Cykl życia zamówienia — wypełnienie znacznika</div>
            <div className="row-wrap">{(['draft', 'confirmed', 'in_production', 'done', 'cancelled'] as OrderStatus[]).map(s => <OrderStatusLabel key={s} status={s} />)}</div>
            <div className="label">Etapy procesu — kształt węzła</div>
            <div className="row-wrap legend"><span><StageNode level="ok" /> w normie</span><span><StageNode level="warn" /> wymaga uwagi</span><span><StageNode level="crit" /> krytyczne</span><span><StageNode level="idle" /> bez aktywności</span></div>
            <div className="label">Wyjątki w wierszach</div>
            <div className="row-wrap">
              <span className="alert-ico crit"><FlagIcon level="crit" /></span><span className="tag crit">Zaległe 1 dzień</span>
              <span className="alert-ico warn"><FlagIcon level="warn" /></span><span className="tag warn">Zagrożone</span>
              <span className="alert-ico info"><FlagIcon level="info" /></span><span className="tag info">Zgłoszone, nieprzyjęte</span>
              <span className="tag ok">komplet</span>
            </div>
            <div className="label">Palety</div>
            <div className="row-wrap"><PalletStatusLabel status="packing" /><PalletFlow status="packing" /><PalletStatusLabel status="cold" /><PalletFlow status="cold" /><PalletStatusLabel status="shipped" /><PalletFlow status="shipped" /></div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Miary realizacji</h2></div>
          <div className="panel-b">
            <MeasureLegend />
            <div className="row-wrap"><span className="muted" style={{ width: 90 }}>Produkcja</span><ProdMeter value={64} w={140} /></div>
            <div className="row-wrap"><span className="muted" style={{ width: 90 }}>Pokrycie</span><CoverMeter ship={24} stock={36} w={140} /></div>
            <div className="row-wrap"><span className="muted" style={{ width: 90 }}>Rozkład</span><span className="cov-bar" style={{ width: 220 }}><i className="f-ship" style={{ width: '24%' }} /><i className="f-stock" style={{ width: '36%' }} /><i className="f-short" style={{ flex: 1 }} /></span></div>
          </div>
        </section>

        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-h"><h2>Kontrolki</h2></div>
          <div className="panel-b">
            <div className="row-wrap">
              <button className="btn primary"><Plus size={16} />Nowe zamówienie<span className="kbd">Ctrl N</span></button>
              <button className="btn"><Printer size={15} />Drukuj</button>
              <button className="btn ghost">Wyczyść filtry</button>
              <button className="btn danger">Anuluj zamówienie</button>
              <button className="btn" disabled>Niedostępne</button>
              <div className="seg"><button aria-pressed="true">Aktywne<span className="count">27</span></button><button aria-pressed="false">Pilne<span className="count">7</span></button><button aria-pressed="false">Z problemem<span className="count crit">8</span></button></div>
            </div>
            <div className="row-wrap">
              <div className="field-wrap" style={{ width: 280 }}><Search size={15} /><input id="ds-search" className="field" placeholder="Numer, klient, receptura…" /></div>
              <input id="ds-num" className="field num" defaultValue="24" style={{ width: 90 }} aria-label="Przykład pola liczbowego" />
              <input id="ds-err" className="field num invalid" defaultValue="12" style={{ width: 90 }} aria-label="Przykład pola z błędem" />
              <span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>Nie można zmniejszyć poniżej 16 szt. — tyle jest już na paletach 2, 4.</span>
            </div>
            <div className="row-wrap">
              <span className="chip">Klient<span className="x" /></span><span className="chip on">Receptura: BEYAZ</span>
              <span className="docs"><span className="doc issued">WZ</span><span className="doc partial">CMR</span><span className="doc todo">HDI</span><span className="doc blocked">PAL</span></span>
              <span className="kbd">Ctrl</span><span className="kbd">K</span>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
