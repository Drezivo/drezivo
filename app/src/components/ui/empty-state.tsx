import type { ReactNode } from "react";

export interface EmptyStateProps {
  heading: string;
  /** Explain WHY it's empty and what to do next — never a bare "No data." */
  description: string;
  action?: ReactNode;
}

export function EmptyState({ heading, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-ink-900">{heading}</h3>
      <p className="max-w-sm text-sm text-ink-500">{description}</p>
      {action}
    </div>
  );
}
