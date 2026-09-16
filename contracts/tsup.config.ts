import { defineConfig } from 'tsup';

// Dual ESM/CJS build with declarations, per README "how to install" — api,
// app, and web use different module systems and must not each need their
// own bundler workaround to consume this package.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // zod is a peerDependency (see package.json) — bundling it in would risk
  // a consumer ending up with two zod copies whose branded types don't
  // structurally match.
  external: ['zod'],
});
