import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground disabled:bg-primary/50',
  secondary: 'border border-border text-foreground disabled:opacity-50',
  ghost: 'text-foreground underline underline-offset-2 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shown instead of children while a submit-guarded action is pending. */
  isLoading?: boolean;
}

/**
 * The one button primitive for every mutating action in this repo. It
 * forwards `disabled` as-is — callers pair this with `useSubmitGuard`'s
 * `isPending` for the visual state, but the REAL double-submit protection is
 * the guard's in-flight ref, not this `disabled` attribute (which keyboard
 * activation and rapid duplicate dispatch can bypass on their own).
 */
export function Button({
  variant = 'primary',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition-opacity ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
