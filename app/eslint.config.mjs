import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // parseFloat/parseInt on money strings has bitten this codebase before (see
      // .claude/rules/lessons.md) — ban it repo-wide instead of relying on review.
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message: "Money is a decimal string (TRD §4). Use lib/money.ts, never parseFloat.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", ".claude/**", ".codex/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
