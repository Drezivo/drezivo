"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { forwardRef, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(function SheetOverlay({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Overlay
      ref={ref}
      className={cn(
        "dashboard-sheet-overlay fixed inset-0 z-50 bg-dashboard-overlay/25 backdrop-blur-sm",
        className
      )}
      {...props}
    />
  );
});

const SheetContent = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: "top" | "right" | "bottom" | "left";
  }
>(function SheetContent({ side = "right", className, children, ...props }, ref) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref]
  );

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={setContentRef}
        className={cn(
          "dashboard-sheet-content fixed z-50 flex flex-col gap-4 bg-dashboard-surface shadow-xl outline-none",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 border-b",
          side === "bottom" &&
            "inset-x-0 bottom-0 border-t",
          className
        )}
        data-side={side}
        {...props}
      >
        <SheetGrabber sheet={contentRef} onDismiss={() => closeRef.current?.click()} />
        {children}
        <SheetPrimitive.Close ref={closeRef} className="absolute right-4 top-4 rounded-md p-2 text-dashboard-muted opacity-80 transition-opacity hover:bg-dashboard-active hover:text-dashboard-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/30 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});

/** Below this many pixels a released drag springs back; past it (or on a quick flick) the sheet closes. */
const DISMISS_DISTANCE_PX = 110;
const DISMISS_VELOCITY_PX_PER_MS = 0.6;
const IOS_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * Phones only: the grab handle of the bottom sheet. Dragging it moves the whole sheet with the
 * finger (upward drags resist), and releasing far or fast enough closes it, as on iOS. It uses the
 * CSS `translate` property because the sheet's open animation owns `transform`; the two compose,
 * so a close started mid-drag continues from where the finger let go. Only the handle area takes
 * the gesture, so content inside the sheet keeps its normal scrolling.
 */
function SheetGrabber({
  sheet,
  onDismiss,
}: {
  sheet: React.RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}) {
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number; id: number } | null>(null);

  const place = (offset: number, animate: boolean) => {
    const node = sheet.current;
    if (!node) return;
    node.style.transition = animate ? `translate 320ms ${IOS_EASE}` : "none";
    node.style.translate = offset ? `0 ${offset}px` : "";
  };

  return (
    <div
      aria-hidden="true"
      className="flex h-7 w-full shrink-0 touch-none cursor-grab items-center justify-center sm:hidden"
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0, id: event.pointerId };
        place(0, false);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.id !== event.pointerId) return;
        const dy = event.clientY - state.startY;
        const dt = Math.max(1, event.timeStamp - state.lastT);
        state.velocity = (event.clientY - state.lastY) / dt;
        state.lastY = event.clientY;
        state.lastT = event.timeStamp;
        // Downward follows the finger; upward resists (rubber band) since the sheet is already open.
        place(dy > 0 ? dy : dy / 4, false);
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        drag.current = null;
        if (!state) return;
        const dy = event.clientY - state.startY;
        if (dy > DISMISS_DISTANCE_PX || state.velocity > DISMISS_VELOCITY_PX_PER_MS) {
          onDismiss();
          return;
        }
        place(0, true);
      }}
      onPointerCancel={() => {
        drag.current = null;
        place(0, true);
      }}
    >
      <span className="h-1 w-10 rounded-full bg-dashboard-border" />
    </div>
  );
}

const SheetTitle = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Title
      ref={ref}
      className={cn("text-base font-semibold text-dashboard-navy", className)}
      {...props}
    />
  );
});

const SheetDescription = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return (
    <SheetPrimitive.Description
      ref={ref}
      className={cn("text-sm text-dashboard-muted", className)}
      {...props}
    />
  );
});

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
