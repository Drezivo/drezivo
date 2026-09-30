"use client";

import { useAuth } from "@clerk/nextjs";
import { Eye, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { createDrezivoApiClient } from "@/lib/drezivo-api";

const WINDOW_NAME = "drezivo-storefront-preview";

/**
 * Opens the owner's storefront in a new tab even while it is a draft. The short-lived preview token
 * is POSTed to the storefront (never put in a URL, so it stays out of history and server logs),
 * which switches that tab into preview mode.
 */
export function StorefrontPreviewButton({ className }: { className?: string }) {
  const { getToken } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const origin = process.env["NEXT_PUBLIC_STOREFRONT_ORIGIN"]?.replace(/\/$/, "");

  async function open() {
    if (inFlight.current || !origin) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    // Open the tab inside the click so popup blockers allow it; the form fills it once the token arrives.
    const tab = window.open("about:blank", WINDOW_NAME);
    if (tab) tab.opener = null;
    try {
      const { data } = await createDrezivoApiClient(getToken).getStorefrontPreview();
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `${origin}/s/${encodeURIComponent(data.slug)}/preview`;
      form.target = WINDOW_NAME;
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "token";
      field.value = data.token;
      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
      form.remove();
    } catch {
      tab?.close();
      setError("Could not open the preview. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (!origin) return null;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void open()}
        disabled={pending}
        aria-busy={pending}
        className={
          className ??
          "inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-dashboard-border px-2 text-xs text-dashboard-navy hover:bg-dashboard-active disabled:opacity-60"
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview
      </button>
      {error ? (
        <span role="alert" className="mt-1 text-xs text-dashboard-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
