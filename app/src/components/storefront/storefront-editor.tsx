"use client";

import { useAuth } from "@clerk/nextjs";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  storefrontDocument,
  storefrontPolicyRules,
  storefrontSlug,
  type StorefrontDocument,
  type StorefrontPolicyRules,
  type StorefrontSettings,
} from "@drezivo/contracts";

import type { SaveState } from "@/components/forms/form-kit";
import { createDrezivoApiClient, DrezivoApiError } from "@/lib/drezivo-api";
import { useSubmitGuard } from "@/lib/use-submit-guard";

/** Field errors keyed by contract path, e.g. `content.hero.heading`. */
export type FieldErrors = Record<string, string>;

interface StorefrontEditor {
  settings: StorefrontSettings | null;
  loading: boolean;
  loadError: string | null;
  reload: () => void;
  saving: boolean;
  saveState: SaveState;
  fieldErrors: FieldErrors;
  /** Call on every edit so the next save is a new intent with a new Idempotency-Key. */
  markEdited: () => void;
  saveDocument: (next: StorefrontDocument) => Promise<boolean>;
  saveSlug: (slug: string) => Promise<boolean>;
  savePolicy: (rules: StorefrontPolicyRules) => Promise<boolean>;
  setPublished: (published: boolean) => Promise<boolean>;
}

const EditorContext = createContext<StorefrontEditor | null>(null);

export function useStorefrontEditor(): StorefrontEditor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useStorefrontEditor must be used inside StorefrontEditorProvider.");
  return editor;
}

function issuesToErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>, prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = prefix + issue.path.map(String).join(".");
    errors[key] ??= sentence(issue.message);
  }
  return errors;
}

function sentence(message: string): string {
  const trimmed = message.trim();
  return trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : "Check this field.";
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof DrezivoApiError) {
    if (error.code === "STALE_VERSION") return "Someone else changed the storefront. Reload to see the latest version.";
    return error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Loads the storefront once for every storefront page and owns every write to it. Each action has
 * its own submit guard, so double clicks send one request and a retry reuses the same key.
 */
export function StorefrontEditorProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [reloadToken, setReloadToken] = useState(0);
  const documentGuard = useSubmitGuard();
  const slugGuard = useSubmitGuard();
  const policyGuard = useSubmitGuard();
  const publishGuard = useSubmitGuard();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    createDrezivoApiClient(getToken)
      .getStorefront()
      .then((result) => {
        if (!cancelled) setSettings(result.data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(messageOf(error, "Could not load your storefront."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getToken, reloadToken]);

  const run = useCallback(
    async (guard: ReturnType<typeof useSubmitGuard>, action: (client: ReturnType<typeof createDrezivoApiClient>, key: string) => Promise<{ data: StorefrontSettings }>, fallback: string) => {
      try {
        const result = await guard.submit((key) => action(createDrezivoApiClient(getToken), key));
        if (!result) return false;
        setSettings(result.data);
        window.dispatchEvent(
          new CustomEvent("drezivo:storefront-updated", {
            detail: { logoUrl: result.data.media.logo_url },
          })
        );
        guard.resetIntent();
        setFieldErrors({});
        setSaveState({ kind: "saved" });
        return true;
      } catch (error) {
        setSaveState({ kind: "error", message: messageOf(error, fallback) });
        return false;
      }
    },
    [getToken],
  );

  const editor: StorefrontEditor = {
    settings,
    loading,
    loadError,
    reload: () => setReloadToken((value) => value + 1),
    saving: documentGuard.isSubmitting || slugGuard.isSubmitting || policyGuard.isSubmitting || publishGuard.isSubmitting,
    saveState,
    fieldErrors,
    markEdited: () => {
      documentGuard.resetIntent();
      slugGuard.resetIntent();
      policyGuard.resetIntent();
      setSaveState((state) => (state.kind === "saved" ? { kind: "idle" } : state));
    },
    saveDocument: async (next) => {
      if (!settings) return false;
      const parsed = storefrontDocument.safeParse(next);
      if (!parsed.success) {
        setFieldErrors(issuesToErrors(parsed.error.issues));
        setSaveState({ kind: "error", message: "Fix the highlighted fields." });
        return false;
      }
      return run(documentGuard, (client, key) => client.updateStorefront({ version: settings.version, document: parsed.data }, key), "Could not save the storefront.");
    },
    saveSlug: async (slug) => {
      if (!settings) return false;
      const parsed = storefrontSlug.safeParse(slug);
      if (!parsed.success) {
        setFieldErrors(issuesToErrors(parsed.error.issues, "slug"));
        setSaveState({ kind: "error", message: "Fix the store address." });
        return false;
      }
      return run(slugGuard, (client, key) => client.updateStorefrontSlug({ version: settings.version, slug: parsed.data }, key), "Could not change the store address.");
    },
    savePolicy: async (rules) => {
      if (!settings) return false;
      const parsed = storefrontPolicyRules.safeParse(rules);
      if (!parsed.success) {
        setFieldErrors(issuesToErrors(parsed.error.issues, "policy."));
        setSaveState({ kind: "error", message: "Fix the highlighted fields." });
        return false;
      }
      return run(policyGuard, (client, key) => client.publishStorefrontPolicy({ expected_version: settings.policy.version, rules: parsed.data }, key), "Could not publish the policy.");
    },
    setPublished: async (published) => {
      if (!settings) return false;
      const done = await run(publishGuard, (client, key) => client.setStorefrontPublished(published, settings.version, key), published ? "Could not publish." : "Could not unpublish.");
      publishGuard.resetIntent();
      return done;
    },
  };

  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

/**
 * Local draft of one part of the document. `dirty` compares with what the server last returned,
 * and the draft resets whenever the saved version changes (after a save or a reload).
 */
export function useDocumentDraft<K extends keyof StorefrontDocument>(key: K) {
  const editor = useStorefrontEditor();
  const saved = editor.settings?.document[key] ?? null;
  const [draft, setDraft] = useState<StorefrontDocument[K] | null>(saved);
  const savedVersion = editor.settings?.version;

  useEffect(() => {
    setDraft(editor.settings?.document[key] ?? null);
    // Reset only when the server version moves, not on every render of the same data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedVersion, key]);

  const update = useCallback(
    (patch: Partial<StorefrontDocument[K]>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));
      editor.markEdited();
    },
    [editor],
  );

  return { draft, dirty: JSON.stringify(draft) !== JSON.stringify(saved), update, setDraft };
}
