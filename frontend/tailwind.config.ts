import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        brand: "#22c55e",
        brandDim: "#16a34a",
        surface: "#0a0f0d",
        surfaceAlt: "#111a15",
        surfaceCard: "#162013",
        border: "#1e2e1a",
        borderBright: "#2e4328",
        muted: "#6b8f6b",
        mutedLight: "#a2c398",
        input: "#1a2618",
        inputHover: "#243320",
        danger: "#ef4444",
        dangerDim: "#991b1b",
        warning: "#f59e0b",
        warningDim: "#92400e",
        info: "#3b82f6",
        infoDim: "#1e3a5f",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
