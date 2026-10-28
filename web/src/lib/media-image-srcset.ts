const IMAGE_WIDTHS = [320, 960, 1600] as const;

/** Adds responsive candidates only to same-origin application media URLs. */
export function mediaImageSrcSet(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  try {
    const url = new URL(source, 'https://drezivo.invalid');
    if (url.origin !== 'https://drezivo.invalid' ||
      (!url.pathname.startsWith('/api/media/') && !/^\/s\/[a-z0-9-]+\/media\/preview\/[0-9a-f-]{36}$/i.test(url.pathname))) {
      return undefined;
    }
    return IMAGE_WIDTHS.map((width) => {
      const candidate = new URL(url);
      candidate.searchParams.set('w', String(width));
      return `${candidate.pathname}${candidate.search}${candidate.hash} ${width}w`;
    }).join(', ');
  } catch {
    return undefined;
  }
}
