---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/lib/**"
  - "tests/**"
---

# Frontend

## Design Tokens

Tokens live in `src/app/globals.css` under the Tailwind v4 `@theme` block (`--color-*`,
`--font-*`). Never hardcode a raw hex/px value in a component — add or reuse a token.

## Design Principles

This is the staff-facing application shell and authentication surface: keep it clear, high
contrast, and restrained. Do not introduce glassmorphism, neumorphism, or gradient hero
treatments here — save those for `web`.

## Component Framework

Tailwind CSS v4 for styling. Primitives live in `src/components/ui/` (button, input,
dialog, table, badge, empty-state, skeleton) — extend that set before reaching for a new
UI library. No competing CSS-in-JS or component kit.

Prefer shadcn-compatible primitives in `src/components/ui/` for reusable interaction patterns.
Use Radix primitives for focus management, keyboard behavior, portals, and overlays. Build
custom components only for Drezivo-specific composition or behavior, and do not add a competing
component library.

## Layout

- Use Flexbox and CSS Grid within components. Use `gap`, not margin hacks.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, and `<section>` where they describe the
  page structure.
- Nothing may break below 768px — no fixed-width layouts.

## Accessibility (non-negotiable)

- All interactive elements keyboard-accessible; `Dialog` wraps native `<dialog>` for focus
  trapping and Escape-to-close rather than reimplementing it.
- Every `Input` has an associated `<label>`; every icon-only control has `aria-label`.
- Contrast: 4.5:1 normal text, 3:1 large text — check against the tokens in `globals.css`.
- Visible focus indicators (`:focus-visible` in `globals.css`). Never `outline: none`
  without a replacement.
- Status is never color-only: pair visual state with a text label.

## Performance

- Use a visible loading state rather than a blank screen during an asynchronous operation.
- Do not add a client-side cache for the authentication surface.
- Bundle size: do not import a whole library for one small helper.
