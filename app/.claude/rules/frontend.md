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

This is an operations dashboard, not a marketing site: flat design, data-dense tables, high
contrast, minimal decoration. Do not introduce glassmorphism, neumorphism, or gradient
hero treatments here — save those for `web`.

## Component Framework

Tailwind CSS v4 for styling. Primitives live in `src/components/ui/` (button, input,
dialog, table, badge, empty-state, skeleton) — extend that set before reaching for a new
UI library. No competing CSS-in-JS or component kit.

## Layout

- CSS Grid for the dashboard shell (`src/app/(dashboard)/layout.tsx`), Flexbox within
  components. Use `gap`, not margin hacks.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<table>` with `<caption>`.
- Mobile-first is not the priority for this repo (staff use desktop/tablet at the counter),
  but nothing may break below 768px — no fixed-width layouts.

## Accessibility (non-negotiable)

- All interactive elements keyboard-accessible; `Dialog` wraps native `<dialog>` for focus
  trapping and Escape-to-close rather than reimplementing it.
- Every `Input` has an associated `<label>`; every icon-only control has `aria-label`.
- Contrast: 4.5:1 normal text, 3:1 large text — check against the tokens in `globals.css`.
- Visible focus indicators (`:focus-visible` in `globals.css`). Never `outline: none`
  without a replacement.
- Status is never color-only: pair every `Badge` with a text label (see
  `reservation-status-badge.tsx`).

## Performance

- `TableSkeleton` / `Skeleton` for loading states — never a blank screen during a fetch.
- TanStack Query owns caching (`staleTime`, `retry`) — don't hand-roll a second cache.
- Virtualize any list expected to exceed ~200 rows before it ships; none does yet.
- Bundle size: don't import a whole library for one formatter — see `lib/money.ts`, which
  uses `Intl.NumberFormat` instead of a currency-formatting dependency.
