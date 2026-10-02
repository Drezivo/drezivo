"use client";

import { useSyncExternalStore } from "react";

import { DARK_QUERY, THEME_STORAGE_KEY } from "@/lib/theme-boot";

/**
 * Light/dark theme for the workspace. The preference lives in this browser only (localStorage);
 * "system" follows the operating system. The resolved theme is written to
 * <html data-dashboard-theme>, which is what globals.css keys the dark tokens on.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_CHANGE_EVENT = "drezivo:theme-change";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    // Storage blocked (private mode, site data off): fall back to the OS setting.
    return "system";
  }
}

// matchMedia is missing in some non-browser environments (jsdom); treat that as a light OS.
function darkMedia(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
}

function systemTheme(): ResolvedTheme {
  return darkMedia()?.matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset["dashboardTheme"] = resolveTheme(preference);
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not persisted, but still applied for this page view.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const media = darkMedia();
  const sync = () => {
    applyTheme(readPreference());
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  // Another tab changed the preference, or the OS switched while following "system".
  window.addEventListener("storage", sync);
  media?.addEventListener("change", sync);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", sync);
    media?.removeEventListener("change", sync);
  };
}

function snapshot(): string {
  const preference = readPreference();
  return `${preference}:${resolveTheme(preference)}`;
}

export function useTheme(): { preference: ThemePreference; resolved: ResolvedTheme } {
  // The server cannot know the visitor's theme; it renders the light default and the client corrects it.
  const value = useSyncExternalStore(subscribe, snapshot, () => "system:light");
  const [preference, resolved] = value.split(":") as [ThemePreference, ResolvedTheme];
  return { preference, resolved };
}
