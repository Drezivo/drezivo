export type CalendarActivityType = "Pickup" | "Return" | "Fitting";

export type CalendarDay = {
  key: string;
  label: string;
  date: string;
  dateKey: string;
  activityCount: number;
};

export type CalendarActivity = {
  id: string;
  day: string;
  dateKey: string;
  type: CalendarActivityType;
  customer: string;
  clothing: string;
  startTime: string;
  durationMinutes: 30 | 60;
};

export const CALENDAR_START_HOUR = 7;
export const CALENDAR_END_HOUR = 21;
export const CALENDAR_HOUR_HEIGHT = 120;
export const CALENDAR_MINUTE_HEIGHT = CALENDAR_HOUR_HEIGHT / 60;
export const CALENDAR_TOTAL_HEIGHT =
  (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * CALENDAR_HOUR_HEIGHT;

export const CALENDAR_MOCK_YEAR = 2026;
export const CALENDAR_MOCK_MONTH = 8;
export const CALENDAR_MOCK_TODAY = "2026-09-26";
export const CALENDAR_WEEK_START = "2026-09-14";
export const CALENDAR_WEEK_END = "2026-09-20";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type DayKey = (typeof DAY_KEYS)[number];

function dayKeyFor(dateKey: string): DayKey {
  return DAY_KEYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()]!;
}

function activity(
  id: string,
  dateKey: string,
  type: CalendarActivityType,
  customer: string,
  clothing: string,
  startTime: string,
  durationMinutes: 30 | 60,
): CalendarActivity {
  return {
    id,
    day: dayKeyFor(dateKey),
    dateKey,
    type,
    customer,
    clothing,
    startTime,
    durationMinutes,
  };
}

export const CALENDAR_ACTIVITIES: readonly CalendarActivity[] = [
  activity("sep01-pickup", "2026-09-01", "Pickup", "Alyssa Tan", "Champagne Gown", "09:00", 60),
  activity("sep01-fitting", "2026-09-01", "Fitting", "Joyce Lim", "Emerald Gown", "13:30", 30),
  activity("sep02-return", "2026-09-02", "Return", "Marco Reyes", "Barong Tagalog", "10:30", 30),
  activity("sep03-fitting", "2026-09-03", "Fitting", "Nica Cruz", "Wedding Gown", "15:00", 60),
  activity("sep04-pickup", "2026-09-04", "Pickup", "Rafael Tan", "Black Suit", "11:00", 60),
  activity("sep05-return", "2026-09-05", "Return", "Bea Santos", "Blue Dress", "16:00", 60),
  activity("sep06-fitting", "2026-09-06", "Fitting", "Anne Dizon", "Filipiniana Dress", "14:00", 60),

  activity("sep07-pickup", "2026-09-07", "Pickup", "Mika Reyes", "Red Gown", "08:30", 30),
  activity("sep07-return", "2026-09-07", "Return", "Carlo Lim", "Barong Tagalog", "14:30", 30),
  activity("sep08-fitting", "2026-09-08", "Fitting", "Ella Santos", "Wedding Gown", "10:00", 60),
  activity("sep08-pickup", "2026-09-08", "Pickup", "Noel Cruz", "Black Gown", "17:00", 60),
  activity("sep09-return", "2026-09-09", "Return", "Karen Reyes", "Emerald Dress", "09:30", 60),
  activity("sep10-fitting", "2026-09-10", "Fitting", "Mia Lopez", "Ivory Gown", "11:30", 30),
  activity("sep10-pickup", "2026-09-10", "Pickup", "Paolo Tan", "Suit", "18:00", 60),
  activity("sep11-return", "2026-09-11", "Return", "Lara Cruz", "Filipiniana Dress", "13:00", 60),
  activity("sep12-fitting", "2026-09-12", "Fitting", "Isabel Ramos", "Blue Gown", "15:30", 30),
  activity("sep13-pickup", "2026-09-13", "Pickup", "Miguel Santos", "Barong Tagalog", "12:00", 60),

  // Current mock week: intentionally stresses side-by-side scheduling.
  activity("mon-fit-maria", "2026-09-14", "Fitting", "Maria Santos", "Emerald Gown", "09:00", 60),
  activity("mon-fit-carla", "2026-09-14", "Fitting", "Carla Reyes", "Blue Dress", "09:00", 30),
  activity("mon-fit-ana", "2026-09-14", "Fitting", "Ana Lim", "Wedding Gown", "09:00", 60),
  activity("mon-fit-jamie", "2026-09-14", "Fitting", "Jamie Cruz", "Filipiniana Dress", "09:00", 30),
  activity("mon-fit-bea", "2026-09-14", "Fitting", "Bea Tan", "Red Gown", "09:00", 60),
  activity("mon-pickup", "2026-09-14", "Pickup", "Leanne Cruz", "Black Satin Gown", "11:00", 60),
  activity("mon-return", "2026-09-14", "Return", "Sofia Garcia", "Red Evening Dress", "14:00", 60),

  activity("tue-return", "2026-09-15", "Return", "Daniel Lopez", "Barong Tagalog", "10:00", 60),
  activity("tue-fitting-overlap", "2026-09-15", "Fitting", "Mica Ramos", "Champagne Gown", "10:00", 30),
  activity("tue-pickup", "2026-09-15", "Pickup", "Anna Rivera", "Gown", "13:00", 60),
  activity("tue-fitting", "2026-09-15", "Fitting", "Patricia Lim", "Wedding Gown", "15:00", 60),
  activity("tue-return-evening", "2026-09-15", "Return", "Paolo Dizon", "Black Suit", "18:30", 30),

  activity("wed-pickup", "2026-09-16", "Pickup", "Carla Dela Cruz", "Blue Dress", "09:30", 60),
  activity("wed-return", "2026-09-16", "Return", "James Tan", "Black Suit", "11:30", 60),
  activity("wed-fit-katrina", "2026-09-16", "Fitting", "Katrina Santos", "Emerald Gown", "13:30", 60),
  activity("wed-fit-melanie", "2026-09-16", "Fitting", "Melanie Cruz", "Ivory Dress", "13:30", 30),
  activity("wed-fit-paolo", "2026-09-16", "Fitting", "Paolo Lim", "Barong Tagalog", "13:30", 60),

  activity("thu-return", "2026-09-17", "Return", "Elise Cruz", "Wedding Gown", "10:00", 60),
  activity("thu-fitting", "2026-09-17", "Fitting", "Melanie Santos", "Gown", "13:30", 60),
  activity("thu-fitting-overlap", "2026-09-17", "Fitting", "Alyssa Tan", "Wedding Gown", "15:00", 30),
  activity("thu-pickup-overlap", "2026-09-17", "Pickup", "Luis Navarro", "Barong Tagalog", "15:00", 60),
  activity("thu-return-overlap", "2026-09-17", "Return", "Karen Lim", "Blue Dress", "15:00", 30),
  activity("thu-pickup-evening", "2026-09-17", "Pickup", "Rina Gomez", "Green Gown", "20:00", 60),

  activity("fri-return-early", "2026-09-18", "Return", "Chloe Tan", "Blue Dress", "07:30", 30),
  activity("fri-pickup", "2026-09-18", "Pickup", "Isabella Lopez", "Gown", "09:00", 60),
  activity("fri-fitting", "2026-09-18", "Fitting", "Andrew Ramos", "Filipiniana Dress", "12:30", 30),
  activity("fri-return", "2026-09-18", "Return", "Paolo Diron", "Barong Tagalog", "16:00", 60),
  activity("fri-pickup-evening", "2026-09-18", "Pickup", "Nina Reyes", "Black Gown", "19:30", 30),

  activity("sat-pickup", "2026-09-19", "Pickup", "Kristine Cruz", "Black Gown", "10:30", 60),
  activity("sat-return", "2026-09-19", "Return", "Mark Santos", "Suit", "13:00", 60),
  activity("sat-fitting", "2026-09-19", "Fitting", "Jasmine Lee", "Wedding Gown", "15:30", 30),

  activity("sun-fitting", "2026-09-20", "Fitting", "Denise Ramos", "Gown", "09:00", 60),
  activity("sun-pickup", "2026-09-20", "Pickup", "Luis Navarro", "Barong Tagalog", "12:00", 60),
  activity("sun-return-evening", "2026-09-20", "Return", "Bea Lim", "Emerald Dress", "20:30", 30),

  activity("sep21-pickup", "2026-09-21", "Pickup", "Tina Garcia", "Red Gown", "09:00", 60),
  activity("sep21-fitting", "2026-09-21", "Fitting", "Monica Tan", "Wedding Gown", "14:00", 60),
  activity("sep22-return", "2026-09-22", "Return", "Eric Cruz", "Suit", "11:00", 60),
  activity("sep22-fitting", "2026-09-22", "Fitting", "Janine Lim", "Filipiniana Dress", "16:30", 30),
  activity("sep23-pickup", "2026-09-23", "Pickup", "Kaye Santos", "Blue Gown", "10:00", 60),
  activity("sep23-return", "2026-09-23", "Return", "Marlon Reyes", "Barong Tagalog", "17:30", 30),
  activity("sep24-fitting", "2026-09-24", "Fitting", "Rhea Gomez", "Ivory Gown", "09:30", 60),
  activity("sep24-pickup", "2026-09-24", "Pickup", "Joel Ramos", "Black Suit", "15:00", 60),

  // Busy Friday to demonstrate month-view overflow.
  activity("sep25-pickup-1", "2026-09-25", "Pickup", "Aira Santos", "Emerald Gown", "08:00", 60),
  activity("sep25-return-1", "2026-09-25", "Return", "Victor Lim", "Barong Tagalog", "09:00", 60),
  activity("sep25-fit-1", "2026-09-25", "Fitting", "Maya Cruz", "Wedding Gown", "10:00", 60),
  activity("sep25-pickup-2", "2026-09-25", "Pickup", "Celine Tan", "Blue Dress", "11:30", 30),
  activity("sep25-fit-2", "2026-09-25", "Fitting", "Faith Reyes", "Champagne Gown", "13:00", 60),
  activity("sep25-return-2", "2026-09-25", "Return", "Leo Garcia", "Black Suit", "14:30", 30),
  activity("sep25-pickup-3", "2026-09-25", "Pickup", "Rina Dizon", "Filipiniana Dress", "16:00", 60),
  activity("sep25-fit-3", "2026-09-25", "Fitting", "Sara Lim", "Red Gown", "18:00", 60),
  activity("sep25-return-3", "2026-09-25", "Return", "Noel Santos", "Emerald Dress", "20:00", 60),

  activity("sep26-fitting", "2026-09-26", "Fitting", "Ivy Ramos", "Wedding Gown", "09:00", 60),
  activity("sep26-pickup", "2026-09-26", "Pickup", "Renzo Cruz", "Barong Tagalog", "11:00", 60),
  activity("sep26-return", "2026-09-26", "Return", "Liza Tan", "Blue Gown", "15:30", 30),
  activity("sep27-pickup", "2026-09-27", "Pickup", "Ava Santos", "Ivory Dress", "13:00", 60),
  activity("sep28-return", "2026-09-28", "Return", "Paolo Reyes", "Black Gown", "10:30", 30),
  activity("sep28-fitting", "2026-09-28", "Fitting", "Dina Cruz", "Emerald Gown", "14:00", 60),
  activity("sep29-pickup", "2026-09-29", "Pickup", "Marco Lim", "Suit", "09:00", 60),
  activity("sep29-fitting", "2026-09-29", "Fitting", "Grace Tan", "Wedding Gown", "16:00", 60),
  activity("sep30-return", "2026-09-30", "Return", "Ella Reyes", "Filipiniana Dress", "11:30", 30),
  activity("sep30-pickup", "2026-09-30", "Pickup", "John Cruz", "Barong Tagalog", "18:30", 30),
] as const;

const WEEK_DATE_KEYS = [
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
] as const;

export const CALENDAR_WEEK_ACTIVITIES: readonly CalendarActivity[] = CALENDAR_ACTIVITIES.filter(
  (item) => WEEK_DATE_KEYS.includes(item.dateKey as (typeof WEEK_DATE_KEYS)[number]),
);

export const CALENDAR_DAYS: readonly CalendarDay[] = WEEK_DATE_KEYS.map((dateKey) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return {
    key: dayKeyFor(dateKey),
    label: date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    dateKey,
    activityCount: CALENDAR_WEEK_ACTIVITIES.filter((activityItem) => activityItem.dateKey === dateKey).length,
  };
});

export const CALENDAR_HOURS = Array.from(
  { length: CALENDAR_END_HOUR - CALENDAR_START_HOUR + 1 },
  (_, index) => {
    const hour = CALENDAR_START_HOUR + index;
    const normalized = hour % 12 || 12;
    return `${normalized}:00 ${hour < 12 ? "AM" : "PM"}`;
  },
);

export const CALENDAR_METRICS = [
  {
    label: "Pickups",
    value: CALENDAR_ACTIVITIES.filter((item) => item.type === "Pickup").length,
    tone: "blue",
  },
  {
    label: "Returns",
    value: CALENDAR_ACTIVITIES.filter((item) => item.type === "Return").length,
    tone: "mint",
  },
  {
    label: "Fittings",
    value: CALENDAR_ACTIVITIES.filter((item) => item.type === "Fitting").length,
    tone: "purple",
  },
  { label: "Issues", value: 3, tone: "danger" },
] as const;

export const CALENDAR_DAY_AGENDA: Record<string, readonly CalendarActivity[]> = Object.fromEntries(
  Array.from({ length: 30 }, (_, index) => {
    const dateKey = `2026-09-${String(index + 1).padStart(2, "0")}`;
    return [
      dateKey,
      CALENDAR_ACTIVITIES.filter((item) => item.dateKey === dateKey).sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      ),
    ];
  }),
) as Record<string, readonly CalendarActivity[]>;
