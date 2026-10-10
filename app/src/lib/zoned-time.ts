/**
 * Branch-time conversions for forms that take a date and a time in the branch's time zone and send
 * instants to the API.
 */

/** The wall-clock date (YYYY-MM-DD) and time (HH:mm) of an instant in a time zone. */
export function localDateTimeParts(
  instant: Date,
  timeZone: string
): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    time: `${parts["hour"]}:${parts["minute"]}`,
  };
}

/** A wall-clock "YYYY-MM-DDTHH:mm" in a time zone as an instant, or null when it is not a valid value. */
export function zonedLocalDateTimeToInstant(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const wallTime = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0
  );
  let instant = new Date(wallTime);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = new Date(wallTime - timeZoneOffsetMs(instant, timeZone));
  }
  return Number.isFinite(instant.getTime()) ? instant : null;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  return (
    Date.UTC(
      Number(values["year"]),
      Number(values["month"]) - 1,
      Number(values["day"]),
      Number(values["hour"]),
      Number(values["minute"]),
      Number(values["second"])
    ) - instant.getTime()
  );
}
