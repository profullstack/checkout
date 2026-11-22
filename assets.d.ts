export interface Asset {
  body: Buffer
  /** The content-type to serve it with. */
  type: string
  /** A short content hash, for cache-busting URLs. */
  hash: string
}

/** The stylesheet and the single-file browser script, read from the package. */
export function assets(): { css: Asset; js: Asset }
