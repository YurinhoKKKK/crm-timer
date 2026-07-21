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
        // fill "backwards" (não "both"/"forwards"): depois que a animação
        // termina, o transform volta a NONE. Com "both", o translateY(0)
        // ficava aplicado para sempre e o elemento animado virava stacking
        // context + containing block permanente — era por isso que o <main>
        // prendia position:fixed e todo painel precisava de portal no body.
        "fade-in": "fade-in 0.25s ease-out backwards",
      },
      // ESCALA DE CAMADAS do sistema (z-index). Use SEMPRE estes tokens em
      // vez de números soltos, para não virar guerra de z-index:
      //   header (20) < backdrop da sidebar (30) < sidebar (40)
      //   < z-pill (45, indicador de timer — ABAIXO de qualquer overlay)
      //   < z-overlay (50, modais/painéis: Modal, BreakdownPanel, ConfirmDialog)
      //   < z-sheet (60, detalhe da tarefa — abre por cima de outros painéis)
      //   < z-lightbox (100, imagem ampliada)
      //   < z-toast (110, reservado para avisos futuros)
      zIndex: {
        pill: "45",
        overlay: "50",
        sheet: "60",
        lightbox: "100",
        toast: "110",
      },
    },
  },
  plugins: [],
};
export default config;
