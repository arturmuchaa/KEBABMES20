/**
 * Palety bez etykiety z QR w dzisiejszym planie (właściciel 27.11.2026).
 *
 * Etykiety mięsa drukuje tylko HMI masowni. Palety, które leżały w chłodni
 * w dniu wdrożenia, mają etykiety sprzed kodu QR i nikt ich nie przedrukowuje
 * — kierownik wywozi je stąd, dotykiem. Lista pokazuje WYŁĄCZNIE palety bez
 * kodu przypisane do tego planu, więc blokada spoza planu zostaje.
 */
import { useCallback, useEffect, useState } from 'react'
import { seasonedPalletsApi } from '@/lib/api'

interface PaletaBezKodu { id: string; palletNo: number; batchNo: string; recipeName: string; kgWeighed: number; planIds?: string[]; noLabel?: boolean }

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

export function PaletyBezKodu({ planId, onWywiez }: { planId: string; onWywiez: (id: string) => Promise<void> | void }) {
  const [palety, setPalety] = useState<PaletaBezKodu[]>([])
  const [otwarte, setOtwarte] = useState(false)
  const [wToku, setWToku] = useState<string | null>(null)

  const wczytaj = useCallback(async () => {
    try {
      const lista = (await seasonedPalletsApi.list('in_cold')) as PaletaBezKodu[]
      setPalety(lista.filter(p => p.noLabel && (p.planIds ?? []).includes(planId)).sort((a, b) => a.palletNo - b.palletNo))
    } catch { setPalety([]) }
  }, [planId])
  useEffect(() => { void wczytaj() }, [wczytaj])

  if (!palety.length) return null

  const wywiez = async (p: PaletaBezKodu) => {
    setWToku(p.id)
    try { await onWywiez(p.id) } finally { setWToku(null) }
    setOtwarte(false)
    void wczytaj()
  }

  return (
    <>
      <button type="button" onClick={() => setOtwarte(true)}
        className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
        style={{ border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 8, background: 'var(--panel)' }}>
        Palety bez kodu ({palety.length})
      </button>
      {otwarte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
          <div data-testid="okno-bez-kodu" className="flex flex-col gap-5 p-6" style={{
            width: 820, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
            border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
          }}>
            <div className="flex items-center gap-4">
              <div>
                <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Palety bez kodu QR</h3>
                <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
                  Palety z chłodni sprzed wdrożenia, w planie na dziś. Dotknij paletę, którą bierzesz na halę.
                </p>
              </div>
              <button type="button" onClick={() => setOtwarte(false)} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {palety.map(p => (
                <button key={p.id} type="button" disabled={wToku !== null} onClick={() => void wywiez(p)}
                  aria-label={`Wywieź paletę ${p.palletNo}`}
                  className="flex items-center gap-4 text-left"
                  style={{ padding: '14px 18px', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)', opacity: wToku && wToku !== p.id ? .5 : 1 }}>
                  <span className="flex-1">
                    <span className="block text-[18px] font-extrabold">Paleta {p.palletNo} · partia <span className="hmi-v10-mono">{p.batchNo}</span></span>
                    <span className="block text-[14px] font-bold" style={{ color: 'var(--mut)' }}>{p.recipeName} · {fmt(p.kgWeighed)} kg</span>
                  </span>
                  <span className="text-[16px] font-extrabold" style={{ color: 'var(--accent)' }}>{wToku === p.id ? 'Sprawdzam…' : 'Wywieź'}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
