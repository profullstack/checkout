// The stylesheet and the single-file browser script, ready to serve from a
// site without a bundler. Node-only (reads the package's own files), so it is
// its own entry.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

let cached = null

function asset(relative, type) {
  const body = readFileSync(new URL(relative, import.meta.url))
  // A content hash for long-lived caching: /assets/checkout.<hash>.css
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12)
  return { body, type, hash }
}

/**
 * { css: { body, type, hash }, js: { body, type, hash } }
 *
 *   const { css, js } = assets()
 *   GET /assets/checkout.css -> css.body, 'content-type': css.type
 *   <link rel="stylesheet" href="/assets/checkout.css?v=${css.hash}">
 *   <script type="module" src="/assets/checkout.js?v=${js.hash}"></script>
 */
export function assets() {
  cached ??= {
    css: asset('../checkout.css', 'text/css; charset=utf-8'),
    js: asset('../dist/browser.js', 'text/javascript; charset=utf-8'),
  }
  return cached
}
