export type CalendarActivityType = "Pickup" | "Return" | "Fitting" | "Reservation";

export type CalendarDay = {
  key: string;
  label: string;
  date: string;
  activityCount: number;
};

export type CalendarActivity = {
  id: string;
  day: string;
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

const DAY_META = [
  { key: "mon", label: "Mon", date: "Sep 14" },
  { key: "tue", label: "Tue", date: "Sep 15" },
  { key: "wed", label: "Wed", date: "Sep 16" },
  { key: "thu", label: "Thu", date: "Sep 17" },
  { key: "fri", label: "Fri", date: "Sep 18" },
  { key: "sat", label: "Sat", date: "Sep 19" },
  { key: "sun", label: "Sun", date: "Sep 20" },
] as const;

export const CALENDAR_ACTIVITIES: readonly CalendarActivity[] = [
  // Monday stress test: five simultaneous fittings at 9:00 AM.
  { id: "mon-fit-maria", day: "mon", type: "Fitting", customer: "Maria Santos", clothing: "Emerald Gown", startTime: "09:00", durationMinutes: 60 },
  { id: "mon-fit-carla", day: "mon", type: "Fitting", customer: "Carla Reyes", clothing: "Blue Dress", startTime: "09:00", durationMinutes: 30 },
  { id: "mon-fit-ana", day: "mon", type: "Fitting", customer: "Ana Lim", clothing: "Wedding Gown", startTime: "09:00", durationMinutes: 60 },
  { id: "mon-fit-jamie", day: "mon", type: "Fitting", customer: "Jamie Cruz", clothing: "Filipiniana Dress", startTime: "09:00", durationMinutes: 30 },
  { id: "mon-fit-bea", day: "mon", type: "Fitting", customer: "Bea Tan", clothing: "Red Gown", startTime: "09:00", durationMinutes: 60 },
  { id: "mon-pickup", day: "mon", type: "Pickup", customer: "Leanne Cruz", clothing: "Black Satin Gown", startTime: "11:00", durationMinutes: 60 },
  { id: "mon-return", day: "mon", type: "Return", customer: "Sofia Garcia", clothing: "Red Evening Dress", startTime: "14:00", durationMinutes: 60 },
  { id: "mon-reservation", day: "mon", type: "Reservation", customer: "Camille Reyes", clothing: "Filipiniana Dress", startTime: "19:30", durationMinutes: 30 },

  // Tuesday: two simultaneous activities for a clean 50 / 50 split.
  { id: "tue-return", day: "tue", type: "Return", customer: "Daniel Lopez", clothing: "Barong Tagalog", startTime: "10:00", durationMinutes: 60 },
  { id: "tue-fitting-overlap", day: "tue", type: "Fitting", customer: "Mica Ramos", clothing: "Champagne Gown", startTime: "10:00", durationMinutes: 30 },
  { id: "tue-pickup", day: "tue", type: "Pickup", customer: "Anna Rivera", clothing: "Gown", startTime: "13:00", durationMinutes: 60 },
  { id: "tue-fitting", day: "tue", type: "Fitting", customer: "Patricia Lim", clothing: "Wedding Gown", startTime: "15:00", durationMinutes: 60 },
  { id: "tue-return-evening", day: "tue", type: "Return", customer: "Paolo Dizon", clothing: "Black Suit", startTime: "18:30", durationMinutes: 30 },

  // Wednesday: three simultaneous fittings for a 33 / 33 / 33 split.
  { id: "wed-pickup", day: "wed", type: "Pickup", customer: "Carla Dela Cruz", clothing: "Blue Dress", startTime: "09:30", durationMinutes: 60 },
  { id: "wed-return", day: "wed", type: "Return", customer: "James Tan", clothing: "Black Suit", startTime: "11:30", durationMinutes: 60 },
  { id: "wed-fit-katrina", day: "wed", type: "Fitting", customer: "Katrina Santos", clothing: "Emerald Gown", startTime: "13:30", durationMinutes: 60 },
  { id: "wed-fit-melanie", day: "wed", type: "Fitting", customer: "Melanie Cruz", clothing: "Ivory Dress", startTime: "13:30", durationMinutes: 30 },
  { id: "wed-fit-paolo", day: "wed", type: "Fitting", customer: "Paolo Lim", clothing: "Barong Tagalog", startTime: "13:30", durationMinutes: 60 },
  { id: "wed-reservation", day: "wed", type: "Reservation", customer: "Sophia Garcia", clothing: "Red Dress", startTime: "16:00", durationMinutes: 60 },

  // Thursday: four simultaneous mixed activities for a 25% split.
  { id: "thu-return", day: "thu", type: "Return", customer: "Elise Cruz", clothing: "Wedding Gown", startTime: "10:00", durationMinutes: 60 },
  { id: "thu-fitting", day: "thu", type: "Fitting", customer: "Melanie Santos", clothing: "Gown", startTime: "13:30", durationMinutes: 60 },
  { id: "thu-reservation-overlap", day: "thu", type: "Reservation", customer: "Janelle Cruz", clothing: "Gold Dress", startTime: "15:00", durationMinutes: 60 },
  { id: "thu-fitting-overlap", day: "thu", type: "Fitting", customer: "Alyssa Tan", clothing: "Wedding Gown", startTime: "15:00", durationMinutes: 30 },
  { id: "thu-pickup-overlap", day: "thu", type: "Pickup", customer: "Luis Navarro", clothing: "Barong Tagalog", startTime: "15:00", durationMinutes: 60 },
  { id: "thu-return-overlap", day: "thu", type: "Return", customer: "Karen Lim", clothing: "Blue Dress", startTime: "15:00", durationMinutes: 30 },
  { id: "thu-pickup-evening", day: "thu", type: "Pickup", customer: "Rina Gomez", clothing: "Green Gown", startTime: "20:00", durationMinutes: 60 },

  // Friday: a mostly normal operational day.
  { id: "fri-return-early", day: "fri", type: "Return", customer: "Chloe Tan", clothing: "Blue Dress", startTime: "07:30", durationMinutes: 30 },
  { id: "fri-pickup", day: "fri", type: "Pickup", customer: "Isabella Lopez", clothing: "Gown", startTime: "09:00", durationMinutes: 60 },
  { id: "fri-fitting", day: "fri", type: "Fitting", customer: "Andrew Ramos", clothing: "Filipiniana Dress", startTime: "12:30", durationMinutes: 30 },
  { id: "fri-return", day: "fri", type: "Return", customer: "Paolo Diron", clothing: "Barong Tagalog", startTime: "16:00", durationMinutes: 60 },
  { id: "fri-pickup-evening", day: "fri", type: "Pickup", customer: "Nina Reyes", clothing: "Black Gown", startTime: "19:30", durationMinutes: 30 },

  { id: "sat-pickup", day: "sat", type: "Pickup", customer: "Kristine Cruz", clothing: "Black Gown", startTime: "10:30", durationMinutes: 60 },
  { id: "sat-return", day: "sat", type: "Return", customer: "Mark Santos", clothing: "Suit", startTime: "13:00", durationMinutes: 60 },
  { id: "sat-fitting", day: "sat", type: "Fitting", customer: "Jasmine Lee", clothing: "Wedding Gown", startTime: "15:30", durationMinutes: 30 },
  { id: "sat-reservation-evening", day: "sat", type: "Reservation", customer: "Janine Cruz", clothing: "Beige Midi Dress", startTime: "20:00", durationMinutes: 60 },

  { id: "sun-fitting", day: "sun", type: "Fitting", customer: "Denise Ramos", clothing: "Gown", startTime: "09:00", durationMinutes: 60 },
  { id: "sun-pickup", day: "sun", type: "Pickup", customer: "Luis Navarro", clothing: "Barong Tagalog", startTime: "12:00", durationMinutes: 60 },
  { id: "sun-return-evening", day: "sun", type: "Return", customer: "Bea Lim", clothing: "Emerald Dress", startTime: "20:30", durationMinutes: 30 },
] as const;

export const CALENDAR_DAYS: readonly CalendarDay[] = DAY_META.map((day) => ({
  ...day,
  activityCount: CALENDAR_ACTIVITIES.filter((activity) => activity.day === day.key).length,
}));

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
    value: CALENDAR_ACTIVITIES.filter((activity) => activity.type === "Pickup").length,
    tone: "blue",
  },
  {
    label: "Returns",
    value: CALENDAR_ACTIVITIES.filter((activity) => activity.type === "Return").length,
    tone: "mint",
  },
  {
    label: "Fittings",
    value: CALENDAR_ACTIVITIES.filter((activity) => activity.type === "Fitting").length,
    tone: "purple",
  },
  { label: "Issues", value: 3, tone: "danger" },
] as const;

export const CALENDAR_DAY_AGENDA: Record<string, readonly CalendarActivity[]> = Object.fromEntries(
  CALENDAR_DAYS.map((day) => [
    day.key,
    CALENDAR_ACTIVITIES.filter((activity) => activity.day === day.key).sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    ),
  ]),
) as Record<string, readonly CalendarActivity[]>;
