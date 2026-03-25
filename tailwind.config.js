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
        // High Contrast Grayscale Palette
        dark: {
          'black': '#000000',
          950: '#070707',
          900: '#0d0d0d',
          850: '#141414',
          800: '#1a1a1a',
          700: '#222222',
          600: '#2d2d2d',
          500: '#3a3a3a',
          400: '#555555',
          300: '#888888',
          200: '#bbbbbb',
          100: '#e0e0e0',
          'white': '#ffffff',
        },
        // Accent purely for sliders/highlights
        cyan: {
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        accent: {
          DEFAULT: '#ffffff',
          hover: '#e0e0e0',
          active: '#bbbbbb',
        },
        // Border colors
        border: {
          primary: '#222222',
          secondary: '#2d2d2d',
          light: '#3a3a3a',
        }
      },
      fontFamily: {
        'sans': ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      fontSize: {
        'xxs': ['11px', { lineHeight: '1.4', letterSpacing: '0.5px' }],
        'xs': ['13px', { lineHeight: '1.5', letterSpacing: '0.3px' }],
        'sm': ['14px', { lineHeight: '1.5', letterSpacing: '0.2px' }],
        'base': ['15px', { lineHeight: '1.5' }],
        'lg': ['16px', { lineHeight: '1.6' }],
        'xl': ['18px', { lineHeight: '1.6' }],
      },
      borderRadius: {
        'none': '0',
        'sm': '4px',
        DEFAULT: '6px',
        'md': '8px',
        'lg': '12px',
      },
      boxShadow: {
        'sm': '0 1px 3px rgba(0, 0, 0, 0.8)',
        'md': '0 4px 8px rgba(0, 0, 0, 0.9)',
        'lg': '0 10px 20px rgba(0, 0, 0, 1)',
        'xl': '0 20px 40px rgba(0, 0, 0, 1)',
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