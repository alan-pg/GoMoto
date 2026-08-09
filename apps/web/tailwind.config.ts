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
        divider: "var(--divider)",
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
        // "border" (3:1 contra surface) é limite de componente de verdade —
        // input, card, contorno de botão. "divider" (~1,4:1) é separador
        // decorativo de linha de tabela/lista/cabeçalho sticky — visível,
        // mas mais discreto, não deve reaproveitar "border" nem "surface-2"
        // (fundo, não borda). Ver ADR 0019 §7.
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
      // Card/modal de extração por IA (Spec 0012) — "respiração" do ícone
      // Sparkles e sweep indeterminado da barra de progresso.
      keyframes: {
        "ai-pulse": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.08)", opacity: ".85" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(350%)" },
        },
      },
      animation: {
        "ai-pulse": "ai-pulse 1.8s ease-in-out infinite",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
