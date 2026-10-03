/**
 * Shown between storefront pages while the next one loads. It sits inside the store layout, so it
 * takes the shop's own colours (--sf-* tokens) rather than the Drezivo landing page's preloader.
 */
export default function StorefrontLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[60svh] flex-col items-center justify-center gap-5 px-5">
      <span aria-hidden="true" className="sf-loader" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
