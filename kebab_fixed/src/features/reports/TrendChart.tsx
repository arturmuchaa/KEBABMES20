/**
 * TrendChart — trend dzienny rozbioru jako wykres, nie tabela.
 *
 * 17 wierszy liczb nikt nie czyta; kształt widać w sekundę. Słupki = kg mięsa
 * dnia, linia = uzysk %, szara wstęga = pasmo normy. Prezes szuka tu jednej
 * rzeczy: czy linia trzyma się wstęgi i czy nie ma dni odstających.
 *
 * Czysty SVG bez bibliotek, bo to strona do DRUKU: żadnego canvasu (nie
 * wychodzi na papier), żadnych animacji, żadnych zależności zewnętrznych.
 * Skala kolorów = szarości — dokument idzie na czarno-białą drukarkę biurową.
 */
import { YIELD_NORM_PCT } from '@/features/deboning/utils'

export interface TrendPoint {
  date: string
  kgMeat: number
  avgYield: number
}

interface Props {
  points: TrendPoint[]
  /** Średnia okresu — linia odniesienia, do której prezes porównuje dni. */
  avgYield: number
  width?: number
  height?: number
}

const PAD = { top: 14, right: 34, bottom: 26, left: 40 }

/** Zakres osi uzysku: pasmo normy + wszystkie punkty + margines, zaokrąglony
 *  do pełnych p.p. Sztywne 60–70 spłaszczałoby różnice, na których zależy. */
export function yieldScale(points: TrendPoint[]): { lo: number; hi: number } {
  const ys = points.map(p => p.avgYield).filter(y => y > 0)
  const lo = Math.min(YIELD_NORM_PCT.lo, ...(ys.length ? ys : [YIELD_NORM_PCT.lo]))
  const hi = Math.max(YIELD_NORM_PCT.hi, ...(ys.length ? ys : [YIELD_NORM_PCT.hi]))
  return { lo: Math.floor(lo - 1), hi: Math.ceil(hi + 1) }
}

export function TrendChart({ points, avgYield, width = 752, height = 190 }: Props) {
  if (points.length < 2) return null

  const { lo, hi } = yieldScale(points)
  const innerW = width - PAD.left - PAD.right
  const innerH = height - PAD.top - PAD.bottom
  const maxKg = Math.max(...points.map(p => p.kgMeat), 1)

  const slot = innerW / points.length
  const barW = Math.max(3, Math.min(26, slot * 0.6))
  const cx = (i: number) => PAD.left + slot * i + slot / 2
  const yOf = (pct: number) => PAD.top + innerH - ((pct - lo) / (hi - lo)) * innerH
  const kgTop = (kg: number) => PAD.top + innerH - (kg / maxKg) * innerH

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)},${yOf(p.avgYield).toFixed(1)}`)
    .join(' ')
  const dayLabel = (iso: string) => iso.slice(8, 10)
  // Co ile dni podpisywać oś — przy 20+ dniach etykiety zlewają się w kreskę.
  const step = points.length > 20 ? 3 : points.length > 12 ? 2 : 1

  return (
    <svg width={width} height={height} style={{ display: 'block' }}
      role="img" aria-label="Trend dzienny: kg mięsa i uzysk">
      {/* Pasmo normy uzysku — tło, do którego przykłada się linię. */}
      <rect x={PAD.left} y={yOf(YIELD_NORM_PCT.hi)} width={innerW}
        height={Math.max(0, yOf(YIELD_NORM_PCT.lo) - yOf(YIELD_NORM_PCT.hi))}
        fill="#ececec" />
      <text x={PAD.left + innerW + 3} y={yOf(YIELD_NORM_PCT.hi) + 8} fontSize="7.5" fill="#777">
        norma
      </text>

      {/* Siatka i oś uzysku (prawa skala myślowa, podpisy po lewej). */}
      {[lo, Math.round((lo + hi) / 2), hi].map(v => (
        <g key={v}>
          <line x1={PAD.left} x2={PAD.left + innerW} y1={yOf(v)} y2={yOf(v)}
            stroke="#d5d5d5" strokeWidth="0.5" />
          <text x={PAD.left - 5} y={yOf(v) + 3} fontSize="8" fill="#555" textAnchor="end">{v}%</text>
        </g>
      ))}

      {/* Słupki = kg mięsa (skala własna, podpisana maksimum). */}
      {points.map((p, i) => (
        <rect key={p.date} x={cx(i) - barW / 2} y={kgTop(p.kgMeat)}
          width={barW} height={Math.max(0, PAD.top + innerH - kgTop(p.kgMeat))}
          fill="#dcdcdc" stroke="#c2c2c2" strokeWidth="0.5" />
      ))}

      {/* Średnia okresu — linia przerywana. */}
      <line x1={PAD.left} x2={PAD.left + innerW} y1={yOf(avgYield)} y2={yOf(avgYield)}
        stroke="#111" strokeWidth="0.8" strokeDasharray="4 3" />

      {/* Uzysk dnia. */}
      <path d={line} fill="none" stroke="#111" strokeWidth="1.6" />
      {points.map((p, i) => (
        <circle key={p.date} cx={cx(i)} cy={yOf(p.avgYield)} r="2.4" fill="#111" />
      ))}

      {/* Oś dni. */}
      <line x1={PAD.left} x2={PAD.left + innerW} y1={PAD.top + innerH} y2={PAD.top + innerH}
        stroke="#111" strokeWidth="0.8" />
      {points.map((p, i) => (i % step === 0 ? (
        <text key={p.date} x={cx(i)} y={height - 13} fontSize="8" fill="#555" textAnchor="middle">
          {dayLabel(p.date)}
        </text>
      ) : null))}
      <text x={PAD.left} y={height - 3} fontSize="7.5" fill="#777">
        słupki = kg mięsa dnia (maks. {Math.round(maxKg).toLocaleString('pl-PL')} kg) ·
        linia = uzysk dnia · przerywana = średnia okresu
      </text>
    </svg>
  )
}
