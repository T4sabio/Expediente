/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#12312E',
        canvas: '#F5F7F7',
        accent: '#1F7A6C',
        'accent-soft': '#E4F1EE',
        critical: '#B3402F',
        'critical-soft': '#F6E4E1',
        warn: '#B8863A',
        'warn-soft': '#F6EEDD',
        ok: '#2E7D5B',
        'ok-soft': '#E4F1E9',
        hairline: '#DDE5E3'
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace']
      }
    }
  }
};
