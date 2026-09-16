import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Pass a mutating control's `isPending` from useSubmitGuard directly. This both disables
   * the button AND shows pending copy — the `disabled` attribute alone is not the
   * double-submit guard (see lib/use-submit-guard.ts for the real, ref-backed guard); this
   * prop is the visual half only.
   */
  isPending?: boolean;
  pendingLabel?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-ink-900 border border-ink-300 hover:bg-ink-100 disabled:opacity-50",
  danger: "bg-danger-500 text-white hover:bg-danger-500/90 disabled:bg-danger-500/50",
  ghost: "bg-transparent text-ink-700 hover:bg-ink-100 disabled:opacity-50",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", isPending = false, pendingLabel, disabled, className = "", children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "transition-colors disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        className,
      ].join(" ")}
      {...props}
    >
      {isPending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
});
