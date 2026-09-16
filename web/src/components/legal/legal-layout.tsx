import Link from 'next/link';

export function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-foreground">
      <div className="mb-10 border-b border-border pb-6">
        <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
          Back to Drezivo
        </Link>
        <h1 className="mt-6 font-display text-4xl tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
      </div>
      <article className="prose prose-neutral max-w-none dark:prose-invert">{children}</article>
    </main>
  );
}
