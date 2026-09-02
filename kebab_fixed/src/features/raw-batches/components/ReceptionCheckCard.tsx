/**
 * ReceptionCheckCard — kontrola HACCP dostawy, kolumny f-k karty 1.1.1.
 *
 * Osobna sekcja, nie część formularza przyjęcia, bo to osobne zdarzenie:
 * dostawę rejestruje się od razu, a pomiar temperatury i ocenę biuro
 * dopisuje później (bywa, że pół godziny po aucie). Docelowo ten sam wpis
 * powstanie przy rampie — stąd własny endpoint, nie pole w dokumencie.
 *
 * Świadomie BEZ blokady zapisu: dostawa o 6 rano nie może czekać na
 * kierownika. System się upomina (baner, znacznik listy, kafel pulpitu),
 * ale nigdy nie wstrzymuje przyjęcia.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, ClipboardCheck, ThermometerSnowflake } from 'lucide-react'

import { receptionChecksApi, signaturesApi } from '@/lib/apiClient'
import {
  checkIssues, checkStatus, needsCorrectiveAction, tempExceeded,
  type ReceptionCheck,
} from '../receptionCheck'
import { progPrzyjecia } from '../storageState'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { SignDialog } from '@/features/signatures/SignDialog'

const PUSTY: ReceptionCheck = {
  receptionId: '', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null,
}

/** Biuro wpisuje „2,5" — przecinek dziesiętny musi działać jak kropka.
 *  Pusty napis to BRAK pomiaru (null), nie zero: zero jest odczytem. */
function parsujTemp(v: string): number | null {
  const s = v.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Liczba do pola tekstowego — po polsku, bo tak ją operator wpisał. */
function tempDoPola(v: number | null): string {
  return v === null || v === undefined ? '' : String(v).replace('.', ',')
}

/** Przełącznik dwustanowy b/z ↔ N. Wygląda jak para przycisków, bo tak
 *  wygląda na papierze: kratka z jedną z dwóch liter. */
function OcenaToggle({ id, label, value, onChange, opcje }: {
  id: string
  label: string
  value: string | null
  onChange: (v: string) => void
  opcje: { v: string; etykieta: string }[]
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div id={id} className="flex gap-2">
        {opcje.map(o => (
          <Button
            key={o.v}
            type="button"
            size="sm"
            variant={value === o.v ? 'default' : 'outline'}
            onClick={() => onChange(o.v)}
          >
            {o.etykieta}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function ReceptionCheckCard({ receptionId, category, storageState }: {
  receptionId: string
  /** Kategoria surowca — decyduje o progu temperatury (czerwone +7 °C). */
  category?: string | null
  /** 'chlodzony' | 'mrozony' — blok mrożony ma próg −12 °C. */
  storageState?: string | null
}) {
  const [check, setCheck] = useState<ReceptionCheck | null>(null)
  const [zapisuje, setZapisuje] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [zapisano, setZapisano] = useState(false)
  const [podpisy, setPodpisy] = useState<any[]>([])
  const [podpisujeRola, setPodpisujeRola] = useState<'wykonal' | 'sprawdzil' | null>(null)

  const wczytajPodpisy = () => {
    signaturesApi.forDoc('reception_check', receptionId)
      .then((d: any) => setPodpisy(d ?? []))
      .catch(() => setPodpisy([]))
  }

  useEffect(() => {
    let aktualne = true
    receptionChecksApi.get(receptionId)
      .then((d: any) => { if (aktualne) setCheck({ ...PUSTY, ...d, receptionId }) })
      .catch((e: any) => { if (aktualne) setBlad(e?.message ?? 'Nie udało się wczytać kontroli') })
    wczytajPodpisy()
    return () => { aktualne = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receptionId])

  if (!check) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-ink-3">
          {blad ?? 'Wczytywanie kontroli HACCP…'}
        </CardContent>
      </Card>
    )
  }

  const status = checkStatus(check)
  const uwagi = checkIssues(check, category, storageState)
  const prog = progPrzyjecia(category, storageState)
  const trzebaDzialania = needsCorrectiveAction(check)
  const odmowa = check.verdict === 'N'

  const ustaw = <K extends keyof ReceptionCheck>(k: K, v: ReceptionCheck[K]) => {
    setCheck(c => (c ? { ...c, [k]: v } : c))
    setZapisano(false)
  }

  const zapisz = () => {
    setZapisuje(true)
    setBlad(null)
    receptionChecksApi.save(receptionId, {
      visual: check.visual,
      tempChamber: check.tempChamber,
      tempMeat: check.tempMeat,
      kgMatch: check.kgMatch,
      notes: check.notes,
      verdict: check.verdict,
      ncDescription: check.ncDescription,
      ncAction: check.ncAction,
      ncAt: check.ncAt,
    })
      .then((d: any) => {
        setCheck({ ...PUSTY, ...d, receptionId })
        setZapisano(true)
        // Zapis mógł UNIEWAŻNIĆ podpisy (zmiana treści) — ekran musi to
        // pokazać od razu, inaczej biuro myśli, że dokument nadal jest
        // podpisany, a karta wydrukuje pustą kratkę.
        wczytajPodpisy()
      })
      .catch((e: any) => setBlad(e?.message ?? 'Nie udało się zapisać kontroli'))
      .finally(() => setZapisuje(false))
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck size={16} />
              Kontrola HACCP
            </CardTitle>
            <CardDescription>
              {status === 'komplet'
                ? 'Karta 1.1.1 — komplet danych kontroli dostawy'
                : 'Uzupełnij kontrolę HACCP — karta 1.1.1 ma bez tego dziurę w wierszu'}
            </CardDescription>
          </div>
          {status !== 'komplet' && (
            <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
              {status === 'brak' ? 'brak danych' : 'niepełne'}
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <OcenaToggle
            id="haccp-visual"
            label="Ocena wizualna dostawy, książka mycia pojazdu (f)"
            value={check.visual}
            onChange={v => ustaw('visual', v as ReceptionCheck['visual'])}
            opcje={[{ v: 'bz', etykieta: 'b/z' }, { v: 'N', etykieta: 'N' }]}
          />
          <OcenaToggle
            id="haccp-kgmatch"
            label="Zgodność kg z zamówieniem i dokumentami (i)"
            value={check.kgMatch}
            onChange={v => ustaw('kgMatch', v as ReceptionCheck['kgMatch'])}
            opcje={[{ v: 'bz', etykieta: 'b/z' }, { v: 'N', etykieta: 'N' }]}
          />

          <div className="space-y-1.5">
            <Label htmlFor="haccp-temp-chamber">Temperatura komory [°C] (g)</Label>
            <Input
              id="haccp-temp-chamber"
              inputMode="decimal"
              placeholder={prog.opis}
              value={tempDoPola(check.tempChamber)}
              onChange={e => ustaw('tempChamber', parsujTemp(e.target.value))}
              className={tempExceeded(check.tempChamber, category, storageState)
                ? 'border-red-400 bg-red-50' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="haccp-temp-meat">Temperatura mięsa [°C] (h)</Label>
            <Input
              id="haccp-temp-meat"
              inputMode="decimal"
              placeholder={prog.opis}
              value={tempDoPola(check.tempMeat)}
              onChange={e => ustaw('tempMeat', parsujTemp(e.target.value))}
              className={tempExceeded(check.tempMeat, category, storageState)
                ? 'border-red-400 bg-red-50' : ''}
            />
          </div>
        </div>

        <p className="text-xs text-ink-3 flex items-center gap-1.5">
          <ThermometerSnowflake size={13} />
          Wpisuje się NAJWYŻSZY zmierzony odczyt (instrukcja 1.1), próg {prog.opis}.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="haccp-notes">Uwagi (j)</Label>
          <Input
            id="haccp-notes"
            value={check.notes}
            onChange={e => ustaw('notes', e.target.value)}
          />
        </div>

        <OcenaToggle
          id="haccp-verdict"
          label="Ocena całej dostawy (k)"
          value={check.verdict}
          onChange={v => ustaw('verdict', v as ReceptionCheck['verdict'])}
          opcje={[
            { v: 'K', etykieta: 'K — przyjęta' },
            { v: 'N', etykieta: 'N — odmowa przyjęcia' },
          ]}
        />

        {/* Odmowa przyjęcia zderza się z tym, że dostawa JEST już w systemie
            i dodała surowiec na magazyn — wpis HACCP powstaje później. Nie
            anulujemy automatycznie: cofanie ruchów magazynowych to decyzja
            człowieka, a sam wpis zostaje niezależnie od niej (karta 1.1.1
            rejestruje też dostawy odrzucone — służy ocenie dostawców). */}
        {odmowa && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Dostawa odrzucona — czy anulować przyjęcie i zdjąć surowiec ze stanu?
            Zrób to na liście przyjęć („Anuluj dostawę"); ten wpis zostaje niezależnie
            od decyzji, bo karta rejestruje również dostawy odrzucone.
          </div>
        )}

        {trzebaDzialania && (
          <div className="space-y-3 rounded border border-ink-5 p-3">
            <p className="text-sm font-semibold">Niezgodność — działanie korygujące</p>
            <div className="space-y-1.5">
              <Label htmlFor="haccp-nc-desc">Opis niezgodności</Label>
              <Input
                id="haccp-nc-desc"
                value={check.ncDescription}
                onChange={e => ustaw('ncDescription', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="haccp-nc-action">Podjęte działanie korygujące</Label>
              <Input
                id="haccp-nc-action"
                value={check.ncAction}
                onChange={e => ustaw('ncAction', e.target.value)}
              />
            </div>
          </div>
        )}

        {uwagi.length > 0 && (
          <ul className="space-y-1">
            {uwagi.map((u, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-red-700">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                {u}
              </li>
            ))}
          </ul>
        )}

        {blad && <p className="text-sm text-red-700">{blad}</p>}

        {/* Podpisy — kolumny l/m karty 1.1.1. Podpis unieważniony zmianą
            treści tu nie dociera (backend oddaje tylko aktywne), więc slot
            wraca do stanu pustego i sam mówi, co się stało. */}
        <div className="grid gap-3 md:grid-cols-2 pt-1">
          {(['wykonal', 'sprawdzil'] as const).map(rola => {
            const p = podpisy.find((x: any) => x.role === rola)
            return (
              <div key={rola} className="rounded border border-ink-5 p-3">
                <p className="text-xs font-semibold text-ink-2 mb-2">
                  {rola === 'wykonal' ? 'Wykonał (l)' : 'Sprawdził (m)'}
                </p>
                {p ? (
                  <div className="space-y-1">
                    <img src={p.png} alt="" className="h-10 w-auto max-w-full object-contain" />
                    <p className="text-xs font-semibold">{p.signerName}</p>
                    <p className="text-[11px] text-ink-3">
                      {p.signedAt ? new Date(p.signedAt).toLocaleString('pl-PL') : ''}
                    </p>
                  </div>
                ) : (
                  <Button type="button" variant="outline" size="sm"
                          onClick={() => setPodpisujeRola(rola)}>
                    Podpisz
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {podpisujeRola && (
          <SignDialog
            docType="reception_check"
            docId={receptionId}
            role={podpisujeRola}
            juzPodpisal={podpisy.find((x: any) => x.role !== podpisujeRola)?.workerId}
            onSigned={wczytajPodpisy}
            onClose={() => setPodpisujeRola(null)}
          />
        )}

        <div className="flex items-center gap-3">
          {/* Przekroczony próg NIE blokuje zapisu: dostawę odrzuconą trzeba
              móc zapisać razem z tym, co ją zdyskwalifikowało. */}
          <Button type="button" onClick={zapisz} disabled={zapisuje}>
            {zapisuje ? 'Zapisuję…' : 'Zapisz kontrolę'}
          </Button>
          {zapisano && <span className="text-sm text-green-700">Zapisano</span>}
        </div>
      </CardContent>
    </Card>
  )
}
