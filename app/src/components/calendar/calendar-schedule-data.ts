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
  time: string;
  rowStart: number;
  rowSpan?: number;
};

export const CALENDAR_DAYS: readonly CalendarDay[] = [
  { key: "mon", label: "Mon", date: "Sep 14", activityCount: 8 },
  { key: "tue", label: "Tue", date: "Sep 15", activityCount: 14 },
  { key: "wed", label: "Wed", date: "Sep 16", activityCount: 21 },
  { key: "thu", label: "Thu", date: "Sep 17", activityCount: 12 },
  { key: "fri", label: "Fri", date: "Sep 18", activityCount: 16 },
  { key: "sat", label: "Sat", date: "Sep 19", activityCount: 10 },
  { key: "sun", label: "Sun", date: "Sep 20", activityCount: 7 },
] as const;

export const CALENDAR_ACTIVITIES: readonly CalendarActivity[] = [
  { id: "mon-pickup", day: "mon", type: "Pickup", customer: "Maria Santos", clothing: "Black Satin Gown", time: "9:00 AM", rowStart: 3, rowSpan: 2 },
  { id: "mon-fitting", day: "mon", type: "Fitting", customer: "Leanne Cruz", clothing: "Wedding Gown", time: "11:00 AM", rowStart: 7, rowSpan: 2 },
  { id: "mon-return", day: "mon", type: "Return", customer: "Sofia Garcia", clothing: "Red Evening Dress", time: "2:00 PM", rowStart: 13, rowSpan: 2 },
  { id: "mon-reservation", day: "mon", type: "Reservation", customer: "Camille Reyes", clothing: "Filipiniana Dress", time: "4:00 PM", rowStart: 17, rowSpan: 2 },

  { id: "tue-return", day: "tue", type: "Return", customer: "Daniel Lopez", clothing: "Barong Tagalog", time: "10:00 AM", rowStart: 5, rowSpan: 2 },
  { id: "tue-pickup", day: "tue", type: "Pickup", customer: "Anna Rivera", clothing: "Gown", time: "1:00 PM", rowStart: 11, rowSpan: 2 },
  { id: "tue-fitting", day: "tue", type: "Fitting", customer: "Patricia Lim", clothing: "Wedding Gown", time: "3:00 PM", rowStart: 15, rowSpan: 2 },

  { id: "wed-pickup", day: "wed", type: "Pickup", customer: "Carla Dela Cruz", clothing: "Blue Dress", time: "9:30 AM", rowStart: 4, rowSpan: 2 },
  { id: "wed-return", day: "wed", type: "Return", customer: "James Tan", clothing: "Black Suit", time: "11:30 AM", rowStart: 8, rowSpan: 2 },
  { id: "wed-fitting", day: "wed", type: "Fitting", customer: "Katrina Santos", clothing: "Gown", time: "2:00 PM", rowStart: 13, rowSpan: 2 },
  { id: "wed-reservation", day: "wed", type: "Reservation", customer: "Sophia Garcia", clothing: "Red Dress", time: "4:00 PM", rowStart: 17, rowSpan: 2 },

  { id: "thu-return", day: "thu", type: "Return", customer: "Elise Cruz", clothing: "Wedding Gown", time: "10:00 AM", rowStart: 5, rowSpan: 2 },
  { id: "thu-fitting", day: "thu", type: "Fitting", customer: "Melanie Santos", clothing: "Gown", time: "1:30 PM", rowStart: 12, rowSpan: 2 },
  { id: "thu-reservation", day: "thu", type: "Reservation", customer: "Janelle Cruz", clothing: "Gown", time: "4:00 PM", rowStart: 17, rowSpan: 2 },

  { id: "fri-return", day: "fri", type: "Return", customer: "Chloe Tan", clothing: "Blue Dress", time: "9:00 AM", rowStart: 3, rowSpan: 2 },
  { id: "fri-pickup", day: "fri", type: "Pickup", customer: "Isabella Lopez", clothing: "Gown", time: "11:00 AM", rowStart: 7, rowSpan: 2 },
  { id: "fri-fitting", day: "fri", type: "Fitting", customer: "Andrew Ramos", clothing: "Filipiniana Dress", time: "2:00 PM", rowStart: 13, rowSpan: 2 },
  { id: "fri-return-late", day: "fri", type: "Return", customer: "Paolo Diron", clothing: "Barong Tagalog", time: "4:30 PM", rowStart: 18, rowSpan: 2 },

  { id: "sat-pickup", day: "sat", type: "Pickup", customer: "Kristine Cruz", clothing: "Black Gown", time: "10:30 AM", rowStart: 6, rowSpan: 2 },
  { id: "sat-return", day: "sat", type: "Return", customer: "Mark Santos", clothing: "Suit", time: "1:00 PM", rowStart: 11, rowSpan: 2 },
  { id: "sat-fitting", day: "sat", type: "Fitting", customer: "Jasmine Lee", clothing: "Wedding Gown", time: "3:30 PM", rowStart: 16, rowSpan: 2 },

  { id: "sun-fitting", day: "sun", type: "Fitting", customer: "Denise Ramos", clothing: "Gown", time: "9:00 AM", rowStart: 3, rowSpan: 2 },
  { id: "sun-pickup", day: "sun", type: "Pickup", customer: "Luis Navarro", clothing: "Barong Tagalog", time: "12:00 PM", rowStart: 9, rowSpan: 2 },
] as const;

export const CALENDAR_HOURS = [
  "8:00 AM",
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "12:00 PM",
  "1:00 PM",
  "2:00 PM",
  "3:00 PM",
  "4:00 PM",
  "5:00 PM",
] as const;

export const CALENDAR_METRICS = [
  { label: "Pickups", value: 12, tone: "blue" },
  { label: "Returns", value: 8, tone: "mint" },
  { label: "Fittings", value: 14, tone: "purple" },
  { label: "Issues", value: 3, tone: "danger" },
] as const;

export const CALENDAR_MORE_COUNTS: Record<string, number> = {
  mon: 2,
  tue: 4,
  wed: 6,
  thu: 3,
  fri: 5,
  sat: 2,
  sun: 1,
};
