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
        // Text: light on dark bg
        ink: {
          DEFAULT: '#f8fafc',  // slate-50  — primary text
          2:       '#e2e8f0',  // slate-200 — secondary text
          3:       '#94a3b8',  // slate-400 — muted text
          4:       '#64748b',  // slate-500 — placeholder
          5:       '#475569',  // slate-600 — disabled
        },
        // Surfaces: dark hierarchy
        surface: {
          DEFAULT: '#1e293b',  // slate-800 — card / panel bg
          2:       '#020617',  // slate-950 — page bg
          3:       '#0f172a',  // slate-900 — subtle bg / table header
          4:       '#334155',  // slate-700 — border
          5:       '#475569',  // slate-600 — heavy border / hover
        },
        // Brand: blue-500
        brand: {
          DEFAULT: '#3b82f6',  // blue-500
          dark:    '#2563eb',  // blue-600 hover
          light:   '#172554',  // blue-950 subtle bg
          border:  '#1d4ed8',  // blue-700 border
        },
        success: {
          DEFAULT: '#22c55e',  // green-500
          light:   '#052e16',  // green-950 subtle bg
          border:  '#166534',  // green-800 border
        },
        warn: {
          DEFAULT: '#f59e0b',  // amber-500
          light:   '#1c1400',  // amber-950 subtle bg
          border:  '#78350f',  // amber-800 border
        },
        danger: {
          DEFAULT: '#ef4444',  // red-500
          light:   '#1c0a0a',  // red-950 subtle bg
          border:  '#7f1d1d',  // red-900 border
        },
        // Sidebar: darker than page bg
        sidebar: {
          bg:      '#0f172a',  // slate-900
          border:  '#1e293b',  // slate-800
          active:  '#1e293b',  // slate-800 active state
          text:    '#cbd5e1',  // slate-300
          heading: '#475569',  // slate-600
        },
      },
      boxShadow: {
        card:  '0 1px 3px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.04)',
        md:    '0 4px 16px rgba(0,0,0,.5)',
        modal: '0 20px 60px rgba(0,0,0,.7)',
        glow:  '0 0 0 3px rgba(59,130,246,.25)',
      },
      borderRadius: {
        DEFAULT: '6px',
        sm:  '4px',
        md:  '6px',
        lg:  '8px',
        xl:  '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      animation: {
        'fade-in':   'fadeIn .15s ease',
        'slide-up':  'slideUp .18s ease',
        'pulse-dot': 'pulseDot 2s infinite',
        'skeleton':  'skeleton 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:   { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:  { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.3' } },
        skeleton: { '0%': { opacity: '.5' }, '50%': { opacity: '1' }, '100%': { opacity: '.5' } },
      },
    },
  },
  plugins: [],
}
