"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Stops an owner from losing a half-entered batch. Closing the tab gets the browser's own prompt;
 * any link inside the app opens this dialog instead, offering to save the batch for later first.
 */
export function LeaveGuard({
  active,
  pendingCount,
  onSaveForLater,
}: {
  active: boolean;
  pendingCount: number;
  onSaveForLater: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    // Capture phase, so this runs before Next's Link handler and can hold the navigation.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);

  const leave = (href: string) => {
    setTarget(null);
    router.push(href);
  };

  const saveAndLeave = async () => {
    if (!target || saving) return;
    setSaving(true);
    const saved = await onSaveForLater();
    setSaving(false);
    if (saved) leave(target);
  };

  return (
    <Dialog.Root open={target !== null} onOpenChange={(open: boolean) => !open && !saving && setTarget(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashboard-border bg-dashboard-surface p-5 shadow-xl focus:outline-none sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-dashboard-active text-dashboard-accent">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold text-dashboard-navy">Leave batch add?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-dashboard-muted">
                {pendingCount === 1 ? "1 item is" : `${pendingCount} items are`} not added to your clothing yet. If you leave
                without saving, they will be gone. Save for later keeps them, with their photos, on this device.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setTarget(null)}>
              Keep editing
            </Button>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => target && leave(target)}>
              Leave without saving
            </Button>
            <Button type="button" disabled={saving} onClick={() => void saveAndLeave()}>
              {saving ? "Saving…" : "Save for later & leave"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
