import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Paleta da marca Monvatti (valores fixos)
        chrysler: "#001AD8", // Chrysler Blue (azul profundo)
        risd: "#3145FF", // RISD Blue (azul elétrico — acento principal)
        gunmetal: "#2B333B", // Gunmetal (escuro de superfície)
        platinum: "#DFDCDB", // Platinum (cinza claro de fundo)
        brand: { DEFAULT: "#3145FF", deep: "#001AD8", soft: "#E6E9FF" },
        ink: "#2B333B",
        paper: "#F5F5F4",

        // Tokens semânticos (trocam entre claro/escuro via CSS vars)
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        "fg-subtle": "var(--fg-subtle)",
        "brand-tint": "var(--brand-tint)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        pop: "var(--shadow-pop)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
