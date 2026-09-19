"use client";

import { useCallback, useRef, useState } from "react";

type SubmitOperation<T> = (idempotencyKey: string) => Promise<T>;

export function useSubmitGuard() {
  const idempotencyKeyRef = useRef<string | null>(null);
  const isSubmittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetIntent = useCallback(() => {
    if (!isSubmittingRef.current) idempotencyKeyRef.current = null;
  }, []);

  const submit = useCallback(async <T>(operation: SubmitOperation<T>): Promise<T | undefined> => {
    if (isSubmittingRef.current) return undefined;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    idempotencyKeyRef.current ??= createIdempotencyKey();

    try {
      return await operation(idempotencyKeyRef.current);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, resetIntent, submit };
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `drezivo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
