import type { Config } from "tailwindcss";

// Tailwind v4 reads its design tokens from the `@theme` block in src/app/globals.css.
// This file only needs to tell Tailwind where to look for class names — keep it thin.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
};

export default config;
