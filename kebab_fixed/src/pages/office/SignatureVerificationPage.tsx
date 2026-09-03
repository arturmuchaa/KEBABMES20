/**
 * Protokół weryfikacji podpisów elektronicznych — do okazania kontroli.
 *
 * Odpowiada na pytanie inspektora „jak udowodnicie, kto to podpisał":
 * pokazuje każdy podpis (także unieważniony) z nazwiskiem i sekundą
 * złożenia, a pod spodem DOKŁADNY tekst, z którego liczony jest SHA-256.
 *
 * Kluczowe jest to, że kontroler nie musi nam wierzyć — może wziąć ten
 * tekst, policzyć z niego sha256 dowolnym narzędziem i porównać z
 * odciskiem przy podpisie. Dowód, który wymaga zaufania do dowodzącego,
 * nie jest dowodem.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { signaturesApi, type Weryfikacja } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  chwila, etykietaRoli, konkluzja, opisStanu, stanPodpisu,
} from '@/features/signatures/weryfikacjaPodpisow'

export function SignatureVerificationPage() {
  const { receptionId = '' } = useParams()
  const [v, setV] = useState<Weryfikacja | null>(null)
  const [blad, setBlad] = useState<string | null>(null)

  useEffect(() => {
    let zyje = true
    signaturesApi.weryfikacja('reception_check', receptionId)
      .then(d => { if (zyje) setV(d) })
      .catch(e => { if (zyje) setBlad(e?.message ?? 'Nie udało się wczytać protokołu') })
    return () => { zyje = false }
  }, [receptionId])

  if (blad) return <div className="p-6 text-sm text-red-700">{blad}</div>
  if (!v) return <div className="p-6 text-sm text-ink-3">Wczytywanie protokołu…</div>

  return (
    <div className="mx-auto max-w-[820px] p-6 print:p-0">
      <style>{'@media print{.noprint{display:none!important}@page{size:A4;margin:12mm}}'}</style>

      <div className="noprint mb-4 flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          Drukuj protokół
        </Button>
      </div>

      <h1 className="text-lg font-bold uppercase tracking-wide">
        Protokół weryfikacji podpisów elektronicznych
      </h1>
      <p className="mt-1 text-xs text-ink-3">
        Karta 1.1.1 — kontrola dostawy przy przyjęciu
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-3 border border-ink-5 p-3 text-sm">
        <div><dt className="text-[11px] text-ink-3">Numer przyjęcia</dt>
          <dd className="font-semibold">{v.receptionNo || '—'}</dd></div>
        <div><dt className="text-[11px] text-ink-3">Dostawca</dt>
          <dd className="font-semibold">{v.supplierName || '—'}</dd></div>
        <div><dt className="text-[11px] text-ink-3">Data dostawy</dt>
          <dd className="font-semibold">{v.receivedDate || '—'}</dd></div>
      </dl>

      <p className="mt-4 border-l-2 border-ink-3 pl-3 text-sm font-semibold">
        {konkluzja(v)}
      </p>

      <h2 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Złożone podpisy
      </h2>
      {v.signatures.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">Brak podpisów.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {v.signatures.map((p, i) => {
            const stan = stanPodpisu(p)
            return (
              <div key={i} className="border border-ink-5 p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{p.signerName}</span>
                  <span className="text-[11px] text-ink-3">{etykietaRoli(p.role)}</span>
                </div>
                <div className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] text-ink-3 sm:grid-cols-2">
                  <span>Złożony: <b className="text-ink-2">{chwila(p.signedAt)}</b></span>
                  {p.supersededAt && (
                    <span>Unieważniony: <b className="text-ink-2">{chwila(p.supersededAt)}</b></span>
                  )}
                </div>
                <p className={`mt-1 text-[11px] ${stan === 'wazny' ? 'text-ink-2' : 'text-amber-700'}`}>
                  {opisStanu(stan)}
                </p>
                {/* Odcisk treści łamiemy na dowolnym znaku — 64 znaki heksu
                    inaczej rozpychają kartkę i protokół przestaje się mieścić. */}
                <p className="mt-1 break-all font-mono text-[10px] text-ink-3">
                  Odcisk podpisanej treści: {p.contentHash}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <h2 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        Treść objęta podpisem
      </h2>
      <p className="mt-1 text-[11px] text-ink-3">
        Poniższy tekst jest dokładnie tym, z czego liczony jest odcisk
        ({v.algorytm}). Aby sprawdzić podpis niezależnie, wystarczy policzyć
        {' '}{v.algorytm} z tego tekstu i porównać z odciskiem przy podpisie.
      </p>
      <pre className="mt-2 whitespace-pre-wrap border border-ink-5 p-3 font-mono text-[11px]">
        {v.tresc}
      </pre>
      <p className="mt-1 break-all font-mono text-[10px] text-ink-3">
        Odcisk treści aktualnej: {v.currentHash}
      </p>

      <p className="mt-5 text-[10px] leading-snug text-ink-3">
        Podpis elektroniczny w rozumieniu rozporządzenia UE 910/2014 (eIDAS).
        Tożsamość podpisującego potwierdzana osobistym kodem PIN pracownika;
        podpis związany z treścią zapisu odciskiem {v.algorytm}. Zmiana danych
        po podpisaniu unieważnia podpis — unieważnione podpisy pozostają w
        systemie i są ujęte w niniejszym protokole.
      </p>
    </div>
  )
}
