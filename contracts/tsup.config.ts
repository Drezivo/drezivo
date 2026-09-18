import { defineConfig } from 'tsup';

// Dual ESM/CJS build — declarations are emitted by the TypeScript compiler in
// tsconfig.build.json because rollup-plugin-dts is not compatible with the
// TypeScript version used by this workspace.
//
// api,
// app, and web use different module systems and must not each need their
// own bundler workaround to consume this package.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  // zod is a peerDependency (see package.json) — bundling it in would risk
  // a consumer ending up with two zod copies whose branded types don't
  // structurally match.
  external: ['zod'],
});
