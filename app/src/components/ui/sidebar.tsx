"use client";

import { Menu } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SidebarContextValue = {
  state: "expanded" | "collapsed";
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  toggleSidebar: () => void;
};
const SidebarContext = createContext<SidebarContextValue | null>(null);

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setIsMobile(false);
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);
  return isMobile;
}

function SidebarProvider({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(true);
  const [openMobile, setOpenMobile] = useState(false);
  const state: SidebarContextValue["state"] = open ? "expanded" : "collapsed";
  const toggleSidebar = useCallback(() => {
    if (isMobile) setOpenMobile((current) => !current);
    else setOpen((current) => !current);
  }, [isMobile]);
  const value = useMemo(
    () => ({ state, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [isMobile, openMobile, state, toggleSidebar]
  );
  return (
    <SidebarContext.Provider value={value}>
      <div data-sidebar="provider" className={cn("flex min-h-svh w-full", className)}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used inside SidebarProvider");
  return context;
}

const Sidebar = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(function Sidebar(
  { className, children, ...props },
  ref
) {
  const { state, isMobile, openMobile, setOpenMobile } = useSidebar();
  if (isMobile)
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          className={cn(
            "w-[256px] gap-0 border-r border-dashboard-border bg-dashboard-surface p-0",
            className
          )}
          {...props}
        >
          <SheetTitle className="sr-only">Dashboard navigation</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  return (
    <aside
      ref={ref}
      data-state={state}
      className={cn(
        "group/sidebar hidden h-svh shrink-0 flex-col border-r border-dashboard-border bg-dashboard-surface transition-[width] duration-200 md:flex",
        state === "expanded" ? "w-[256px]" : "w-[72px]",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
});

const SidebarInset = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function SidebarInset({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex min-w-0 flex-1 flex-col bg-dashboard-canvas", className)}
        {...props}
      />
    );
  }
);

function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar, isMobile, openMobile } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle navigation"
      aria-expanded={isMobile ? openMobile : undefined}
      className={cn("text-dashboard-navy", className)}
      onClick={toggleSidebar}
      {...props}
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}

export { Sidebar, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar };
