import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        avai: {
          bg: '#0B0F14',
          surface: '#0F1419',
          card: '#141920',
          accent: '#1DD68C',
          border: 'rgba(255,255,255,0.07)',
          text: '#E8EDF2',
          muted: '#6B7785',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
