import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1a1a17",
        paper: "#faf9f5",
        brand: { DEFAULT: "#0f6e56", soft: "#e1f5ee" },
      },
    },
  },
  plugins: [],
};
export default config;
