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
        ink: { DEFAULT:'#111827', 2:'#374151', 3:'#6B7280', 4:'#9CA3AF', 5:'#D1D5DB' },
        surface: { DEFAULT:'#FFFFFF', 2:'#F9FAFB', 3:'#F3F4F6', 4:'#E5E7EB', 5:'#D1D5DB' },
        brand:   { DEFAULT:'#1D4ED8', dark:'#1E40AF', light:'#EFF6FF', border:'#BFDBFE' },
        success: { DEFAULT:'#059669', light:'#ECFDF5', border:'#A7F3D0' },
        warn:    { DEFAULT:'#D97706', light:'#FFFBEB', border:'#FDE68A' },
        danger:  { DEFAULT:'#DC2626', light:'#FEF2F2', border:'#FECACA' },
        // Sidebar jasny (nowy ERP look)
        sidebar: { bg:'#1E293B', border:'#334155', active:'#2D3F55', text:'#CBD5E1', heading:'#64748B' },
      },
      boxShadow: {
        card:  '0 1px 2px rgba(0,0,0,.05), 0 0 0 1px rgba(0,0,0,.06)',
        md:    '0 4px 12px rgba(0,0,0,.08)',
        modal: '0 16px 48px rgba(0,0,0,.16)',
      },
      borderRadius: { DEFAULT:'4px', lg:'6px', xl:'8px', '2xl':'12px', '3xl':'16px' },
      animation: {
        'fade-in': 'fadeIn .12s ease',
        'slide-up': 'slideUp .15s ease',
        'pulse-dot': 'pulseDot 2s infinite',
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
