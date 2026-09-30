const PESO = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Integer centavos from the API → "₱1,800" or "₱1,800.50". Display only; the server owns the maths. */
export function formatMinor(minor: string): string {
  if (!/^\d+$/.test(minor)) throw new Error(`formatMinor received "${minor}"`);
  const padded = minor.padStart(3, '0');
  const pesos = `${padded.slice(0, -2)}.${padded.slice(-2)}`;
  const value = Number(pesos);
  return value % 1 === 0 ? PESO.format(value) : PESO.format(value).replace(/(\.\d)$/, '$10');
}

/** "3 days", "1 day", or "per day" for a size's pricing. */
export function durationLabel(mode: 'fixed_duration' | 'daily', includedMinutes: number): string {
  if (mode === 'daily') return 'per day';
  const days = Math.max(1, Math.round(includedMinutes / 1440));
  return days === 1 ? '1 day' : `${days} days`;
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateIn(timeZone: string, instant: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** UTC offset of a zone on a date, e.g. "+08:00" (V1 zones have no daylight saving). */
export function offsetOf(timeZone: string, date: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value;
  return name && name !== 'GMT' ? name.replace('GMT', '') : '+00:00';
}

/** Local date + "HH:MM" in the store's zone → ISO instant with offset. */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  return `${date}T${time}:00${offsetOf(timeZone, date)}`;
}

export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-PH', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function formatInstant(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat('en-PH', { ...options, timeZone }).format(new Date(iso));
}

export function formatTime(time: string): string {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2000-01-01T${time}:00Z`));
}
