/** Keeps the store's header and footer in place while the next storefront page loads. */
export default function StorefrontLoading() {
  return (
    <div className="mx-auto max-w-7xl px-5 pb-8 pt-12 sm:px-8 sm:pt-16" aria-busy="true" aria-label="Loading">
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="h-12 w-72 max-w-full bg-sf-line" />
        <div className="mt-4 h-4 w-96 max-w-full bg-sf-line/70" />
        <div className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="aspect-[3/4] bg-sf-line" />
          ))}
        </div>
      </div>
    </div>
  );
}
