// @profullstack/checkout: one focused checkout page for plans, credit packs and
// top-ups. The page is prefilled from its link, prices are worked out on the
// server in integer cents, and one button hands off to the payment page.

import { ERRORS, fields, isEmail, money, normalize, quote, select, toCents, view } from './core.js'
import { css } from './css.js'
import { toHtml, tree } from './tree.js'

export { ERRORS, fields, money, quote, select, toCents } from './core.js'
export { css } from './css.js'
export { coinpay, orderMetadata, readOrder } from './coinpay.js'
export { escapeHtml, toHtml, tree } from './tree.js'

function header(request, name) {
  return request && request.headers && typeof request.headers.get === 'function' ? request.headers.get(name) : null
}

/** A form may only be posted from the site it is on. */
function sameSite(request, extra = []) {
  // Browsers say outright when a request comes from another site.
  if (header(request, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request, 'origin')
  // No Origin header (curl, old browsers) and Origin: null (a page with
  // referrerpolicy=no-referrer posts that) say nothing either way, so they pass.
  if (!origin || origin === 'null') return true
  let host
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const here = [header(request, 'x-forwarded-host'), header(request, 'host')]
    .filter(Boolean)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
  try {
    here.push(new URL(request.url).host)
  } catch {
    // request.url may be relative in some runtimes
  }
  for (const o of extra) {
    try {
      here.push(new URL(o).host)
    } catch {
      here.push(String(o))
    }
  }
  return here.includes(host)
}

/** Where to send a failed plain-form post: back to the page it came from. */
function backTo(request, fallback, params) {
  let path = fallback || '/'
  const referer = header(request, 'referer')
  if (referer) {
    try {
      const u = new URL(referer)
      // Path only: never follow a Referer to another host.
      path = u.pathname
    } catch {
      // keep the fallback
    }
  }
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) qs.set(k, String(v))
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${qs.size ? sep + qs.toString() : ''}`
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } })
}

export function createCheckout(config) {
  const cfg = normalize(config)
  if (typeof config.pay !== 'function') throw new TypeError('createCheckout needs pay(order): the function that opens the payment page')

  async function who(request, given) {
    if (given) return given
    if (typeof config.account !== 'function') return null
    const account = await config.account(request)
    return account && account.id != null ? { ...account, id: String(account.id), email: account.email || '' } : null
  }

  /**
   * Validate posted fields, price them and open the payment page.
   * Returns { ok: true, url, order } or { ok: false, error }.
   * With { intent: 'quote' } it stops after pricing.
   */
  async function handle(input, { request = null, account: given = null, intent = '' } = {}) {
    const f = fields(input)
    const sel = select(cfg, f, { strict: true })
    if (sel.error) return { ok: false, error: sel.error }

    let discount = null
    if (sel.code) {
      discount = cfg.hasDiscount ? await config.discount(sel.code, { option: sel.option, quantity: sel.quantity, audience: sel.audience ? sel.audience.id : '' }) : null
      if (!discount) return { ok: false, error: 'invalid_code' }
    }
    const q = quote(cfg, sel, discount)
    if ((intent || f.intent) === 'quote') return { ok: true, quote: q }

    let account = await who(request, given)
    if (!account) {
      if (config.requireAccount) return { ok: false, error: 'sign_in_required' }
      if (!isEmail(sel.email)) return { ok: false, error: 'email_required' }
      // Guest checkout: the email is the account.
      account = { id: sel.email.toLowerCase(), email: sel.email, guest: true }
    }

    const order = {
      site: cfg.site,
      option: { id: sel.option.id, name: sel.option.name, kind: sel.option.kind || 'once', months: sel.option.months || 0, meta: sel.option.meta },
      audience: sel.audience ? sel.audience.id : '',
      quantity: sel.quantity,
      code: discount ? sel.code : '',
      source: sel.source,
      currency: cfg.currency,
      unitCents: q.unitCents,
      subtotalCents: q.subtotalCents,
      discountCents: q.discountCents,
      totalCents: q.totalCents,
      amount: q.totalCents / 100,
      account,
      description: `${cfg.site ? `${cfg.site}: ` : ''}${sel.option.name}${sel.quantity > 1 ? ` x ${sel.quantity}` : ''}`,
    }

    try {
      // A code that takes the price to zero has nothing to pay; the site
      // grants it directly when it has said how.
      const open = order.totalCents === 0 && typeof config.free === 'function' ? config.free : config.pay
      const out = await open(order, { request })
      const url = typeof out === 'string' ? out : out && out.url
      if (!url) throw new Error('pay() returned no url')
      return { ok: true, url, order, id: out && out.id }
    } catch (error) {
      if (typeof config.onError === 'function') config.onError(error, order)
      else console.error(`[checkout] ${cfg.site || 'site'}: pay() failed: ${error instanceof Error ? error.message : error}`)
      return { ok: false, error: 'payment_unavailable' }
    }
  }

  /** The route handler: `export const POST = checkout.POST`. */
  async function POST(request) {
    const type = header(request, 'content-type') || ''
    const wantsJson = type.includes('application/json') || (header(request, 'accept') || '').includes('application/json')
    let input = {}
    try {
      input = type.includes('application/json') ? await request.json() : await request.formData()
    } catch {
      input = {}
    }
    const f = fields(input)
    const fail = (error, status = 400) => {
      if (error === 'sign_in_required' && config.signIn) {
        const next = backTo(request, config.page, { option: f.option, quantity: f.quantity, audience: f.audience, amount: f.amount, code: f.code, source: f.source })
        const signIn = `${config.signIn}${config.signIn.includes('?') ? '&' : '?'}next=${encodeURIComponent(next)}`
        return wantsJson ? json({ ok: false, error, message: ERRORS[error], signIn }, 401) : redirect(signIn)
      }
      if (wantsJson) return json({ ok: false, error, message: ERRORS[error] }, status)
      // Only a code goes back in the URL, never free text.
      return redirect(backTo(request, config.page, { option: f.option, quantity: f.quantity, audience: f.audience, amount: f.amount, code: error === 'invalid_code' ? '' : f.code, source: f.source, error }))
    }

    // siteUrl is the public address: behind a proxy the Host header may be an
    // internal one, and the browser's Origin is the public one.
    if (!sameSite(request, [...(config.origins || []), ...(config.siteUrl ? [config.siteUrl] : [])])) return fail('bad_origin', 403)
    const result = await handle(f, { request })
    if (!result.ok) return fail(result.error, result.error === 'payment_unavailable' ? 502 : 400)
    if (result.quote) return json({ ok: true, quote: result.quote })
    return wantsJson ? json({ ok: true, url: result.url }) : redirect(result.url)
  }

  return {
    config: cfg,
    css,
    /** Plain JSON for the page: pass it to the React component or to html(). */
    view: (opts = {}) => view(cfg, { action: config.action || '', ...opts }),
    /** The whole page section as an HTML string. */
    html: (opts = {}) => toHtml(tree(view(cfg, { action: config.action || '', ...opts }))),
    /** Price fields without opening a payment. */
    quote: (input) => handle(input, { intent: 'quote' }),
    handle,
    POST,
  }
}
