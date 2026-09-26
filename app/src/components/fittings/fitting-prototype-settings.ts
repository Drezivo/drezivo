export const FITTING_DURATION_OPTIONS = [30, 45, 60, 90] as const;

export type FittingPrototypeDuration = (typeof FITTING_DURATION_OPTIONS)[number];

export const DEFAULT_FITTING_DURATION: FittingPrototypeDuration = 60;

const DURATION_STORAGE_KEY = "drezivo:fittings:prototype-default-duration";

export function readFittingPrototypeDefaultDuration(): FittingPrototypeDuration {
  if (typeof window === "undefined") return DEFAULT_FITTING_DURATION;

  const stored = Number(window.sessionStorage.getItem(DURATION_STORAGE_KEY));
  return isFittingPrototypeDuration(stored) ? stored : DEFAULT_FITTING_DURATION;
}

export function writeFittingPrototypeDefaultDuration(value: FittingPrototypeDuration): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DURATION_STORAGE_KEY, String(value));
}

export function clearFittingPrototypeDefaultDuration(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DURATION_STORAGE_KEY);
}

function isFittingPrototypeDuration(value: number): value is FittingPrototypeDuration {
  return FITTING_DURATION_OPTIONS.includes(value as FittingPrototypeDuration);
}
