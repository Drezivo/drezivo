// Server-safe theme constants. Kept out of theme.ts because that module is "use client", and a
// server component importing a constant from a client module receives a reference, not the value.

export const THEME_STORAGE_KEY = "drezivo-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> before first paint so a dark-mode visitor never sees a flash of the light theme.
 * Mirrors resolveTheme in theme.ts; it cannot import it because it ships as a string.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("${DARK_QUERY}").matches);document.documentElement.dataset.dashboardTheme=d?"dark":"light";}catch(e){}})();`;
