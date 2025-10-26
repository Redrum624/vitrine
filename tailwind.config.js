/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      spacing: {
        '70': '280px',  // Tools panel width
        '90': '360px',  // Adjustments panel width
      },
      colors: {
        // Prestigious Studio Color Palette (Pure Grayscale)
        dark: {
          'black': '#000000',
          950: '#0a0a0a',
          900: '#121212',
          850: '#1a1a1a',
          800: '#1e1e1e',
          700: '#2a2a2a',
          600: '#3a3a3a',
          500: '#4a4a4a',
          400: '#6a6a6a',
          300: '#8a8a8a',
          200: '#aaaaaa',
          100: '#cccccc',
          'white': '#ffffff',
        },
        // Border colors
        border: {
          primary: '#2a2a2a',
          secondary: '#333333',
          light: '#3a3a3a',
        },
        // Accent (grayscale only)
        accent: {
          DEFAULT: '#3a3a3a',
          hover: '#4a4a4a',
          active: '#555555',
        }
      },
      fontFamily: {
        'sans': ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      fontSize: {
        'xxs': ['10px', { lineHeight: '1.4', letterSpacing: '0.5px' }],
        'xs': ['11px', { lineHeight: '1.5', letterSpacing: '0.5px' }],
        'sm': ['12px', { lineHeight: '1.5', letterSpacing: '0.3px' }],
        'base': ['13px', { lineHeight: '1.5' }],
        'lg': ['14px', { lineHeight: '1.6' }],
      },
      borderRadius: {
        'none': '0',
        'sm': '3px',
        DEFAULT: '4px',
        'md': '6px',
        'lg': '8px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.5)',
        'md': '0 4px 8px rgba(0, 0, 0, 0.6)',
        'lg': '0 8px 16px rgba(0, 0, 0, 0.7)',
        'xl': '0 12px 24px rgba(0, 0, 0, 0.8)',
      },
      transitionTimingFunction: {
        'professional': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      letterSpacing: {
        'tighter': '-0.5px',
        'tight': '-0.3px',
        'normal': '0',
        'wide': '0.3px',
        'wider': '0.5px',
        'widest': '1px',
        'ultra': '1.5px',
      }
    },
  },
  plugins: [],
}