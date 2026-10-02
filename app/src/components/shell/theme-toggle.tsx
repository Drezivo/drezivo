"use client";

import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setThemePreference, useTheme } from "@/lib/theme";

/** One-click switch between light and dark. The account menu also offers "Match system". */
export function ThemeToggle() {
  const { resolved } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setThemePreference(next)}
      className="h-9 w-9 rounded-full text-dashboard-navy"
    >
      {resolved === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </Button>
  );
}
