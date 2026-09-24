"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";

export type LightboxImage = {
  src: string;
  alt: string;
};

export function ImageLightbox({
  images,
  open,
  onOpenChange,
  activeIndex,
  onActiveIndexChange,
}: {
  images: LightboxImage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
}) {
  const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0));
  const activeImage = images[safeIndex] ?? null;
  const canNavigate = images.length > 1;

  useEffect(() => {
    if (!open || !canNavigate) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onActiveIndexChange((safeIndex - 1 + images.length) % images.length);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onActiveIndexChange((safeIndex + 1) % images.length);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canNavigate, images.length, onActiveIndexChange, open, safeIndex]);

  return (
    <Dialog.Root open={open && activeImage !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[101] flex max-h-[92vh] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Image preview</Dialog.Title>

          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close image preview"
              className="absolute right-3 top-3 z-[103] inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </Dialog.Close>

          {canNavigate ? (
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => onActiveIndexChange((safeIndex - 1 + images.length) % images.length)}
              className="absolute left-3 top-1/2 z-[103] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : null}

          <div className="relative flex max-h-[90vh] max-w-[92vw] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/25 shadow-2xl">
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- caller can provide short-lived signed image URLs.
              <img
                src={activeImage.src}
                alt={activeImage.alt}
                className="max-h-[88vh] max-w-[90vw] object-contain"
              />
            ) : null}
          </div>

          {canNavigate ? (
            <>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => onActiveIndexChange((safeIndex + 1) % images.length)}
                className="absolute right-3 top-1/2 z-[103] inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </button>
              <div
                className={cn(
                  "absolute bottom-4 left-1/2 z-[103] -translate-x-1/2 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-sm",
                  images.length <= 1 && "hidden"
                )}
                aria-live="polite"
              >
                {safeIndex + 1} / {images.length}
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
