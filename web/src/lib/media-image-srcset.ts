const IMAGE_WIDTHS = [320, 960, 1600] as const;

/** Adds responsive candidates to public API-host media URLs. */
export function mediaImageSrcSet(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  try {
    const url = new URL(source);
    const apiOrigin = process.env['NEXT_PUBLIC_API_ORIGIN'];
    if (!apiOrigin || url.origin !== new URL(apiOrigin).origin ||
      !/^\/api\/media\/public\/stores\/[a-z0-9-]{1,80}\/files\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      return undefined;
    }
    return IMAGE_WIDTHS.map((width) => {
      const candidate = new URL(url);
      candidate.searchParams.set('w', String(width));
      return `${candidate.toString()} ${width}w`;
    }).join(', ');
  } catch {
    return undefined;
  }
}
