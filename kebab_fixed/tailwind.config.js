/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        ink: { DEFAULT:'#0F1C2E', 2:'#2E4057', 3:'#5A7089', 4:'#8FA7BE', 5:'#C3D3E0' },
        surface: { DEFAULT:'#FFFFFF', 2:'#F7F9FC', 3:'#EEF3F8', 4:'#DDE6EF', 5:'#C8D5E3' },
        brand:   { DEFAULT:'#1D4ED8', dark:'#1E40AF', light:'#EFF6FF', border:'#BFDBFE' },
        success: { DEFAULT:'#059669', light:'#ECFDF5', border:'#A7F3D0' },
        warn:    { DEFAULT:'#D97706', light:'#FFFBEB', border:'#FDE68A' },
        danger:  { DEFAULT:'#DC2626', light:'#FEF2F2', border:'#FECACA' },
        // Sidebar — jasny lodowy błękit (Ice Steel Blue)
        sidebar: {
          bg:      '#EEF3FA',   // lodowy błękit-szary, wyraźnie inny od białego
          border:  '#D2DFF0',   // delikatna granatowo-niebieska ramka
          active:  '#DDE8F7',   // aktywna pozycja — jasno-niebieski wash
          text:    '#1E3557',   // głęboka granatowa czytelna czerń
          heading: '#7A9BBB',   // matowy steel blue dla nagłówków sekcji
        },
      },
      boxShadow: {
        card:  '0 1px 3px rgba(15,28,46,.06), 0 0 0 1px rgba(15,28,46,.07)',
        md:    '0 4px 16px rgba(15,28,46,.10)',
        modal: '0 20px 60px rgba(15,28,46,.18)',
        header:'0 1px 0 rgba(15,28,46,.06)',
      },
      borderRadius: { DEFAULT:'4px', lg:'6px', xl:'8px', '2xl':'12px', '3xl':'16px' },
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
