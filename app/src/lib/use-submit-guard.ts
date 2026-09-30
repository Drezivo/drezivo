"use client";

import { useCallback, useRef, useState } from "react";

import { DrezivoApiError } from "@/lib/drezivo-api";

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
      const result = await operation(idempotencyKeyRef.current);
      // The intent is done. Keeping the key would make the next save (often with a new version in
      // the body) look like a changed replay, which the API rejects as IDEMPOTENCY_KEY_REUSED.
      idempotencyKeyRef.current = null;
      return result;
    } catch (error) {
      // Only a failure the same request could still fix (network, timeout, server error) keeps the
      // key, so the retry replays instead of duplicating. A definite rejection ends the intent.
      if (!isRetryable(error)) idempotencyKeyRef.current = null;
      throw error;
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }, []);

  return { isSubmitting, resetIntent, submit };
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof DrezivoApiError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `drezivo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
