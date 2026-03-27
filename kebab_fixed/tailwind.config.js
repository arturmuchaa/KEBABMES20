/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        // ── Text hierarchy ──────────────────────────────────
        ink: {
          DEFAULT: '#0f172a',  // slate-900  — primary text
          2:       '#1e293b',  // slate-800  — secondary text
          3:       '#475569',  // slate-500  — muted
          4:       '#94a3b8',  // slate-400  — placeholder
          5:       '#cbd5e1',  // slate-300  — disabled
        },
        // ── Surfaces ────────────────────────────────────────
        surface: {
          DEFAULT: '#ffffff',  // white      — card / panel
          2:       '#f8fafc',  // slate-50   — page bg
          3:       '#f1f5f9',  // slate-100  — table header / subtle bg
          4:       '#e2e8f0',  // slate-200  — border
          5:       '#cbd5e1',  // slate-300  — heavy border
        },
        // ── Brand: blue ─────────────────────────────────────
        brand: {
          DEFAULT: '#2563eb',  // blue-600
          dark:    '#1d4ed8',  // blue-700 hover
          light:   '#eff6ff',  // blue-50  subtle bg
          border:  '#bfdbfe',  // blue-200 border
        },
        // ── Semantic ────────────────────────────────────────
        success: {
          DEFAULT: '#16a34a',  // green-600
          light:   '#f0fdf4',  // green-50
          border:  '#bbf7d0',  // green-200
        },
        warn: {
          DEFAULT: '#d97706',  // amber-600
          light:   '#fffbeb',  // amber-50
          border:  '#fde68a',  // amber-200
        },
        danger: {
          DEFAULT: '#dc2626',  // red-600
          light:   '#fef2f2',  // red-50
          border:  '#fecaca',  // red-200
        },
        // ── Sidebar: clean white + dark active (SS2 style) ──
        sidebar: {
          bg:      '#ffffff',  // white
          border:  '#f1f5f9',  // slate-100 — very subtle
          active:  '#0f172a',  // slate-900 — filled dark active
          text:    '#64748b',  // slate-500
          heading: '#94a3b8',  // slate-400
        },
      },
      boxShadow: {
        card:  '0 1px 3px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04)',
        md:    '0 4px 12px rgba(0,0,0,.08)',
        modal: '0 16px 48px rgba(0,0,0,.14)',
        glow:  '0 0 0 3px rgba(37,99,235,.20)',
      },
      borderRadius: {
        DEFAULT: '6px',
        sm:    '4px',
        md:    '6px',
        lg:    '8px',
        xl:    '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      animation: {
        'fade-in':   'fadeIn .12s ease',
        'slide-up':  'slideUp .15s ease',
        'pulse-dot': 'pulseDot 2s infinite',
        'skeleton':  'skeleton 1.6s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' },   to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.3' } },
        skeleton: { '0%,100%': { opacity: '.5' }, '50%': { opacity: '1' } },
      },
    },
  },
  plugins: [],
}
