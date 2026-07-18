/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['"Fira Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"Fira Code"', '"JetBrains Mono"', 'monospace'],
        serif:   ['"Instrument Serif"', '"Times New Roman"', 'serif'],
        display: ['"Archivo"', '"Fira Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ── Legacy custom tokens (preserved for existing pages) ──
        // Monochrom „tusz na papierze": NEUTRALNE szarości (zero podbarwienia —
        // ani niebieskiego slate, ani ciepłego stone). ink-4 kontrast ≥4.3:1 (AA).
        ink: { DEFAULT:'#171717', 2:'#404040', 3:'#6B6B6B', 4:'#757575', 5:'#B8B8B8' },
        surface: { DEFAULT:'#FFFFFF', 2:'#FAFAFA', 3:'#F5F5F5', 4:'#E5E5E5', 5:'#D4D4D4' },
        // Akcent marki = czerń: interakcje, aktywna nawigacja, paski postępu.
        brand:   { DEFAULT:'#171717', dark:'#000000', light:'#F5F5F5', border:'#D4D4D4' },
        success: { DEFAULT:'#059669', light:'#ECFDF5', border:'#A7F3D0' },
        warn:    { DEFAULT:'#D97706', light:'#FFFBEB', border:'#FDE68A' },
        danger:  { DEFAULT:'#DC2626', light:'#FEF2F2', border:'#FECACA' },
        sidebar: { bg:'#0F172A', border:'#1E293B', active:'#1E293B', text:'#94A3B8', heading:'#475569' },

        // ── shadcn/ui CSS variable tokens ──
        border:     'hsl(var(--border))',
        input:      'hsl(var(--input))',
        ring:       'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      boxShadow: {
        // Płasko, dokumentowo: hairline zamiast „unoszących się" kart.
        // Głębię zostawiamy tylko warstwom naprawdę pływającym (modal, popover).
        card:        '0 1px 2px rgba(0,0,0,.04)',
        'card-hover':'0 2px 8px rgba(0,0,0,.08)',
        md:          '0 2px 8px rgba(0,0,0,.06)',
        modal:       '0 24px 64px rgba(0,0,0,.18)',
        sm:          '0 1px 2px rgba(0,0,0,.05)',
      },
      borderRadius: {
        DEFAULT: '4px', lg:'8px', xl:'10px', '2xl':'12px', '3xl':'16px',
        'shadcn-lg': 'var(--radius)',
        'shadcn-md': 'calc(var(--radius) - 2px)',
        'shadcn-sm': 'calc(var(--radius) - 4px)',
      },
      animation: {
        'fade-in':  'fadeIn .12s ease',
        'slide-up': 'slideUp .15s ease',
        'pulse-dot': 'pulseDot 2s infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
      keyframes: {
        fadeIn:   { from:{ opacity:'0' }, to:{ opacity:'1' } },
        slideUp:  { from:{ opacity:'0', transform:'translateY(6px)' }, to:{ opacity:'1', transform:'translateY(0)' } },
        pulseDot: { '0%,100%':{ opacity:'1' }, '50%':{ opacity:'.3' } },
        'accordion-down': { from:{ height:'0' }, to:{ height:'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from:{ height:'var(--radix-accordion-content-height)' }, to:{ height:'0' } },
      },
    },
  },
  plugins: [],
}
