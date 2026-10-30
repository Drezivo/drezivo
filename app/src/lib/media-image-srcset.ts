/** Staff media requires auth headers, so native <img srcSet> URLs must not be generated. */
export function mediaImageSrcSet(_source: string | null | undefined): undefined {
  return undefined;
}
