import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Maxfem oficial
        maxfem: {
          pink: '#E94C7B',
          'pink-hover': '#D63F6E',
          ink: '#1A1A1A',
          cream: '#FAF6F1',
        },
        success: '#15803D',
        warning: '#B45309',
        error: '#B91C1C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
