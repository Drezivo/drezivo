"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";

import type { SaveState } from "@/components/forms/form-kit";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

type Client = ReturnType<typeof createDrezivoApiClient>;

export function messageOf(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) {
    return error.code === "STALE_VERSION" ? "These settings changed elsewhere. Reload the page to see the latest values." : error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Load → edit a local draft → save once per intent. `dirty` compares with the last server copy,
 * so saving the same values twice is impossible and a retry after a timeout reuses its key.
 */
export function useSettingsResource<T extends { version: number }, D>(options: {
  load: (client: Client) => Promise<{ data: T }>;
  save: (client: Client, current: T, draft: D, key: string) => Promise<{ data: T }>;
  toDraft: (value: T) => D;
}) {
  const { getToken } = useAuth();
  const guard = useSubmitGuard();
  const [value, setValue] = useState<T | null>(null);
  const [draft, setDraft] = useState<D | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [reloadToken, setReloadToken] = useState(0);
  const { load, toDraft } = options;

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    load(createDrezivoApiClient(getToken))
      .then((result) => {
        if (cancelled) return;
        setValue(result.data);
        setDraft(toDraft(result.data));
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(messageOf(error, "Could not load these settings."));
      });
    return () => {
      cancelled = true;
    };
    // `load` and `toDraft` are stable module-level functions supplied by each page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, reloadToken]);

  const update = useCallback(
    (patch: Partial<D>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));
      guard.resetIntent();
      setState((current) => (current.kind === "saved" ? { kind: "idle" } : current));
    },
    [guard],
  );

  async function save() {
    if (!value || !draft) return;
    try {
      const result = await guard.submit((key) => options.save(createDrezivoApiClient(getToken), value, draft, key));
      if (!result) return;
      setValue(result.data);
      setDraft(toDraft(result.data));
      guard.resetIntent();
      setState({ kind: "saved" });
    } catch (error) {
      setState({ kind: "error", message: messageOf(error, "Could not save these settings.") });
    }
  }

  return {
    value,
    draft,
    update,
    save,
    saving: guard.isSubmitting,
    state,
    loadError,
    reload: () => setReloadToken((token) => token + 1),
    dirty: value !== null && draft !== null && JSON.stringify(toDraft(value)) !== JSON.stringify(draft),
  };
}
