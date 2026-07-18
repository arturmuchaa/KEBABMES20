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
        // Ciepłe neutrale (stone) — zdejmują „niebieskawy szablon" Tailwinda.
        // ink-4 trzyma kontrast ≥4.3:1 na bieli (WCAG AA) jak poprzednik #6F7787.
        ink: { DEFAULT:'#1C1917', 2:'#44403C', 3:'#78716C', 4:'#736D66', 5:'#BDB7AF' },
        surface: { DEFAULT:'#FFFFFF', 2:'#FAFAF9', 3:'#F5F5F4', 4:'#E7E5E4', 5:'#D6D3D1' },
        // Jeden akcent marki: papryka — interakcje, aktywna nawigacja, logo.
        brand:   { DEFAULT:'#B4380D', dark:'#8A2B0A', light:'#FAEEE8', border:'#EFCDBB' },
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
        card:        '0 1px 2px rgba(28,25,23,.04)',
        'card-hover':'0 2px 8px rgba(28,25,23,.08)',
        md:          '0 2px 8px rgba(28,25,23,.06)',
        modal:       '0 24px 64px rgba(28,25,23,.18)',
        sm:          '0 1px 2px rgba(28,25,23,.05)',
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
