/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        // Większa skala — czytelna na dużych ekranach
        xs:   ['12px', { lineHeight: '18px', letterSpacing: '0.01em' }],
        sm:   ['13px', { lineHeight: '20px', letterSpacing: '0em'    }],
        base: ['14px', { lineHeight: '22px', letterSpacing: '0em'    }],
        md:   ['15px', { lineHeight: '24px', letterSpacing: '-0.01em'}],
        lg:   ['16px', { lineHeight: '26px', letterSpacing: '-0.01em'}],
        xl:   ['18px', { lineHeight: '28px', letterSpacing: '-0.02em'}],
        '2xl':['22px', { lineHeight: '32px', letterSpacing: '-0.02em'}],
      },
      colors: {
        ink: { DEFAULT:'#0F1C2E', 2:'#2E4057', 3:'#5A7089', 4:'#8FA7BE', 5:'#C3D3E0' },
        surface: { DEFAULT:'#FFFFFF', 2:'#F7F9FC', 3:'#EEF3F8', 4:'#DDE6EF', 5:'#C8D5E3' },
        brand:   { DEFAULT:'#1D4ED8', dark:'#1E40AF', light:'#EFF6FF', border:'#BFDBFE' },
        success: { DEFAULT:'#059669', light:'#ECFDF5', border:'#A7F3D0' },
        warn:    { DEFAULT:'#D97706', light:'#FFFBEB', border:'#FDE68A' },
        danger:  { DEFAULT:'#DC2626', light:'#FEF2F2', border:'#FECACA' },
        sidebar: {
          bg:      '#EEF3FA',
          border:  '#D2DFF0',
          active:  '#DDE8F7',
          text:    '#1E3557',
          heading: '#7A9BBB',
        },
      },
      borderRadius: {
        DEFAULT: '6px',
        sm:      '4px',
        md:      '8px',
        lg:      '10px',
        xl:      '12px',
        '2xl':   '16px',
        '3xl':   '20px',
        full:    '9999px',
      },
      boxShadow: {
        card:   '0 1px 4px rgba(15,28,46,.07), 0 0 0 1px rgba(15,28,46,.06)',
        md:     '0 4px 16px rgba(15,28,46,.10)',
        modal:  '0 20px 60px rgba(15,28,46,.18)',
        header: '0 1px 0 rgba(15,28,46,.06)',
        btn:    '0 1px 2px rgba(15,28,46,.08)',
      },
      animation: {
        'fade-in':  'fadeIn .12s ease',
        'slide-up': 'slideUp .15s ease',
        'pulse-dot':'pulseDot 2s infinite',
      },
      keyframes: {
        fadeIn:   { from:{ opacity:'0' }, to:{ opacity:'1' } },
        slideUp:  { from:{ opacity:'0', transform:'translateY(6px)' }, to:{ opacity:'1', transform:'translateY(0)' } },
        pulseDot: { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'.3' } },
      },
    },
  },
  plugins: [],
}
