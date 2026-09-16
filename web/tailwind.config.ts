import type { Config } from 'tailwindcss';

// Tailwind v4 configures its theme primarily via the `@theme` block in
// src/app/globals.css. This file only needs to exist to pin `content`
// scanning to real source directories so the scaffold's intent is explicit —
// it is not where color/spacing tokens live.
const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
};

export default config;
