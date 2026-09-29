import type { CSSProperties } from 'react';

import { STOREFRONT_THEMES, type StorefrontTheme } from '@drezivo/contracts';

/** The owner's chosen palette as the CSS variables the storefront styles read. */
export function themeStyle(theme: StorefrontTheme): CSSProperties {
  const palette = STOREFRONT_THEMES[theme];
  return {
    '--sf-bg': palette.background,
    '--sf-surface': palette.surface,
    '--sf-ink': palette.ink,
    '--sf-muted': palette.muted,
    '--sf-line': palette.line,
    '--sf-accent': palette.accent,
    '--sf-accent-ink': palette.accentInk,
    colorScheme: theme === 'noir' ? 'dark' : 'light',
  } as CSSProperties;
}
