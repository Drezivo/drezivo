const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_DAYS = 3;

const baseManilaDateMs = (() => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value);

  return Date.UTC(part('year'), part('month') - 1, part('day') + FUTURE_DAYS);
})();

/** Stable Manila-local test dates anchored three days ahead of the current date. */
export function reservationTestDate(dayOffset = 0): string {
  return new Date(baseManilaDateMs + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** UTC timestamps for a reservation's Manila-local calendar date. */
export function reservationTestInstant(
  dayOffset: number,
  time = '02:00:00.000Z',
): string {
  return `${reservationTestDate(dayOffset)}T${time}`;
}

export function nextUsSpringForwardDate(): string {
  const today = new Date();
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(todayParts.find((part) => part.type === type)?.value);
  const todayUtc = Date.UTC(value('year'), value('month') - 1, value('day'));

  for (let year = value('year'); ; year += 1) {
    const firstMarchWeekday = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const firstSunday = 1 + ((7 - firstMarchWeekday) % 7);
    const secondSunday = firstSunday + 7;
    const candidate = Date.UTC(year, 2, secondSunday);

    if (candidate > todayUtc) {
      return new Date(candidate).toISOString().slice(0, 10);
    }
  }
}
