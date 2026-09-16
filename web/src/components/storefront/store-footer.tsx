import type { PublicStoreProjection } from '@drezivo/contracts';

export function StoreFooter({ store }: { store: PublicStoreProjection }) {
  return (
    <footer className="border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="font-display text-lg">{store.displayName}</p>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-primary-foreground/70">
          {store.contactPhone ? <p>{store.contactPhone}</p> : null}
          {store.contactEmail ? <p>{store.contactEmail}</p> : null}
          {store.address ? <p>{store.address}</p> : null}
        </div>
        <p className="mt-8 text-xs text-primary-foreground/50">
          Powered by Drezivo. © {new Date().getFullYear()} {store.displayName}.
        </p>
      </div>
    </footer>
  );
}
