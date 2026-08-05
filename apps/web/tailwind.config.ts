import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: "#BAFF1A",
        "brand-hover": "#a8e617",
        "bg-primary": "#121212",
        "bg-card": "#202020",
        "bg-elevated": "#323232",
        "bg-input": "#2a2a2a",
        "text-primary": "#FFFFFF",
        "text-secondary": "#A0A0A0",
        "text-muted": "#666666",
        border: "#333333",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "8px",
        lg: "12px",
        xl: "16px",
      },
      width: {
        sidebar: "240px",
      },
    },
  },
  plugins: [],
};

export default config;
