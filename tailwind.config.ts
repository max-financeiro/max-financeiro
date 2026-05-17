import type { Config } from 'tailwindcss';

/**
 * Design system — Financeiro Maxfem
 *
 * Princípios:
 *  - Tipografia: Geist Sans (UI) + Geist Mono (números/códigos)
 *  - Cor dominante: rosa Maxfem refinado, escala completa 50-900
 *  - Neutros: warm grays ("ink"), não cold blue-grays
 *  - Surface: cream off-white, nunca branco puro
 *  - Radii: escala compacta (lg=10, xl=14, 2xl=20) — sem cantos crus
 *  - Sombras: transparências curtas, nunca pretas duras
 *
 * Anti-AI: sem Inter/Roboto, sem gradient roxo, sem layout cookie-cutter.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ============================================================
        // Pink Maxfem — dominante de marca, escala completa
        // ============================================================
        pink: {
          50: '#FEF2F6',
          100: '#FDE3EC',
          200: '#FBC8D9',
          300: '#F89DB8',
          400: '#F26B92',
          500: '#E94C7B',
          600: '#D63F6E',
          700: '#B22F58',
          800: '#8F2748',
          900: '#6F1F39',
        },

        // ============================================================
        // Ink — warm gray neutrals (warm, não cold blue-gray)
        // ============================================================
        ink: {
          50: '#FAFAF9',
          100: '#F4F3F1',
          200: '#E6E4E0',
          300: '#CDCAC4',
          400: '#9C9890',
          500: '#6F6B62',
          600: '#4D4A43',
          700: '#36332E',
          800: '#22201C',
          900: '#0F0E0C',
        },

        // ============================================================
        // Surface — fundos
        // ============================================================
        surface: {
          DEFAULT: '#FAF6F1',
          raised: '#FFFFFF',
          sunken: '#F4F0EA',
        },

        // ============================================================
        // Semânticas
        // ============================================================
        success: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          900: '#14532D',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          900: '#78350F',
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          900: '#7F1D1D',
        },
        info: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          900: '#1E3A8A',
        },

        // ============================================================
        // Compat com nomes antigos
        // ============================================================
        maxfem: {
          pink: '#E94C7B',
          'pink-hover': '#D63F6E',
          ink: '#0F0E0C',
          cream: '#FAF6F1',
        },
      },

      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        display: ['var(--font-geist-sans)', 'ui-sans-serif', 'sans-serif'],
      },

      fontSize: {
        'micro': ['11px', { lineHeight: '14px', letterSpacing: '0.02em' }],
        'caption': ['12px', { lineHeight: '16px', letterSpacing: '0.01em' }],
        'body-sm': ['13px', { lineHeight: '20px' }],
        'body': ['14px', { lineHeight: '22px' }],
        'body-lg': ['15px', { lineHeight: '24px' }],
        'heading-sm': ['17px', { lineHeight: '24px', letterSpacing: '-0.005em' }],
        'heading': ['20px', { lineHeight: '28px', letterSpacing: '-0.01em' }],
        'heading-lg': ['24px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
        'display-sm': ['30px', { lineHeight: '36px', letterSpacing: '-0.02em' }],
        'display': ['38px', { lineHeight: '44px', letterSpacing: '-0.025em' }],
        'display-lg': ['48px', { lineHeight: '52px', letterSpacing: '-0.03em' }],
      },

      borderRadius: {
        'xs': '4px',
        'sm': '6px',
        DEFAULT: '8px',
        'md': '8px',
        'lg': '10px',
        'xl': '14px',
        '2xl': '20px',
        '3xl': '28px',
      },

      boxShadow: {
        'xs': '0 1px 2px 0 rgb(34 32 28 / 0.04)',
        'sm': '0 1px 3px 0 rgb(34 32 28 / 0.06), 0 1px 2px -1px rgb(34 32 28 / 0.04)',
        DEFAULT: '0 4px 8px -2px rgb(34 32 28 / 0.06), 0 2px 4px -2px rgb(34 32 28 / 0.04)',
        'md': '0 8px 16px -4px rgb(34 32 28 / 0.08), 0 4px 8px -2px rgb(34 32 28 / 0.04)',
        'lg': '0 16px 32px -8px rgb(34 32 28 / 0.10), 0 8px 16px -4px rgb(34 32 28 / 0.04)',
        'glow-pink': '0 0 0 4px rgb(233 76 123 / 0.12)',
      },

      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      animation: {
        'fade-in': 'fadeIn 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slideUp 280ms cubic-bezier(0.16, 1, 0.3, 1)',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
