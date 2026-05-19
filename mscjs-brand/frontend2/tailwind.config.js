/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        red: {
          50: "#fef3f3",
          100: "#fde2e2",
          200: "#f9caca",
          300: "#f4a6a6",
          400: "#ee7f7f",
          500: "#e45757",
          600: "#c84646",
          700: "#a33838",
          800: "#7f2c2c",
          900: "#5e1f1f",
        },
      },
    },
  },
  plugins: [],
}
