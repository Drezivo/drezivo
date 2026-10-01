/**
 * A shop's rental terms published as pictures of its own policy. Each page is shown at the full
 * reading width so printed text stays legible, never cropped, and opens at full resolution for
 * zooming on a phone.
 */
export function PolicyImages({ urls, shopName }: { urls: readonly string[]; shopName: string }) {
  return (
    <ol className="space-y-8">
      {urls.map((url, index) => {
        const label = urls.length > 1 ? `${shopName} rental terms, page ${index + 1} of ${urls.length}` : `${shopName} rental terms`;
        return (
          <li key={url}>
            <figure>
              {/* Edge to edge on phones (the page gutter is 20px) and the whole page opens full size, so small print can be zoomed. */}
              <a href={url} target="_blank" rel="noopener noreferrer" className="-mx-5 block sm:mx-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the shop's asset host */}
                <img src={url} alt={label} loading={index === 0 ? 'eager' : 'lazy'} className="h-auto w-full border-y border-sf-line bg-white object-contain sm:border" />
              </a>
              <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-sf-muted">
                <span>
                  {urls.length > 1 ? `Page ${index + 1} of ${urls.length}` : 'Rental terms'}
                  <span className="sm:hidden"> · tap the page to zoom</span>
                </span>
                <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-sf-ink">
                  Open full size
                </a>
              </figcaption>
            </figure>
          </li>
        );
      })}
    </ol>
  );
}
