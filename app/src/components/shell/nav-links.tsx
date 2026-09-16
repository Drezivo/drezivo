"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

// One entry per top-level route group under (dashboard); order matches the sidebar in the
// design reference screenshots (docs/frontend-references/Business/).
const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/reservations", label: "Reservations" },
  { href: "/calendar", label: "Calendar" },
  { href: "/inventory", label: "Inventory" },
  { href: "/customers", label: "Customers" },
  { href: "/fittings", label: "Fittings" },
  { href: "/payments", label: "Payments" },
  { href: "/storefront", label: "Storefront" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={[
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-brand-100 text-brand-700" : "text-ink-700 hover:bg-ink-100",
            ].join(" ")}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
