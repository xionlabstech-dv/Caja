import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Sistema de diseño (Brief 01) — mapea las variables de globals.css.
        // No se usan todavía en pantallas existentes.
        marca: {
          DEFAULT: "var(--marca)",
          presion: "var(--marca-presion)",
          suave: "var(--marca-suave)",
          "suave-texto": "var(--marca-suave-texto)",
        },
        foco: "var(--foco)",
        tinta: {
          DEFAULT: "var(--tinta)",
          texto: "var(--tinta-texto)",
          etiqueta: "var(--tinta-etiqueta)",
        },
        superficie: {
          DEFAULT: "var(--superficie)",
          barra: "var(--superficie-barra)",
        },
        tarjeta: {
          DEFAULT: "var(--tarjeta)",
          hundida: "var(--tarjeta-hundida)",
        },
        borde: {
          tarjeta: "var(--borde-tarjeta)",
          campo: "var(--borde-campo)",
          divisor: "var(--borde-divisor)",
        },
        texto: {
          DEFAULT: "var(--texto)",
          2: "var(--texto-2)",
          3: "var(--texto-3)",
          4: "var(--texto-4)",
          invertido: "var(--texto-invertido)",
        },
        negativo: {
          DEFAULT: "var(--negativo)",
          fondo: "var(--negativo-fondo)",
          borde: "var(--negativo-borde)",
        },
        deuda: {
          DEFAULT: "var(--deuda)",
          fondo: "var(--deuda-fondo)",
        },
        aviso: {
          DEFAULT: "var(--aviso)",
          fondo: "var(--aviso-fondo)",
          borde: "var(--aviso-borde)",
        },
        informativo: {
          DEFAULT: "var(--informativo)",
          fondo: "var(--informativo-fondo)",
        },
        overlay: "var(--overlay)",
        toast: {
          fondo: "var(--toast-fondo)",
          texto: "var(--toast-texto)",
        },
      },
      fontFamily: {
        caja: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
