'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Client-side size selection. This does not itself perform a mutation — it
 * only decides which query param to carry into the booking flow — so it
 * does not need `useSubmitGuard`. The guard is reserved for the flow's
 * actual writes (see book/[itemId]/page.tsx).
 */
export function SizeSelector({
  storeSlug,
  itemId,
  sizes,
}: {
  storeSlug: string;
  itemId: string;
  sizes: readonly string[];
}) {
  const router = useRouter();
  const [selectedSize, setSelectedSize] = useState<string | undefined>(sizes[0]);

  return (
    <div>
      <p className="text-sm font-medium text-foreground">Available Sizes</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {sizes.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => setSelectedSize(size)}
            aria-pressed={selectedSize === size}
            className={`rounded-full border px-4 py-2 text-sm font-medium ${
              selectedSize === size
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-foreground'
            }`}
          >
            {size}
          </button>
        ))}
      </div>
      <Button
        className="mt-6 w-full"
        disabled={!selectedSize}
        onClick={() => {
          if (!selectedSize) return;
          router.push(
            `/s/${storeSlug}/book/${itemId}?size=${encodeURIComponent(selectedSize)}`,
          );
        }}
      >
        Reserve This Item
      </Button>
    </div>
  );
}
