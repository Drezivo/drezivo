// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.cjs', '*.config.js', '*.config.ts', 'scripts/**', '.claude/**', '.codex/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // AGENTS.md: no `any`, no silent-suppression escapes, no null-as-error-sentinel.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['**/__tests__/**/*.ts', 'tests/**/*.ts', '*.config.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Test/config/script files live outside the build tsconfig's `src` rootDir; they get
        // their own project (tsconfig.test.json) so typed linting still applies to them.
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // CLI scripts print progress/errors to stdout/stderr by design; that is not the
    // production request-serving path AGENTS.md's "no console.log" rule targets.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
