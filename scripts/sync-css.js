// checkout.css is the source; src/css.js is the same text as a module, for
// sites that inline it. Run after editing the stylesheet: `npm run css`.
import { readFileSync, writeFileSync } from 'node:fs'

const css = readFileSync(new URL('../checkout.css', import.meta.url), 'utf8')
writeFileSync(new URL('../src/css.js', import.meta.url), `// Generated from checkout.css by scripts/sync-css.js. Do not edit.\nexport const css = ${JSON.stringify(css)}\n`)
