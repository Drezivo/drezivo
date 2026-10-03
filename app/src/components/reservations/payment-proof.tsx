"use client";

import { useAuth } from "@clerk/nextjs";
import type { ReservationPaymentReceipt } from "@drezivo/contracts";
import { ExternalLink, FileText, Loader2, Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ImageLightbox } from "@/components/ui/image-lightbox";
import { createDrezivoApiClient } from "@/lib/drezivo-api";

export type PaymentProofState =
  | { kind: "loading" }
  | { kind: "ready"; receipts: ReservationPaymentReceipt[] }
  | { kind: "error"; message: string };

/** Loads the renter's uploaded receipts for one reservation. Links expire after five minutes. */
export function usePaymentProof(reservationId: string, enabled: boolean): PaymentProofState {
  const { getToken } = useAuth();
  const [state, setState] = useState<PaymentProofState>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ kind: "loading" });
    createDrezivoApiClient(getToken)
      .getReservationPaymentReceipts(reservationId)
      .then((result) => !cancelled && setState({ kind: "ready", receipts: result.data.receipts }))
      .catch(() => !cancelled && setState({ kind: "error", message: "Could not load the payment proof. Close and reopen this reservation to try again." }));
    return () => {
      cancelled = true;
    };
  }, [enabled, getToken, reservationId]);

  return state;
}

const isImage = (receipt: ReservationPaymentReceipt) => receipt.content_type !== "application/pdf";

/**
 * The renter's proof of payment, shown where the owner verifies it. Images open full size in the
 * shared lightbox; a PDF opens in a new tab. The lightbox is controlled by the parent so the
 * confirmation dialog can reopen it ("View proof again").
 */
export function PaymentProof({
  state,
  viewerOpen,
  onViewerOpenChange,
}: {
  state: PaymentProofState;
  viewerOpen: boolean;
  onViewerOpenChange: (open: boolean) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (state.kind === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-dashboard-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading the payment proof…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-xs text-dashboard-danger">
        {state.message}
      </p>
    );
  }
  if (state.receipts.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-dashboard-border px-3 py-2.5 text-xs text-dashboard-muted">
        The renter has not uploaded a proof of payment yet. Verify only if you can see this payment in your own account.
      </p>
    );
  }

  const images = state.receipts.filter(isImage);
  const documents = state.receipts.filter((receipt) => !isImage(receipt));

  return (
    <div>
      <p className="mb-2 text-xs font-medium text-dashboard-muted">Proof of payment from the renter</p>
      <div className="flex flex-wrap gap-2">
        {images.map((receipt, index) => (
          <button
            key={receipt.file_id}
            type="button"
            onClick={() => {
              setActiveIndex(index);
              onViewerOpenChange(true);
            }}
            className="group relative h-40 w-32 overflow-hidden rounded-md border border-dashboard-border bg-dashboard-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dashboard-accent/40"
            aria-label={`View proof of payment ${index + 1} full size`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- five-minute signed URL */}
            <img src={receipt.url} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 py-1 text-[11px] text-white opacity-90 group-hover:opacity-100">
              <Maximize2 className="h-3 w-3" aria-hidden="true" />
              View full size
            </span>
          </button>
        ))}
        {documents.map((receipt, index) => (
          <a
            key={receipt.file_id}
            href={receipt.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-40 w-32 flex-col items-center justify-center gap-2 rounded-md border border-dashboard-border bg-dashboard-canvas text-xs text-dashboard-navy hover:border-dashboard-accent/50"
          >
            <FileText className="h-6 w-6 text-dashboard-muted" aria-hidden="true" />
            PDF proof {documents.length > 1 ? index + 1 : ""}
            <span className="inline-flex items-center gap-1 text-dashboard-muted">
              Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </span>
          </a>
        ))}
      </div>
      {images.length > 0 ? (
        <ImageLightbox
          images={images.map((receipt, index) => ({ src: receipt.url, alt: `Proof of payment ${index + 1}` }))}
          open={viewerOpen}
          onOpenChange={onViewerOpenChange}
          activeIndex={activeIndex}
          onActiveIndexChange={setActiveIndex}
        />
      ) : null}
    </div>
  );
}
