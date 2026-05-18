import { useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { keyframes } from '@emotion/react'
import {
  Box, Paper, Card, CardContent, CardHeader, Typography, Grid, Stack,
  Chip, LinearProgress, Avatar, Divider, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Skeleton, alpha,
} from '@mui/material'
import {
  RestaurantOutlined, Inventory2Outlined, WarningAmberRounded,
  CheckCircleOutlineRounded, ContentCutOutlined, SoupKitchenOutlined,
  FactoryOutlined, LocalShippingOutlined, AccessTimeRounded,
  BoltRounded, InfoOutlined, ArrowForwardRounded, AutoAwesomeOutlined,
  CategoryOutlined, ScheduleRounded,
} from '@mui/icons-material'

import { muiTheme } from '@/lib/muiTheme'
import { useApi } from '@/hooks/useApi'
import {
  rawBatchesApi, meatStockApi, seasonedMeatApi,
  productionPlansApi, mixingOrdersApi, clientOrdersApi, finishedGoodsApi,
  deboningApi,
} from '@/lib/apiClient'
import { fmtKg, fmtDatePl, getExpiryStatus, todayIso } from '@/lib/utils'
import { computeDisplayStatus } from '@/components/ui/badge'

const POLL_MS = 7000
const KG_PER_CONTAINER = 15

// ── Animacje ────────────────────────────────────────────────────────────
const pingKf = keyframes`
  0%   { transform: scale(1);   opacity: 0.55; }
  100% { transform: scale(2.8); opacity: 0; }
`
const pulseKf = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
`

// ── Helpers ─────────────────────────────────────────────────────────────
function LiveDot({ color = '#10B981', size = 8 }: { color?: string; size?: number }) {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0 }}>
      <Box sx={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        bgcolor: color, animation: `${pingKf} 1.6s infinite ease-out`,
      }} />
      <Box sx={{
        position: 'relative', borderRadius: '50%',
        bgcolor: color, width: size, height: size,
      }} />
    </Box>
  )
}

type Tone = 'primary' | 'success' | 'warning' | 'error' | 'secondary'
const TONE_COLOR: Record<Tone, string> = {
  primary:   '#1D4ED8',
  success:   '#059669',
  warning:   '#D97706',
  error:     '#DC2626',
  secondary: '#7C3AED',
}

// ── Hero / Status bar ───────────────────────────────────────────────────
function MuiHero() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const date = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <Card sx={{ mb: 3, overflow: 'hidden' }}>
      <Box sx={{
        position: 'relative',
        background: 'linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 60%)',
        p: { xs: 2.5, sm: 3 },
      }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          spacing={2.5}
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={1.5} mb={1.25}>
              <LiveDot />
              <Typography variant="overline" sx={{ color: 'text.primary', fontWeight: 700 }}>
                Na żywo
              </Typography>
              <Box sx={{ color: 'text.disabled' }}>·</Box>
              <Typography variant="caption" color="text.secondary">
                odświeżanie co {POLL_MS / 1000} s
              </Typography>
            </Stack>
            <Typography variant="h4" fontWeight={500} sx={{ fontSize: { xs: '1.5rem', md: '1.85rem' }, mb: 0.5 }}>
              Dashboard{' '}
              <Box component="span" sx={{
                fontFamily: '"Instrument Serif", serif',
                fontStyle: 'italic',
                fontSize: { xs: '1.7rem', md: '2.1rem' },
                color: 'primary.main',
                fontWeight: 400,
                ml: 0.5,
              }}>
                produkcji
              </Box>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Surowiec · Rozbiór · Masowanie · Produkcja · Magazyn · Zamówienia
            </Typography>
          </Box>

          <Stack
            direction="row"
            divider={<Divider orientation="vertical" flexItem />}
            spacing={0}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Box sx={{ px: 2.5, py: 1.25, textAlign: 'right', minWidth: 96 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block', lineHeight: 1 }}>
                Czas
              </Typography>
              <Typography sx={{
                fontFamily: '"JetBrains Mono", monospace', fontWeight: 500,
                fontSize: '1.05rem', mt: 0.5, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                {time}
              </Typography>
            </Box>
            <Box sx={{ px: 2.5, py: 1.25, textAlign: 'right', minWidth: 124 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.6rem', display: 'block', lineHeight: 1 }}>
                Data
              </Typography>
              <Typography sx={{
                fontFamily: '"JetBrains Mono", monospace', fontWeight: 500,
                fontSize: '1.05rem', mt: 0.5, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>
                {date}
              </Typography>
            </Box>
          </Stack>
        </Stack>

        <Box sx={{ mt: 2.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            component={RouterLink}
            to="/office/dashboard-pro"
            size="small"
            variant="contained"
            startIcon={<AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
            sx={{
              fontSize: '0.75rem', fontWeight: 700,
              bgcolor: '#1B3A5C',
              '&:hover': { bgcolor: '#102845' },
            }}
          >
            Komenda centralna
          </Button>
          <Button
            component={RouterLink}
            to="/office/dashboard-classic"
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.75rem' }}
          >
            Klasyczna
          </Button>
          <Chip
            size="small"
            label="MUI"
            color="primary"
            variant="filled"
            sx={{ fontWeight: 700, letterSpacing: '0.06em' }}
          />
        </Box>
      </Box>
    </Card>
  )
}

// ── KPI Card ────────────────────────────────────────────────────────────
function MuiKpi({ label, value, unit, sub, icon, tone, tooltip }: {
  label: string
  value: React.ReactNode
  unit?: string
  sub?: string
  icon: React.ReactNode
  tone: Tone
  tooltip?: string
}) {
  const c = TONE_COLOR[tone]
  return (
    <Card sx={{
      position: 'relative',
      overflow: 'hidden',
      height: '100%',
      '&:hover': { boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)' },
    }}>
      <Box sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${alpha(c, 0.4)} 0%, ${c} 50%, ${alpha(c, 0.4)} 100%)`,
      }} />
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} mb={1.5}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
              {label}
            </Typography>
            {tooltip && (
              <Tooltip title={tooltip} arrow placement="top">
                <InfoOutlined sx={{ fontSize: 12, color: 'text.disabled', cursor: 'help' }} />
              </Tooltip>
            )}
          </Stack>
          <Avatar variant="rounded" sx={{
            width: 36, height: 36,
            bgcolor: alpha(c, 0.10),
            color: c,
            border: `1px solid ${alpha(c, 0.20)}`,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}>
            {icon}
          </Avatar>
        </Stack>
        <Stack direction="row" alignItems="baseline" spacing={0.75}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 600,
            fontSize: '1.65rem',
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
            color: tone === 'error' ? 'error.main' : 'text.primary',
            lineHeight: 1.05,
          }}>
            {value}
          </Typography>
          {unit && (
            <Typography variant="body2" color="text.secondary" fontWeight={500}>{unit}</Typography>
          )}
        </Stack>
        {sub && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25, lineHeight: 1.4 }}>
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

// ── Section Card (live ops + stock) ─────────────────────────────────────
function SectionCard({
  title, subtitle, icon, tone = 'primary', live, action, children,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  tone?: Tone
  live?: boolean
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const c = TONE_COLOR[tone]
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardHeader
        avatar={
          <Avatar variant="rounded" sx={{
            width: 36, height: 36,
            bgcolor: alpha(c, 0.10), color: c,
            border: `1px solid ${alpha(c, 0.20)}`,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}>
            {icon}
          </Avatar>
        }
        title={title}
        subheader={subtitle}
        action={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ pr: 1, pt: 0.5 }}>
            {live && (
              <Chip
                size="small"
                icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: c, animation: `${pulseKf} 1.6s infinite` }} />}
                label="Na żywo"
                sx={{
                  bgcolor: alpha(c, 0.10),
                  color: c,
                  border: `1px solid ${alpha(c, 0.20)}`,
                  '& .MuiChip-icon': { ml: 1, mr: -0.25 },
                  height: 22,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              />
            )}
            {action}
          </Stack>
        }
        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      />
      <Box sx={{ flex: 1, p: 2.5, minHeight: 0 }}>
        {children}
      </Box>
    </Card>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" py={5} spacing={1}>
      <Box sx={{ color: 'text.disabled', opacity: 0.5, '& .MuiSvgIcon-root': { fontSize: 36 } }}>{icon}</Box>
      <Typography sx={{
        fontFamily: '"Instrument Serif", serif', fontStyle: 'italic',
        fontSize: '1.15rem', color: 'text.secondary',
      }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.disabled" textAlign="center" maxWidth={280}>
          {description}
        </Typography>
      )}
    </Stack>
  )
}

function ProgressLine({ label, value, total, tone, suffix = 'kg' }: {
  label: string; value: number; total: number; tone: Tone; suffix?: string
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  const c = TONE_COLOR[tone]
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
        <Typography variant="overline" sx={{ fontSize: '0.6rem' }} color="text.secondary">{label}</Typography>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums',
        }}>
          <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{fmtKg(value, 0)} {suffix}</Box>
          <Box component="span" sx={{ color: 'text.disabled' }}> / {fmtKg(total, 0)} {suffix}</Box>
          <Box component="span" sx={{ ml: 1, fontWeight: 700, color: c }}>{pct.toFixed(0)}%</Box>
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 8, borderRadius: 99,
          backgroundColor: alpha(c, 0.10),
          '& .MuiLinearProgress-bar': { backgroundColor: c },
        }}
      />
    </Box>
  )
}

// ────────────────────────────────────────────────────────────────────────
// DashboardMuiPage
// ────────────────────────────────────────────────────────────────────────
export function DashboardMuiPage() {
  const batchRes    = useApi(() => rawBatchesApi.list({ active_only: true, limit: 500 }))
  const meatRes     = useApi(() => meatStockApi.list())
  const seasonedRes = useApi(() => seasonedMeatApi.list())
  const plansRes    = useApi(() => productionPlansApi.list())
  const mixingRes   = useApi(() => mixingOrdersApi.list())
  const ordersRes   = useApi(() => clientOrdersApi.list())
  const finishedRes = useApi(() => finishedGoodsApi.list())
  const deboningRes = useApi(() => deboningApi.list())

  useEffect(() => {
    const t = setInterval(() => {
      batchRes.refetch(); meatRes.refetch(); seasonedRes.refetch()
      plansRes.refetch(); mixingRes.refetch(); ordersRes.refetch()
      finishedRes.refetch(); deboningRes.refetch()
    }, POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allBatches  = batchRes.data?.data    ?? []
  const allMeat     = meatRes.data?.data     ?? []
  const allSeasoned = seasonedRes.data       ?? []
  const allPlans    = plansRes.data          ?? []
  const allMixing   = mixingRes.data         ?? []
  const allOrders   = ordersRes.data         ?? []
  const allFinished = finishedRes.data       ?? []
  const allDeboning = deboningRes.data?.data ?? []

  const initialLoading =
    (batchRes.loading && !batchRes.data) ||
    (meatRes.loading && !meatRes.data) ||
    (seasonedRes.loading && !seasonedRes.data)

  // ── Rozbiór ─────────────────────────────────────────────────────
  const today    = todayIso()
  const todayDeb = useMemo(
    () => allDeboning.filter((d: any) => (d.createdAt ?? d.created_at ?? '').slice(0, 10) === today),
    [allDeboning, today],
  )
  const debKgQuarter = todayDeb.reduce((s: number, d: any) => s + Number(d.kgTaken ?? d.kg_taken ?? 0), 0)

  // ── Ćwiartka + Mięso z/s + Mięso przyp ──────────────────────────
  const activeBatches = allBatches.filter(b => computeDisplayStatus(b.expiryDate, Number(b.kgAvailable)) !== 'used')
  const totalKgRaw      = activeBatches.reduce((s, b) => s + Number(b.kgAvailable), 0)
  const totalContainers = Math.ceil(totalKgRaw / KG_PER_CONTAINER)

  const availableMeat = allMeat.filter(m => m.status === 'AVAILABLE' && Number(m.kgAvailable) > 0)
  const totalKgMeat   = availableMeat.reduce((s, m) => s + Number(m.kgAvailable), 0)

  const meatByBatch = useMemo(() => {
    const m = new Map<string, { rawBatchNo: string; kg: number; lots: number; earliestExpiry: string }>()
    availableMeat.forEach(item => {
      const key = item.rawBatchNo ?? '—'
      const cur = m.get(key)
      if (cur) {
        cur.kg += Number(item.kgAvailable); cur.lots += 1
        if (item.expiryDate && (!cur.earliestExpiry || item.expiryDate < cur.earliestExpiry)) {
          cur.earliestExpiry = item.expiryDate
        }
      } else {
        m.set(key, { rawBatchNo: key, kg: Number(item.kgAvailable), lots: 1, earliestExpiry: item.expiryDate ?? '' })
      }
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableMeat])

  const availableSeasoned = allSeasoned.filter(s => Number(s.kgAvailable) > 0)
  const totalKgSeasoned   = availableSeasoned.reduce((s, b) => s + Number(b.kgAvailable), 0)

  const seasonedByRecipe = useMemo(() => {
    const m = new Map<string, { recipeName: string; kg: number; batches: number }>()
    availableSeasoned.forEach(b => {
      const key = b.recipeName || '—'
      const cur = m.get(key)
      if (cur) { cur.kg += Number(b.kgAvailable); cur.batches += 1 }
      else m.set(key, { recipeName: key, kg: Number(b.kgAvailable), batches: 1 })
    })
    return Array.from(m.values()).sort((a, b) => b.kg - a.kg)
  }, [availableSeasoned])

  // ── Krótki termin ───────────────────────────────────────────────
  const expired  = activeBatches.filter(b => getExpiryStatus(b.expiryDate).daysLeft < 0)
  const critical = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 0 && d <= 1 })
  const warnings = activeBatches.filter(b => { const d = getExpiryStatus(b.expiryDate).daysLeft; return d >= 2 && d <= 3 })
  const shortTermCount = expired.length + critical.length + warnings.length
  const shortTermTone: Tone = expired.length > 0 ? 'error' : (critical.length + warnings.length) > 0 ? 'warning' : 'success'

  // ── Masowanie ───────────────────────────────────────────────────
  const activeMixing = allMixing.filter(o => o.status !== 'done' && o.status !== 'cancelled')
  const mixPlanned   = activeMixing.reduce((s, o) => s + Number(o.meatKg), 0)
  const mixDone      = activeMixing.reduce((s, o) => s + Number(o.kgDone), 0)

  // ── Produkcja ───────────────────────────────────────────────────
  const activePlans = allPlans.filter(p => p.status !== 'done' && p.status !== 'draft')
  const finishedKgByPlan = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => {
      const k = f.planNo ?? ''; if (!k) return
      m.set(k, (m.get(k) ?? 0) + Number(f.totalKg ?? 0))
    })
    return m
  }, [allFinished])

  const producedKgForPlan = (p: any) => {
    const finished = finishedKgByPlan.get(p.planNo) ?? 0
    const inProgress = (p.lines ?? []).reduce(
      (s: number, l: any) => s + (Number(l.qtyDone) || 0) * (Number(l.kgPerUnit) || 0), 0,
    )
    return finished + inProgress
  }
  const prodPlanned  = activePlans.reduce((s, p) => s + Number(p.totalKg), 0)
  const prodProduced = activePlans.reduce((s, p) => s + producedKgForPlan(p), 0)

  const productionTypes = useMemo(() => {
    type Bucket = {
      key: string; recipeName: string; kgPerUnit: number; packagingName: string
      qtyPlanned: number; qtyDone: number; kgPlanned: number; kgDone: number
      inProgress: boolean; done: boolean
    }
    const m = new Map<string, Bucket>()
    for (const p of activePlans) {
      for (const l of (p.lines ?? [])) {
        const recipeName = l.recipeName || '—'
        const kgPerUnit = Number(l.kgPerUnit) || 0
        const packagingName = (l as any).packagingName || ''
        const key = `${recipeName}|${kgPerUnit}|${packagingName}`
        const qty = Number(l.qty) || 0
        const qtyDone = Number((l as any).qtyDone) || 0
        const status = ((l as any).lineStatus ?? 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
        const cur = m.get(key) ?? {
          key, recipeName, kgPerUnit, packagingName,
          qtyPlanned: 0, qtyDone: 0, kgPlanned: 0, kgDone: 0,
          inProgress: false, done: true,
        }
        cur.qtyPlanned += qty; cur.qtyDone += qtyDone
        cur.kgPlanned += qty * kgPerUnit; cur.kgDone += qtyDone * kgPerUnit
        if (status === 'IN_PROGRESS') cur.inProgress = true
        if (status !== 'DONE')        cur.done = false
        m.set(key, cur)
      }
    }
    return Array.from(m.values()).sort((a, b) => {
      const aw = a.inProgress ? 0 : a.qtyDone > 0 ? 1 : 2
      const bw = b.inProgress ? 0 : b.qtyDone > 0 ? 1 : 2
      if (aw !== bw) return aw - bw
      return b.kgPlanned - a.kgPlanned
    })
  }, [activePlans])

  // ── Zamówienia ──────────────────────────────────────────────────
  const finishedQtyByOrderNo = useMemo(() => {
    const m = new Map<string, number>()
    allFinished.forEach((f: any) => {
      const k = f.clientOrderNo ?? ''; if (!k) return
      m.set(k, (m.get(k) ?? 0) + Number(f.qty ?? 0))
    })
    return m
  }, [allFinished])

  const inProgressQtyByOrderId = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of activePlans) for (const l of (p.lines ?? [])) {
      const orderId = (l as any).clientOrderId || ''
      const qtyDone = Number((l as any).qtyDone) || 0
      if (qtyDone <= 0 || !orderId) continue
      m.set(orderId, (m.get(orderId) ?? 0) + qtyDone)
    }
    return m
  }, [activePlans])

  const visibleOrders = useMemo(() => [...allOrders]
    .filter(o => o.status !== 'done' && o.status !== 'cancelled')
    .sort((a, b) => (a.deliveryDate || '9999-12-31').localeCompare(b.deliveryDate || '9999-12-31')),
    [allOrders])

  // ── Loading ─────────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <ThemeProvider theme={muiTheme}>
        <Box>
          <Skeleton variant="rounded" height={140} sx={{ mb: 3 }} />
          <Grid container spacing={3}>
            {[0,1,2,3].map(i => (
              <Grid key={i} item xs={12} sm={6} xl={3}>
                <Skeleton variant="rounded" height={140} />
              </Grid>
            ))}
          </Grid>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <Box sx={{ fontFamily: '"Roboto", "Inter", sans-serif' }}>

        {/* ── HERO ───────────────────────────────────────────────── */}
        <MuiHero />

        {/* ── KPI ROW ───────────────────────────────────────────── */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={6} xl={3}>
            <MuiKpi
              label="Ćwiartka dostępna"
              value={fmtKg(totalKgRaw, 0)}
              unit="kg"
              sub={`${totalContainers} poj. · ${activeBatches.length} partii`}
              icon={<RestaurantOutlined />}
              tone="primary"
              tooltip={`Łączna kg ćwiartki w aktywnych partiach. Pojemnik = ${KG_PER_CONTAINER} kg.`}
            />
          </Grid>
          <Grid item xs={12} sm={6} xl={3}>
            <MuiKpi
              label="Mięso z/s po rozbiorze"
              value={fmtKg(totalKgMeat, 0)}
              unit="kg"
              sub={`${meatByBatch.length} partii`}
              icon={<Inventory2Outlined />}
              tone="success"
              tooltip="Mięso po rozbiorze gotowe do masowania (AVAILABLE)"
            />
          </Grid>
          <Grid item xs={12} sm={6} xl={3}>
            <MuiKpi
              label="Mięso przyprawione"
              value={fmtKg(totalKgSeasoned, 0)}
              unit="kg"
              sub={`${seasonedByRecipe.length} receptur`}
              icon={<CategoryOutlined />}
              tone="secondary"
              tooltip="Mięso po masowaniu, gotowe do produkcji"
            />
          </Grid>
          <Grid item xs={12} sm={6} xl={3}>
            <MuiKpi
              label="Krótki termin"
              value={shortTermCount}
              unit="partii"
              sub={
                expired.length > 0
                  ? `${expired.length} po terminie · ${critical.length + warnings.length} krótkich`
                  : (critical.length + warnings.length) > 0
                    ? `${critical.length + warnings.length} kończy się ≤3 dni`
                    : 'Brak alertów — wszystko OK'
              }
              icon={shortTermTone === 'success' ? <CheckCircleOutlineRounded /> : <WarningAmberRounded />}
              tone={shortTermTone}
              tooltip="Partie ćwiartki — kategoria krótkiego terminu"
            />
          </Grid>
        </Grid>

        {/* ── ALERTY ─────────────────────────────────────────────── */}
        {(expired.length + critical.length) > 0 && (
          <Card sx={{
            mb: 3,
            borderColor: alpha(TONE_COLOR.error, 0.30),
            bgcolor: alpha(TONE_COLOR.error, 0.04),
          }}>
            <CardHeader
              avatar={<Avatar variant="rounded" sx={{ bgcolor: alpha(TONE_COLOR.error, 0.12), color: 'error.main', width: 32, height: 32 }}>
                <WarningAmberRounded sx={{ fontSize: 18 }} />
              </Avatar>}
              title={<Typography fontWeight={700} color="error.main">Krótki termin — po terminie lub wygasa dziś/jutro</Typography>}
              action={<Chip size="small" color="error" label={`${expired.length + critical.length} ${(expired.length + critical.length) === 1 ? 'partia' : 'partii'}`} sx={{ mt: 0.5, mr: 1 }} />}
              sx={{ borderBottom: '1px solid', borderColor: alpha(TONE_COLOR.error, 0.20), bgcolor: alpha(TONE_COLOR.error, 0.04) }}
            />
            <TableContainer>
              <Table size="small">
                <TableBody>
                  {[...expired, ...critical].map(b => {
                    const { daysLeft } = getExpiryStatus(b.expiryDate)
                    return (
                      <TableRow key={b.id} sx={{ '&:hover': { bgcolor: alpha(TONE_COLOR.error, 0.06) } }}>
                        <TableCell sx={{ width: 130 }}>
                          <Chip
                            size="small"
                            label={b.internalBatchNo}
                            sx={{
                              fontFamily: 'monospace', fontWeight: 700,
                              bgcolor: alpha(TONE_COLOR.error, 0.12),
                              color: 'error.main', borderRadius: 1,
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="error.main">
                            {daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : 'Wygasa jutro'}
                            {' — '}{fmtDatePl(b.expiryDate)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'error.dark', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtKg(b.kgAvailable)} kg
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )}

        {warnings.length > 0 && (
          <Card sx={{
            mb: 3,
            borderColor: alpha(TONE_COLOR.warning, 0.30),
            bgcolor: alpha(TONE_COLOR.warning, 0.04),
          }}>
            <CardHeader
              avatar={<Avatar variant="rounded" sx={{ bgcolor: alpha(TONE_COLOR.warning, 0.12), color: 'warning.main', width: 32, height: 32 }}>
                <ScheduleRounded sx={{ fontSize: 18 }} />
              </Avatar>}
              title={<Typography fontWeight={700} color="warning.dark">Krótki termin — wygasa w 2–3 dni</Typography>}
              action={<Chip size="small" color="warning" label={`${warnings.length} ${warnings.length === 1 ? 'partia' : 'partii'}`} sx={{ mt: 0.5, mr: 1 }} />}
              sx={{ borderBottom: '1px solid', borderColor: alpha(TONE_COLOR.warning, 0.20) }}
            />
            <TableContainer>
              <Table size="small">
                <TableBody>
                  {warnings.map(b => {
                    const { daysLeft } = getExpiryStatus(b.expiryDate)
                    return (
                      <TableRow key={b.id} sx={{ '&:hover': { bgcolor: alpha(TONE_COLOR.warning, 0.06) } }}>
                        <TableCell sx={{ width: 130 }}>
                          <Chip size="small" label={b.internalBatchNo}
                            sx={{ fontFamily: 'monospace', fontWeight: 700, bgcolor: alpha(TONE_COLOR.warning, 0.12), color: 'warning.dark', borderRadius: 1 }} />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="warning.dark">
                            Za {daysLeft} {daysLeft === 1 ? 'dzień' : 'dni'} — {fmtDatePl(b.expiryDate)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'warning.dark', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtKg(b.kgAvailable)} kg
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )}

        {/* ── LIVE OPS ──────────────────────────────────────────── */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {/* Rozbiór */}
          <Grid item xs={12} lg={4}>
            <SectionCard
              title="Rozbiór"
              subtitle={`Dzisiaj · ${todayDeb.length} ${todayDeb.length === 1 ? 'sesja' : 'sesji'}`}
              icon={<ContentCutOutlined />}
              tone="warning"
              live
            >
              <Stack spacing={2}>
                <ProgressLine
                  label="Pobrane dziś"
                  value={debKgQuarter}
                  total={totalKgRaw + debKgQuarter}
                  tone="warning"
                />
                <Divider />
                {activeBatches.length === 0 ? (
                  <EmptyState icon={<ContentCutOutlined />} title="brak partii w magazynie"
                    description="Po przyjęciu surowca partie pojawią się tutaj" />
                ) : (
                  <Stack spacing={1.5} sx={{ maxHeight: 280, overflowY: 'auto', pr: 0.5 }}>
                    <Typography variant="overline" sx={{ fontSize: '0.6rem' }} color="text.secondary">
                      Partie w magazynie · {activeBatches.length}
                    </Typography>
                    {[...activeBatches]
                      .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''))
                      .map(b => {
                        const available = Number(b.kgAvailable) || 0
                        const received  = Number(b.kgReceived) || 0
                        const pctLeft   = received > 0 ? (available / received) * 100 : 0
                        const pctColor  = pctLeft >= 50 ? 'success.main' : pctLeft >= 20 ? 'warning.main' : 'error.main'
                        return (
                          <Box key={b.id} sx={{
                            p: 1.25, borderRadius: 1.5,
                            '&:hover': { bgcolor: 'action.hover' },
                          }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}>
                                  {b.internalBatchNo}
                                </Typography>
                                {b.supplierDisplayName && (
                                  <Typography variant="caption" color="text.secondary"> · {b.supplierDisplayName}</Typography>
                                )}
                              </Box>
                              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                                <Typography variant="caption" sx={{
                                  fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                                }}>
                                  {fmtKg(available, 0)} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>/ {fmtKg(received, 0)} kg</Box>
                                </Typography>
                                <Typography variant="caption" sx={{ ml: 1, color: pctColor, fontWeight: 700 }}>
                                  {pctLeft.toFixed(0)}%
                                </Typography>
                              </Box>
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={pctLeft}
                              sx={{
                                mt: 0.75, height: 4, borderRadius: 99,
                                bgcolor: alpha('#000', 0.06),
                                '& .MuiLinearProgress-bar': {
                                  bgcolor: pctLeft >= 50 ? 'success.main' : pctLeft >= 20 ? 'warning.main' : 'error.main',
                                },
                              }}
                            />
                          </Box>
                        )
                      })}
                  </Stack>
                )}
              </Stack>
            </SectionCard>
          </Grid>

          {/* Masowanie */}
          <Grid item xs={12} lg={4}>
            <SectionCard
              title="Masowanie"
              subtitle={`Aktywne zlecenia · ${activeMixing.length}`}
              icon={<SoupKitchenOutlined />}
              tone="secondary"
              live
            >
              <Stack spacing={2}>
                <ProgressLine label="Postęp łączny" value={mixDone} total={mixPlanned} tone="secondary" />
                <Divider />
                {activeMixing.length === 0 ? (
                  <EmptyState icon={<SoupKitchenOutlined />} title="brak aktywnych zleceń masowania" />
                ) : (
                  <Stack spacing={1.5} sx={{ maxHeight: 280, overflowY: 'auto', pr: 0.5 }}>
                    {activeMixing.map(m => {
                      const pct = Number(m.meatKg) > 0 ? (Number(m.kgDone) / Number(m.meatKg)) * 100 : 0
                      return (
                        <Box key={m.id} sx={{ p: 1.25, borderRadius: 1.5, '&:hover': { bgcolor: 'action.hover' } }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                              {fmtKg(m.kgDone, 0)} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>/ {fmtKg(m.meatKg, 0)} kg</Box>
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 700 }}>{pct.toFixed(0)}%</Typography>
                          </Stack>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }} noWrap>{m.recipeName}</Typography>
                          <LinearProgress variant="determinate" value={Math.min(100, pct)} color="secondary" sx={{ height: 4 }} />
                        </Box>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            </SectionCard>
          </Grid>

          {/* Produkcja */}
          <Grid item xs={12} lg={4}>
            <SectionCard
              title="Produkcja"
              subtitle={`Aktywne plany · ${activePlans.length}`}
              icon={<FactoryOutlined />}
              tone="primary"
              live
            >
              <Stack spacing={2}>
                <ProgressLine label="Postęp łączny" value={prodProduced} total={prodPlanned} tone="primary" />
                <Divider />
                {productionTypes.length === 0 ? (
                  <EmptyState icon={<FactoryOutlined />} title="brak aktywnych planów"
                    description="Aktywuj plan w sekcji Planowanie produkcji" />
                ) : (
                  <Stack spacing={1.5} sx={{ maxHeight: 280, overflowY: 'auto', pr: 0.5 }}>
                    {productionTypes.map(t => {
                      const pct = t.kgPlanned > 0 ? (t.kgDone / t.kgPlanned) * 100 : 0
                      const color = t.done ? 'success.main' : t.inProgress ? 'warning.main' : 'primary.main'
                      return (
                        <Box key={t.key} sx={{
                          p: 1.25, borderRadius: 1.5,
                          bgcolor: t.inProgress ? alpha(TONE_COLOR.warning, 0.06) : 'transparent',
                          border: t.inProgress ? `1px solid ${alpha(TONE_COLOR.warning, 0.20)}` : '1px solid transparent',
                          '&:hover': { bgcolor: t.inProgress ? alpha(TONE_COLOR.warning, 0.08) : 'action.hover' },
                        }}>
                          <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="caption" fontWeight={t.inProgress ? 700 : 600} noWrap sx={{ display: 'block' }}>
                                {t.recipeName} · {t.kgPerUnit}kg
                              </Typography>
                              {t.packagingName && (
                                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.68rem' }}>
                                  {t.packagingName}
                                </Typography>
                              )}
                            </Box>
                            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                                {t.qtyDone} <Box component="span" sx={{ color: 'text.disabled', fontWeight: 400 }}>/ {t.qtyPlanned} szt</Box>
                              </Typography>
                              <Typography variant="caption" sx={{ ml: 1, color, fontWeight: 700 }}>
                                {pct.toFixed(0)}%
                              </Typography>
                            </Box>
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(100, pct)}
                            sx={{
                              mt: 0.75, height: 4, borderRadius: 99,
                              bgcolor: alpha('#000', 0.06),
                              '& .MuiLinearProgress-bar': { bgcolor: color },
                            }}
                          />
                        </Box>
                      )
                    })}
                  </Stack>
                )}
              </Stack>
            </SectionCard>
          </Grid>
        </Grid>

        {/* ── STOCK ROW ────────────────────────────────────────── */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} lg={6}>
            <SectionCard
              title="Mięso z/s — po rozbiorze"
              subtitle={`Suma kg per partia · ${meatByBatch.length} partii`}
              icon={<Inventory2Outlined />}
              tone="success"
              action={
                <Button
                  component={RouterLink}
                  to="/office/magazyn/surowiec"
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowForwardRounded sx={{ fontSize: 14 }} />}
                  sx={{ fontSize: '0.72rem' }}
                >
                  Magazyn
                </Button>
              }
            >
              {meatByBatch.length === 0 ? (
                <EmptyState icon={<Inventory2Outlined />} title="brak mięsa w magazynie" description="Wykonaj rozbiór aby zasilić magazyn" />
              ) : (
                <TableContainer sx={{ maxHeight: 320, mx: -2.5, mt: -1 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Partia surowca</TableCell>
                        <TableCell align="center">Lotów</TableCell>
                        <TableCell>Najbl. ważność</TableCell>
                        <TableCell align="right">Razem</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {meatByBatch.map(g => (
                        <TableRow key={g.rawBatchNo} hover>
                          <TableCell>
                            <Chip size="small" label={g.rawBatchNo} sx={{ fontFamily: 'monospace', fontWeight: 700, bgcolor: 'grey.100' }} />
                          </TableCell>
                          <TableCell align="center">
                            <Chip size="small" label={g.lots} variant="outlined" sx={{ fontFamily: 'monospace', minWidth: 36 }} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption">{g.earliestExpiry ? fmtDatePl(g.earliestExpiry) : '—'}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {fmtKg(g.kg, 1)} kg
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </SectionCard>
          </Grid>

          <Grid item xs={12} lg={6}>
            <SectionCard
              title="Mięso przyprawione — magazyn"
              subtitle={`Suma kg per receptura · ${seasonedByRecipe.length} receptur`}
              icon={<CategoryOutlined />}
              tone="secondary"
              action={
                <Button
                  component={RouterLink}
                  to="/office/magazyn/mieso-przyp"
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowForwardRounded sx={{ fontSize: 14 }} />}
                  sx={{ fontSize: '0.72rem' }}
                >
                  Magazyn
                </Button>
              }
            >
              {seasonedByRecipe.length === 0 ? (
                <EmptyState icon={<CategoryOutlined />} title="brak mięsa przyprawionego" description="Zakończ zlecenie masowania" />
              ) : (
                <TableContainer sx={{ maxHeight: 320, mx: -2.5, mt: -1 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Receptura</TableCell>
                        <TableCell align="center">Szarż</TableCell>
                        <TableCell align="right">Razem</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {seasonedByRecipe.map(g => (
                        <TableRow key={g.recipeName} hover>
                          <TableCell>
                            <Typography fontWeight={600}>{g.recipeName}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Chip size="small" label={g.batches} variant="outlined" sx={{ fontFamily: 'monospace', minWidth: 36 }} />
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontFamily: 'monospace', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                              {fmtKg(g.kg, 1)} kg
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </SectionCard>
          </Grid>
        </Grid>

        {/* ── ZAMÓWIENIA ───────────────────────────────────────── */}
        <SectionCard
          title="Zamówienia od klientów"
          subtitle={`Sortowanie od najszybszej daty wyjazdu · ${visibleOrders.length} aktywnych`}
          icon={<LocalShippingOutlined />}
          tone="warning"
          action={
            <Button
              component={RouterLink}
              to="/office/zamowienia"
              size="small"
              variant="outlined"
              endIcon={<ArrowForwardRounded sx={{ fontSize: 14 }} />}
              sx={{ fontSize: '0.72rem' }}
            >
              Wszystkie
            </Button>
          }
        >
          {visibleOrders.length === 0 ? (
            <EmptyState icon={<LocalShippingOutlined />} title="brak aktywnych zamówień" description="Utwórz zamówienie w sekcji Zamówienia" />
          ) : (
            <Stack divider={<Divider />} spacing={0} sx={{ mx: -2.5, mt: -2.5 }}>
              {visibleOrders.map(o => {
                const finished   = finishedQtyByOrderNo.get(o.orderNo) ?? 0
                const inProgress = inProgressQtyByOrderId.get(o.id) ?? 0
                const qtyDone    = finished + inProgress
                const qtyTotal   = Number(o.totalUnits ?? 0)
                const pct        = qtyTotal > 0 ? (qtyDone / qtyTotal) * 100 : 0
                const isDue      = o.deliveryDate ? new Date(o.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48 : false
                const progressColor = pct >= 100 ? TONE_COLOR.success : pct > 0 ? TONE_COLOR.warning : TONE_COLOR.primary

                return (
                  <Box key={o.id} sx={{ p: 2, '&:hover': { bgcolor: 'action.hover' } }}>
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap mb={1}>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'primary.main' }}>
                            {o.orderNo}
                          </Typography>
                          <Typography fontWeight={600} sx={{ fontSize: '0.875rem' }} noWrap>
                            {o.clientName}
                          </Typography>
                          {inProgress > 0 && (
                            <Chip
                              size="small"
                              icon={<BoltRounded sx={{ fontSize: '12px !important', color: 'warning.dark' }} />}
                              label="w produkcji"
                              sx={{
                                bgcolor: alpha(TONE_COLOR.warning, 0.12),
                                color: 'warning.dark',
                                border: `1px solid ${alpha(TONE_COLOR.warning, 0.30)}`,
                                fontSize: '0.62rem',
                                height: 20,
                                '& .MuiChip-icon': { ml: 0.5, mr: -0.25 },
                              }}
                            />
                          )}
                          {o.deliveryDate && (
                            <Chip
                              size="small"
                              icon={<LocalShippingOutlined sx={{ fontSize: '12px !important' }} />}
                              label={fmtDatePl(o.deliveryDate)}
                              color={isDue ? 'error' : 'default'}
                              variant={isDue ? 'filled' : 'outlined'}
                              sx={{ fontSize: '0.62rem', height: 20, '& .MuiChip-icon': { ml: 0.5, mr: -0.25 } }}
                            />
                          )}
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={2}>
                          <Box sx={{ flex: 1, maxWidth: 400 }}>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, pct)}
                              sx={{
                                height: 6, borderRadius: 99,
                                bgcolor: alpha('#000', 0.06),
                                '& .MuiLinearProgress-bar': { bgcolor: progressColor },
                              }}
                            />
                          </Box>
                          <Typography sx={{
                            fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
                            fontSize: '0.78rem', whiteSpace: 'nowrap',
                          }}>
                            <Box component="span" sx={{ fontWeight: 700 }}>{qtyDone} szt</Box>
                            <Box component="span" sx={{ color: 'text.disabled' }}> / {qtyTotal} szt</Box>
                            <Box component="span" sx={{ ml: 1, fontWeight: 700, color: progressColor }}>{pct.toFixed(0)}%</Box>
                          </Typography>
                        </Stack>
                      </Box>
                    </Stack>
                  </Box>
                )
              })}
            </Stack>
          )}
        </SectionCard>

      </Box>
    </ThemeProvider>
  )
}
