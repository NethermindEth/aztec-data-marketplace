/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#c8f313",
        "on-primary": "#0e0e34",
        background: "#09082f",
        surface: "#0e0e34",
        "surface-container": "#1a1a4d",
        "on-surface": "#f8f8ff",
        "on-surface-variant": "#a0a0c0",
        outline: "#404080",
        "outline-variant": "#313158",
        secondary: "#a0a0c0",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
      },
      fontFamily: {
        headline: ["Noto Serif", "serif"],
        body: ["Noto Serif", "serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};