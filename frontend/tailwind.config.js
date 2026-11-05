/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#e5484d', dark: '#c93a40', soft: '#e5484d1a' },
        surface: { DEFAULT: '#ffffff', dark: '#1c1c1f' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        pop: { from: { opacity: 0, transform: 'scale(.97) translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        slide: { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
      },
      animation: { pop: 'pop .14s ease-out', fade: 'fade .14s ease-out', slide: 'slide .18s ease-out' },
    },
  },
  plugins: [],
};
