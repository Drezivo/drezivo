import Link from 'next/link';

/**
 * Page links for the storefront collection. A shop with many garments has many pages, and one
 * link per page in a single row ran past the right edge of a phone and made the whole storefront
 * scroll sideways. Phones get Previous / "Page 3 of 12" / Next; wider screens add a short run of
 * page numbers around the current one, with the first and last page always reachable.
 */
export function CatalogPagination({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  const current = Math.min(Math.max(1, page), pages);

  return (
    <nav aria-label="Pages" className="mt-14 flex items-center justify-center gap-2 text-sm">
      <StepLink label="Previous page" glyph="‹" href={current > 1 ? hrefFor(current - 1) : null} />
      <p className="px-3 tabular-nums text-sf-muted sm:hidden" aria-current="page">
        Page {current} of {pages}
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
        {pageWindow(current, pages).map((entry, index) =>
          entry === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-sf-muted">
              …
            </li>
          ) : (
            <li key={entry}>
              <Link
                href={hrefFor(entry)}
                aria-current={entry === current ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                className={`flex h-10 min-w-10 items-center justify-center border px-3 tabular-nums ${entry === current ? 'border-sf-ink' : 'border-transparent text-sf-muted hover:text-sf-ink'}`}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
      </ol>
      <StepLink label="Next page" glyph="›" href={current < pages ? hrefFor(current + 1) : null} />
    </nav>
  );
}

function StepLink({ label, glyph, href }: { label: string; glyph: string; href: string | null }) {
  const box = 'flex h-10 min-w-10 items-center justify-center border text-lg';
  if (!href) {
    return (
      <span aria-hidden="true" className={`${box} border-transparent text-sf-muted opacity-40`}>
        {glyph}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={`${box} border-sf-line hover:border-sf-ink`}>
      {glyph}
    </Link>
  );
}

/**
 * The page numbers to show: the first, the last, and the current page with one neighbour on each
 * side, with 'gap' where pages are skipped. At most seven entries, so the row stays narrow.
 */
export function pageWindow(current: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const shown = new Set([1, pages, current - 1, current, current + 1]);
  // Near either end, show enough pages that the window does not shrink to three numbers.
  if (current <= 3) [2, 3, 4].forEach((value) => shown.add(value));
  if (current >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((value) => shown.add(value));
  const sorted = [...shown].filter((value) => value >= 1 && value <= pages).sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === 'number' && value - previous > 1) {
      // A single skipped page is shown as its number; a "…" there would hide nothing.
      if (value - previous === 2) result.push(previous + 1);
      else result.push('gap');
    }
    result.push(value);
  }
  return result;
}
