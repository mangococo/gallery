/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#D4A574',
        secondary: '#8B7355',
        background: '#FAF8F5',
        text: {
          primary: '#2C2C2C',
          secondary: '#666666',
          tertiary: '#999999',
        }
      },
      animation: {
        'sway': 'sway 4s ease-in-out infinite',
      },
      keyframes: {
        sway: {
          '0%, 100%': { transform: 'rotate(0deg) translateY(0)' },
          '25%': { transform: 'rotate(0.5deg) translateY(-2px)' },
          '75%': { transform: 'rotate(-0.5deg) translateY(2px)' },
        }
      }
    },
  },
  plugins: [],
}
