'use client';

import { useEffect, useRef, useState } from 'react';

import type { CatalogueCard, CatalogueVariant, ItemDetail } from '@drezivo/contracts';

import { getAvailability, getCatalogue, getItem } from '@/lib/storefront-api';
import { formatMinor } from '@/lib/storefront-format';

import type { DateRange } from './availability-calendar';

/** One booking holds at most this many pieces, the first one included (API: MAX_RESERVATION_LINES). */
export const MAX_PIECES_PER_BOOKING = 10;
const PICKER_PAGE_SIZE = 12;

/** Another piece the renter adds for the same dates, with its size and a check of those dates. */
export interface ExtraPiece {
  key: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  item: ItemDetail | null;
  variant: CatalogueVariant | null;
  /** Result of checking the chosen size for `checkedFor` (the dates at check time). */
  free: boolean | null;
  checkedFor: string | null;
  error: string | null;
}

export function rangeKey(range: DateRange | null): string | null {
  return range ? `${range.start}|${range.end}` : null;
}

/** Ready to send when every piece has a size that was seen free for the current dates. */
export function extraPiecesReadiness(pieces: readonly ExtraPiece[], range: DateRange | null): { ready: boolean; problem: string | null } {
  const key = rangeKey(range);
  for (const piece of pieces) {
    if (piece.error) return { ready: false, problem: piece.error };
    if (!piece.variant) return { ready: false, problem: `Choose a size for ${piece.name}.` };
    if (piece.checkedFor !== key || piece.free === null) return { ready: false, problem: `Checking ${piece.name} for your dates…` };
    if (!piece.free) return { ready: false, problem: `${piece.name} in this size is not free for your dates. Remove it or choose another size.` };
  }
  return { ready: true, problem: null };
}

/**
 * "Add another piece" for the booking drawer: pick from the shop's collection, choose a size, and
 * see whether it is free for the dates already chosen. The server re-checks everything when the
 * request is sent, including whether there are enough pieces when the same size is added twice.
 */
export function ExtraPieces({
  slug,
  range,
  pieces,
  onChange,
}: {
  slug: string;
  range: DateRange | null;
  pieces: ExtraPiece[];
  onChange: (update: (current: ExtraPiece[]) => ExtraPiece[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [cards, setCards] = useState<CatalogueCard[] | null>(null);
  const inFlight = useRef(new Set<string>());
  const key = rangeKey(range);

  useEffect(() => {
    if (!picking || cards) return;
    let cancelled = false;
    getCatalogue(slug, { page_size: String(PICKER_PAGE_SIZE), sort: 'featured' })
      .then((result) => {
        if (!cancelled) setCards(result.items);
      })
      .catch(() => {
        if (!cancelled) setCards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cards, picking, slug]);

  // Load each added item's sizes once; an item with one size is chosen for the renter.
  useEffect(() => {
    for (const piece of pieces) {
      const flight = `item:${piece.key}`;
      if (piece.item || piece.error || inFlight.current.has(flight)) continue;
      inFlight.current.add(flight);
      getItem(slug, piece.productId)
        .then((item) =>
          onChange((current) =>
            current.map((entry) =>
              entry.key !== piece.key
                ? entry
                : item
                  ? { ...entry, item, variant: item.variants.length === 1 ? (item.variants[0] ?? null) : entry.variant }
                  : { ...entry, error: `${piece.name} is no longer available.` },
            ),
          ),
        )
        .catch(() => onChange((current) => current.map((entry) => (entry.key === piece.key ? { ...entry, error: `Could not load ${piece.name}.` } : entry))))
        .finally(() => inFlight.current.delete(flight));
    }
  }, [onChange, pieces, slug]);

  // Check each chosen size for the current dates, again whenever the dates change.
  useEffect(() => {
    if (!range || !key) return;
    for (const piece of pieces) {
      if (!piece.variant || piece.checkedFor === key) continue;
      const variantId = piece.variant.variant_id;
      const flight = `check:${piece.key}:${variantId}:${key}`;
      if (inFlight.current.has(flight)) continue;
      inFlight.current.add(flight);
      getAvailability(slug, variantId, range.start, range.end)
        .then((result) => {
          const free = result.days.length > 0 && result.days.every((day) => day.state === 'available');
          onChange((current) =>
            current.map((entry) =>
              entry.key === piece.key && entry.variant?.variant_id === variantId ? { ...entry, free, checkedFor: key, error: null } : entry,
            ),
          );
        })
        .catch(() =>
          onChange((current) =>
            current.map((entry) =>
              entry.key === piece.key && entry.variant?.variant_id === variantId
                ? { ...entry, checkedFor: key, error: `Could not check ${piece.name} for your dates.` }
                : entry,
            ),
          ),
        )
        .finally(() => inFlight.current.delete(flight));
    }
  }, [key, onChange, pieces, range, slug]);

  const full = pieces.length + 1 >= MAX_PIECES_PER_BOOKING;
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">Add another piece for the same dates</h4>
        <p className="mt-1 text-xs text-sf-muted">Book a gown for a sister, a parent, or the entourage in the same request.</p>
      </div>

      {pieces.map((piece) => (
        <div key={piece.key} className="border border-sf-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {piece.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={piece.imageUrl} alt="" className="h-14 w-11 shrink-0 object-cover" />
              ) : null}
              <p className="truncate text-sm font-medium">{piece.name}</p>
            </div>
            <button
              type="button"
              aria-label={`Remove ${piece.name}`}
              onClick={() => onChange((current) => current.filter((entry) => entry.key !== piece.key))}
              className="-mr-1 flex h-9 w-9 items-center justify-center text-xl leading-none text-sf-muted hover:text-sf-ink"
            >
              ×
            </button>
          </div>
          {piece.item && piece.item.variants.length > 1 ? (
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={`${piece.name} size`}>
              {piece.item.variants.map((variant) => {
                const checked = piece.variant?.variant_id === variant.variant_id;
                return (
                  <button
                    key={variant.variant_id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() =>
                      onChange((current) =>
                        current.map((entry) => (entry.key === piece.key ? { ...entry, variant, free: null, checkedFor: null, error: null } : entry)),
                      )
                    }
                    className={`min-h-10 border px-3 text-sm ${checked ? 'border-sf-ink bg-sf-ink text-sf-bg' : 'border-sf-line hover:border-sf-ink'}`}
                  >
                    {variant.size_label ?? 'One size'}
                  </button>
                );
              })}
            </div>
          ) : null}
          <PieceStatus piece={piece} rangeKeyValue={key} />
        </div>
      ))}

      {picking ? (
        <div className="border border-sf-line p-3">
          {cards === null ? (
            <p className="text-sm text-sf-muted">Loading the collection…</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-sf-muted">No other pieces to add right now.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cards.map((card) => (
                <li key={card.product_id}>
                  <button
                    type="button"
                    aria-label={`Add ${card.name}`}
                    onClick={() => {
                      onChange((current) => [
                        ...current,
                        {
                          key: `${card.product_id}-${current.length}-${Date.now()}`,
                          productId: card.product_id,
                          name: card.name,
                          imageUrl: card.image_url,
                          item: null,
                          variant: null,
                          free: null,
                          checkedFor: null,
                          error: null,
                        },
                      ]);
                      setPicking(false);
                    }}
                    className="block w-full text-left"
                  >
                    {card.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                      <img src={card.image_url} alt="" className="aspect-[3/4] w-full object-cover" />
                    ) : (
                      <span className="block aspect-[3/4] w-full bg-sf-line" />
                    )}
                    <span className="mt-1 block truncate text-xs font-medium">{card.name}</span>
                    <span className="block text-xs text-sf-muted">from {formatMinor(card.price_from_minor)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="sf-button sf-button-outline mt-3 w-full" onClick={() => setPicking(false)}>
            Close
          </button>
        </div>
      ) : (
        <button type="button" className="sf-button sf-button-outline w-full" disabled={full || !range} onClick={() => setPicking(true)}>
          {full ? `Up to ${MAX_PIECES_PER_BOOKING} pieces per booking` : '+ Add another piece'}
        </button>
      )}
    </div>
  );
}

function PieceStatus({ piece, rangeKeyValue }: { piece: ExtraPiece; rangeKeyValue: string | null }) {
  const text = piece.error
    ? piece.error
    : !piece.item
      ? 'Loading sizes…'
      : !piece.variant
        ? 'Choose a size.'
        : piece.checkedFor !== rangeKeyValue || piece.free === null
          ? 'Checking your dates…'
          : piece.free
            ? 'Free for your dates.'
            : 'Not free for your dates. Remove it or choose another size.';
  const tone = piece.error || piece.free === false ? 'text-[#b3311f]' : 'text-sf-muted';
  return <p className={`mt-2 text-xs ${tone}`}>{text}</p>;
}
