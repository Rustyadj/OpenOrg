import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        avai: {
          bg: '#090A0B',
          surface: '#0D0E10',
          card: '#111214',
          accent: '#1DD68C',
          border: 'rgba(255,255,255,0.065)',
          text: '#F2F3F5',
          muted: '#71767E',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
