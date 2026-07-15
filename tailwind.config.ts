import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-ubuntu)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      colors: {
        // Rojo corporativo de Trei (trei.cl), usado en nav, titulos y CTAs.
        trei: {
          DEFAULT: "#E12844",
          dark: "#C11F38",
          light: "#FBE9EC",
        },
      },
    },
  },
  plugins: [],
};

export default config;
