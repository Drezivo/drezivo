import {
  CalendarDays,
  ClipboardList,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  Ruler,
  Settings,
  Shirt,
  Store,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Sidebar order. The phone tab bar and Menu sheet are built from these same entries. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/inventory", label: "Clothing", icon: Shirt },
  { href: "/customers", label: "Customers", icon: UsersRound },
  { href: "/fittings", label: "Fittings", icon: Ruler },
  { href: "/storefront", label: "Storefront", icon: Store },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Phones: the four daily screens get a tab; everything else lives in the Menu sheet. */
export const TAB_HREFS = ["/", "/reservations", "/calendar", "/inventory"] as const;

export const MENU_ITEMS: readonly NavItem[] = [
  ...NAV_ITEMS.filter((item) => !(TAB_HREFS as readonly string[]).includes(item.href)),
  { href: "/settings/payment-methods", label: "Payment methods", icon: CreditCard },
  { href: "/help", label: "Help Center", icon: HelpCircle },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/settings") return pathname === "/settings" || (pathname.startsWith("/settings/") && !pathname.startsWith("/settings/payment-methods"));
  return pathname === href || pathname.startsWith(`${href}/`);
}
