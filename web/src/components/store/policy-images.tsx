import { StorefrontMediaImage } from '@/components/store/storefront-media-image';
import { mediaImageSrcSet } from '@/lib/media-image-srcset';

/**
 * A shop's rental terms published as uncropped pictures, with full-size links for reading.
 */
export function PolicyImages({ urls, shopName }: { urls: readonly string[]; shopName: string }) {
  return (
    <ol className="space-y-8">
      {urls.map((url, index) => {
        const label = urls.length > 1 ? `${shopName} rental terms, page ${index + 1} of ${urls.length}` : `${shopName} rental terms`;
        return (
          <li key={url}>
            <figure>
              <a href={url} target="_blank" rel="noopener noreferrer" className="block w-fit max-w-full">
                <StorefrontMediaImage src={url} srcSet={mediaImageSrcSet(url)} sizes="(min-width: 1024px) 60vw, 100vw" alt={label} loading={index === 0 ? 'eager' : 'lazy'} className="block h-auto max-h-[65svh] w-auto max-w-full border border-sf-line bg-white object-contain" />
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
