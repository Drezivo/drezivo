"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * Wraps the native <dialog> element rather than reimplementing focus trapping, Escape-to-
 * close and backdrop semantics by hand — the platform already gets this right.
 */
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      aria-describedby={description ? "dialog-description" : undefined}
      onClose={onClose}
      onCancel={onClose}
      className="w-full max-w-md rounded-lg border border-ink-300 bg-white p-0 shadow-lg backdrop:bg-ink-900/40"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="dialog-title" className="text-base font-semibold text-ink-900">
            {title}
          </h2>
          {description && (
            <p id="dialog-description" className="text-sm text-ink-500">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
    </dialog>
  );
}
