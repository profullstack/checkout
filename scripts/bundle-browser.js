// dist/browser.js: the browser script as one file with no imports, for sites
// without a bundler (`<script type="module" src="/checkout.js">`). It needs
// only money() from core.js, so the bundle is that function plus browser.js;
// no build tool. Run by `npm run build` and before publish.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const core = read('../src/core.js')
const start = core.indexOf('export function money(')
const end = core.indexOf('\n}\n', start)
if (start < 0 || end < 0) throw new Error('money() not found in src/core.js')
const money = core.slice(start, end + 3).replace('export function', 'function')

const browser = read('../src/browser.js')
const importLine = "import { money } from './core.js'\n"
if (!browser.includes(importLine)) throw new Error('src/browser.js no longer imports only money from core.js: update scripts/bundle-browser.js')

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true })
writeFileSync(new URL('../dist/browser.js', import.meta.url), `// @profullstack/checkout browser script, bundled from src/browser.js. Do not edit.\n${browser.replace(importLine, () => `${money}\n`)}`)
// A function replacer on purpose: money() contains `'$'`, and in a replacement
// STRING `$'` means "the text after the match", which silently corrupts the file.
