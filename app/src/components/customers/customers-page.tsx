export function CustomersPage() {
  return (
    <div className="min-h-[calc(100svh-4.5rem)] overflow-x-hidden bg-dashboard-canvas px-3 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-5">
        <section aria-labelledby="customers-heading">
          <h1 id="customers-heading" className="text-2xl font-bold tracking-tight text-dashboard-navy">
            Customers
          </h1>
          <p className="mt-1 text-sm text-dashboard-muted">
            View customer profiles and their reservation and fitting activity.
          </p>
        </section>
      </div>
    </div>
  );
}
