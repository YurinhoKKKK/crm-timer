import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Paleta da marca Monvatti
        chrysler: "#001AD8",   // Chrysler Blue (azul profundo)
        risd: "#3145FF",        // RISD Blue (azul elétrico — acento principal)
        gunmetal: "#2B333B",    // Gunmetal (escuro de superfície)
        platinum: "#DFDCDB",    // Platinum (cinza claro de fundo)
        // Aliases semânticos usados nos componentes
        brand: { DEFAULT: "#3145FF", deep: "#001AD8", soft: "#E6E9FF" },
        ink: "#2B333B",
        paper: "#F5F5F4",
      },
    },
  },
  plugins: [],
};
export default config;