/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f9f9f9',
          100: '#f0f0f0',
          200: '#e8e8e8',
          300: '#d8d8d8',
          400: '#b8b8b8',
          500: '#888888',
          600: '#606060',
          700: '#484848',
          800: '#383838',
          850: '#303030',
          900: '#282828',
          950: '#1c1c1c',
        }
      },
      fontFamily: {
        'sans': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif']
      },
      borderRadius: {
        'professional': '6px',
        'soft': '8px',
        DEFAULT: '6px'
      }
    },
  },
  plugins: [],
}