import { FlatCompat } from '@eslint/eslintrc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', '.claude/**', '.codex/**', 'playwright-report/**', 'test-results/**', 'coverage/**'],
  },
  {
    rules: {
      // A capability token or idempotency key logged anywhere is a leak,
      // not a debugging convenience (Drezivo-TRD.md §3 "Guest access").
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];

export default eslintConfig;
