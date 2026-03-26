/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Industrial MES dark palette ──
        mes: {
          bg:        '#08090d',      // deepest background
          surface:   '#0f1117',      // card / panel surface
          elevated:  '#161b27',      // elevated elements
          border:    '#1e2535',      // default border
          muted:     '#232b3e',      // muted / disabled
          accent:    '#2563eb',      // primary blue
          'accent-h':'#1d4ed8',      // primary blue hover
          'accent-l':'#3b82f6',      // primary blue light
          success:   '#10b981',
          warning:   '#f59e0b',
          danger:    '#ef4444',
          info:      '#06b6d4',
        },
        sidebar: {
          bg:      '#0b0e18',
          border:  '#1a2035',
          text:    '#8892a4',
          heading: '#4a5568',
          active:  '#151d2e',
        },
        titlebar: {
          bg:      '#06080f',
          border:  '#131929',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        sm:  '4px',
        md:  '6px',
        lg:  '8px',
        xl:  '12px',
        '2xl': '16px',
      },
      boxShadow: {
        'mes-sm':  '0 1px 3px 0 rgba(0,0,0,.4)',
        'mes-md':  '0 4px 12px 0 rgba(0,0,0,.5)',
        'mes-lg':  '0 8px 32px 0 rgba(0,0,0,.6)',
        'mes-glow':'0 0 20px 2px rgba(37,99,235,.25)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '.4' },
        },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.2s ease-out',
        'pulse-dot':'pulse-dot 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
