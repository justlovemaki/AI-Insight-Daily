/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#0cafcf",
        "background-light": "#f5f8f8",
        "background-dark": "#101f22",
        "surface-dark": "#182f34",
        "surface-dark-lighter": "#224249",
        "surface-darker": "#142529",
        "border-dark": "#2a4045",
        "text-secondary": "#90c1cb",
        "accent-success": "#0bda54",
        "accent-warning": "#fbbf24",
        "accent-error": "#ef4444",
      },
      fontFamily: {
        "display": ["Inter", "Noto Sans SC", "sans-serif"],
        "body": ["Inter", "Noto Sans SC", "sans-serif"],
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "2xl": "1rem",
        "full": "9999px"
      },
      animation: {
        'ping-slow': 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite',
      }
    },
  },
  plugins: [],
}
