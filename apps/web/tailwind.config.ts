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
        // ADR 0019 — mapeia os tokens CSS de apps/web/src/app/globals.css
        // pras classes utilitárias do Tailwind. Nenhum hex fica cravado
        // aqui: trocar de tema é trocar var(--token), não este arquivo.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        fg: "var(--fg)",
        "fg-soft": "var(--fg-soft)",
        "fg-mute": "var(--fg-mute)",
        primary: "var(--primary)",
        "primary-hover": "var(--primary-hover)",
        "primary-contrast": "var(--primary-contrast)",
        "primary-tint": "var(--primary-tint)",
        success: "var(--success)",
        "success-bg": "var(--success-bg)",
        warning: "var(--warning)",
        "warning-bg": "var(--warning-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
        info: "var(--info)",
        "info-bg": "var(--info-bg)",
        // ADR 0020 — tokens de urgência: pending varia por marca, critical é
        // fixo nas 4 direções (ver globals.css).
        pending: "var(--pending)",
        "pending-bg": "var(--pending-bg)",
        critical: "var(--critical)",
        "critical-bg": "var(--critical-bg)",
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
