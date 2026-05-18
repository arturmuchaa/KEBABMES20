import { createTheme } from '@mui/material/styles'

// Scoped MUI theme — używany tylko wewnątrz <ThemeProvider> w DashboardMuiPage.
// Reszta aplikacji nadal używa Tailwind + shadcn — bez kolizji.
export const muiTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1D4ED8',
      light: '#3B82F6',
      dark: '#1E40AF',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#7C3AED',
      light: '#A78BFA',
      dark: '#5B21B6',
    },
    success: { main: '#059669', light: '#10B981', dark: '#047857' },
    warning: { main: '#D97706', light: '#F59E0B', dark: '#B45309' },
    error:   { main: '#DC2626', light: '#EF4444', dark: '#B91C1C' },
    info:    { main: '#0EA5E9', light: '#38BDF8', dark: '#0369A1' },
    background: {
      default: '#F8FAFC',
      paper:   '#FFFFFF',
    },
    text: {
      primary:   '#111827',
      secondary: '#6B7280',
      disabled:  '#9CA3AF',
    },
    divider: '#E5E7EB',
  },
  typography: {
    fontFamily: '"Roboto", "Inter", system-ui, -apple-system, sans-serif',
    h1: { fontWeight: 500, letterSpacing: '-0.02em' },
    h2: { fontWeight: 500, letterSpacing: '-0.02em' },
    h3: { fontWeight: 500, letterSpacing: '-0.015em' },
    h4: { fontWeight: 500, letterSpacing: '-0.015em' },
    h5: { fontWeight: 500, letterSpacing: '-0.01em' },
    h6: { fontWeight: 500, letterSpacing: '-0.005em' },
    overline: {
      fontSize: '0.65rem',
      fontWeight: 700,
      letterSpacing: '0.14em',
      lineHeight: 1.5,
    },
    button: { textTransform: 'none', fontWeight: 500 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          borderColor: '#E5E7EB',
          backgroundImage: 'none',
          transition: 'box-shadow 200ms ease, border-color 200ms ease',
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: { padding: '16px 20px' },
        title:    { fontSize: '0.95rem', fontWeight: 600, letterSpacing: '-0.005em' },
        subheader:{ fontSize: '0.8rem', color: '#6B7280' },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 20, '&:last-child': { paddingBottom: 20 } },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, fontWeight: 500 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, letterSpacing: '0.02em' },
        sizeSmall: { fontSize: '0.7rem', height: 22 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, height: 6, backgroundColor: '#F1F5F9' },
        bar:  { borderRadius: 999 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root:  { borderColor: '#F1F5F9', padding: '12px 16px' },
        head:  {
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: '#6B7280',
          backgroundColor: '#F8FAFC',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: '0.7rem', backgroundColor: '#111827' },
      },
    },
  },
})
