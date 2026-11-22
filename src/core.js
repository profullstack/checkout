// Pure pricing and view logic. No node: imports and no DOM here: this file is
// shared by the server handler, the HTML renderer, the React component and the
// browser script, so it must load in every runtime.

export const ERRORS = {
  invalid_option: 'Pick one of the listed options.',
  invalid_quantity: 'That number of seats is outside what we can sell here.',
  invalid_amount: 'Enter an amount inside the allowed range.',
  invalid_code: 'That discount code is not valid.',
  email_required: 'Enter the email this purchase is for.',
  sign_in_required: 'Sign in to continue.',
  payment_unavailable: 'We could not open the payment page. Nothing was charged; try again.',
  bad_origin: 'This form was sent from another site.',
}

const CUSTOM = 'custom'

/** USD (number or numeric string) to integer cents. Throws on junk. */
export function toCents(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value)
  if (value === '' || value == null || !Number.isFinite(n) || n < 0) throw new TypeError(`not a money amount: ${value}`)
  return Math.round(n * 100)
}

/** Integer cents to "USD 15.00" (or "$15" with { short: true }). */
export function money(cents, { currency = 'USD', short = false } = {}) {
  const whole = Math.trunc(cents / 100)
  const frac = String(Math.abs(cents % 100)).padStart(2, '0')
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (short) return `${currency === 'USD' ? '$' : `${currency} `}${grouped}${frac === '00' ? '' : `.${frac}`}`
  return `${currency} ${grouped}.${frac}`
}

function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function seatRule(seats) {
  if (!seats) return null
  const min = Math.max(1, Number.parseInt(seats.min ?? 1, 10))
  const max = Math.max(min, Number.parseInt(seats.max ?? 500, 10))
  const fallback = clampInt(seats.default ?? min, { min, max, fallback: min })
  return { min, max, default: fallback, label: String(seats.label || 'Seats') }
}

/**
 * Validate a config once and turn every price into cents.
 * An option is a plan ({ monthly, months }) or a one-off ({ price }).
 */
export function normalize(config) {
  if (!config || typeof config !== 'object') throw new TypeError('createCheckout needs a config object')
  const currency = config.currency || 'USD'
  const raw = config.options || config.plans || []
  if (!raw.length && !config.custom) throw new TypeError('checkout needs at least one option or a custom amount')

  const seen = new Set()
  const options = raw.map((o) => {
    const id = String(o.id ?? '')
    if (!id || id === CUSTOM) throw new TypeError(`option id "${id}" is missing or reserved`)
    if (seen.has(id)) throw new TypeError(`duplicate option id "${id}"`)
    seen.add(id)
    // A plan is priced per month ({ monthly, months }) or by its term total
    // ({ price, months }). The total form is exact for prices that do not
    // divide into whole cents: $50 a year is charged as $50.00, shown as $4.17/mo.
    const plan = o.monthly != null || (o.months != null && Number(o.months) > 0)
    const months = plan ? Math.max(1, Number.parseInt(o.months ?? 1, 10)) : 0
    if (o.monthly != null && o.price != null) throw new TypeError(`option "${id}": give monthly or price, not both`)
    const totalCents = plan && o.monthly == null ? toCents(o.price) : null
    const unitCents = totalCents != null ? Math.round(totalCents / months) : toCents(plan ? o.monthly : o.price)
    return {
      id,
      name: String(o.name ?? id),
      detail: o.detail != null ? String(o.detail) : '',
      kind: plan ? 'plan' : 'once',
      unitCents,
      months,
      // What one unit of quantity costs today.
      chargeCents: totalCents != null ? totalCents : plan ? unitCents * months : unitCents,
      gets: o.gets != null ? String(o.gets) : '',
      badges: (o.badges || []).map(String),
      popular: Boolean(o.popular),
      // Preselected without the "Most popular" badge.
      default: Boolean(o.default),
      // 'total' leads with the term total ("USD 15.00 / 12 months") instead of the per-month price.
      display: o.display === 'total' ? 'total' : 'monthly',
      meta: o.meta && typeof o.meta === 'object' ? o.meta : undefined,
    }
  })

  // "Save 50%" is computed from the real prices, never typed by hand.
  // Compared on exact cost per month, so a rounded display price cannot skew it.
  const perMonth = (o) => o.chargeCents / o.months
  const dearest = Math.max(0, ...options.filter((o) => o.kind === 'plan').map(perMonth))
  for (const o of options) {
    o.savePercent = o.kind === 'plan' && dearest > perMonth(o) ? Math.round((1 - perMonth(o) / dearest) * 100) : 0
    if (o.kind === 'plan' && !o.detail) {
      if (o.display === 'total') o.detail = o.months === 1 ? '' : `${money(o.unitCents, { currency })} a month`
      else o.detail = o.months === 1 ? 'Billed for 1 month' : `Billed ${money(o.chargeCents, { currency })} for ${o.months} months`
    }
  }

  let custom = null
  if (config.custom) {
    const minCents = toCents(config.custom.min ?? 1)
    const maxCents = Math.max(minCents, toCents(config.custom.max ?? 10000))
    // default: null leaves the field empty until the buyer types.
    const blank = config.custom.default === null
    const defaultCents = blank ? minCents : Math.min(maxCents, Math.max(minCents, toCents(config.custom.default ?? config.custom.min ?? 1)))
    custom = {
      id: CUSTOM,
      name: String(config.custom.label || 'Other amount'),
      detail: String(config.custom.detail || `${money(minCents, { currency, short: true })} to ${money(maxCents, { currency, short: true })}`),
      minCents,
      maxCents,
      defaultCents,
      blank,
    }
  }

  const audiences = (config.audiences || []).map((a) => {
    const id = String(a.id ?? '')
    if (!id) throw new TypeError('audience needs an id')
    return { id, label: String(a.label ?? id), seats: seatRule(a.seats) }
  })

  const compare = config.compare
    ? {
        title: String(config.compare.title || 'Compare the cost yourself'),
        unit: String(config.compare.unit ?? ''),
        items: (config.compare.items || []).map((i) => ({ label: String(i.label), cents: toCents(i.price) })),
        ours: config.compare.ours ? { label: String(config.compare.ours.label), cents: toCents(config.compare.ours.price) } : null,
        heading: config.compare.heading ? String(config.compare.heading) : '',
        body: config.compare.body ? String(config.compare.body) : '',
        footnote: config.compare.footnote ? String(config.compare.footnote) : '',
      }
    : null
  if (compare) compare.totalCents = compare.items.reduce((sum, i) => sum + i.cents, 0)

  return {
    site: String(config.site || ''),
    currency,
    title: String(config.title || 'Checkout'),
    subtitle: config.subtitle ? String(config.subtitle) : '',
    logo: config.logo ? { src: String(config.logo.src || config.logo), alt: String(config.logo.alt || '') } : null,
    audienceLabel: String(config.audienceLabel || 'Who is this for?'),
    optionsLabel: String(config.optionsLabel || (options.some((o) => o.kind === 'plan') ? 'Plan' : 'Amount')),
    audiences,
    seats: seatRule(config.seats),
    options,
    custom,
    hasDiscount: typeof config.discount === 'function',
    discountLabel: String(config.discountLabel || 'Have a discount code?'),
    cta: String(config.cta || 'Continue to payment'),
    guarantee: config.guarantee ? String(config.guarantee) : '',
    // processor: false drops the line (for a site where "or PayPal" is not always true).
    processor: config.processor === false ? '' : String(config.processor ?? 'Pay with crypto or PayPal. Payment is processed by CoinPay.'),
    compare,
    requireAccount: Boolean(config.requireAccount),
    theme: config.theme === 'light' || config.theme === 'dark' ? config.theme : '',
    // The site's own error messages, by code. pay() throws { code } to use one.
    errors: { ...ERRORS, ...Object.fromEntries(Object.entries(config.errors || {}).filter(([k]) => /^[a-z0-9_]{1,40}$/.test(k)).map(([k, v]) => [k, String(v)])) },
  }
}

/** Read any of URLSearchParams, FormData, a plain object or a query string. */
export function fields(input) {
  if (!input) return {}
  if (typeof input === 'string') input = new URLSearchParams(input.replace(/^\?/, ''))
  const out = {}
  if (typeof input.entries === 'function' && typeof input.get === 'function') {
    for (const [k, v] of input.entries()) if (typeof v === 'string' && !(k in out)) out[k] = v
    return out
  }
  for (const [k, v] of Object.entries(input)) {
    const one = Array.isArray(v) ? v[0] : v
    if (one != null) out[k] = String(one)
  }
  return out
}

/**
 * Turn raw fields (a prefilled link or a posted form) into a selection.
 * `strict` is for the POST: bad input is an error code. Without it (rendering
 * a prefilled link) bad input falls back to the defaults, because a stale
 * link should still open a working page.
 *
 * Link parameters: option (or plan), quantity, audience (or manage), amount,
 * code, email, source.
 */
export function select(cfg, input, { strict = false } = {}) {
  const f = fields(input)
  const fail = (code) => ({ error: code })

  const wanted = f.option ?? f.plan
  let option = cfg.options.find((o) => o.id === wanted) || (wanted === CUSTOM && cfg.custom) || null
  if (!option) {
    if (strict) return fail('invalid_option')
    option = cfg.options.find((o) => o.default) || cfg.options.find((o) => o.popular) || cfg.options[0] || cfg.custom
  }

  const wantedAudience = f.audience ?? f.manage
  let audience = cfg.audiences.find((a) => a.id === wantedAudience) || null
  if (!audience && cfg.audiences.length) {
    if (strict && wantedAudience != null && wantedAudience !== '') return fail('invalid_quantity')
    // A link that carries a quantity above one means the seat-taking audience.
    const many = Number.parseInt(f.quantity, 10) > 1
    audience = (many && cfg.audiences.find((a) => a.seats)) || cfg.audiences[0]
  }

  const rule = audience ? audience.seats : cfg.seats
  let quantity = 1
  if (rule) {
    const asked = f.quantity == null || f.quantity === '' ? rule.default : Number.parseInt(f.quantity, 10)
    if (strict && (!Number.isFinite(asked) || asked < rule.min || asked > rule.max)) return fail('invalid_quantity')
    quantity = clampInt(asked, { ...rule, fallback: rule.default })
  }

  let amountCents = null
  if (option.id === CUSTOM) {
    let cents
    try {
      cents = toCents(f.amount)
    } catch {
      cents = NaN
    }
    if (!Number.isFinite(cents) || cents < option.minCents || cents > option.maxCents) {
      if (strict) return fail('invalid_amount')
      cents = Number.isFinite(cents) ? Math.min(option.maxCents, Math.max(option.minCents, cents)) : option.defaultCents
    }
    amountCents = cents
  }

  return {
    option,
    audience,
    quantity,
    amountCents,
    code: (f.code || '').trim().slice(0, 64),
    email: (f.email || '').trim().slice(0, 254),
    source: (f.source || '').trim().slice(0, 64),
  }
}

/** Price a selection. `discount` is what the site's discount() returned. */
export function quote(cfg, selection, discount = null) {
  const { option, quantity } = selection
  const unit = option.id === CUSTOM ? selection.amountCents : option.chargeCents
  const subtotalCents = unit * quantity
  let offCents = 0
  if (discount) {
    if (discount.percent != null) offCents = Math.round((subtotalCents * Math.min(100, Math.max(0, Number(discount.percent)))) / 100)
    else if (discount.amount != null) offCents = toCents(discount.amount)
    offCents = Math.min(subtotalCents, Math.max(0, offCents))
  }
  const totalCents = subtotalCents - offCents
  const parts = []
  if (quantity > 1) parts.push(`${quantity} seats`)
  if (option.kind === 'plan') parts.push(option.months === 1 ? '1 month' : `${option.months} months`)
  return {
    currency: cfg.currency,
    unitCents: unit,
    subtotalCents,
    discountCents: offCents,
    discountLabel: discount ? String(discount.label || (discount.percent != null ? `${discount.percent}% off` : 'Discount')) : '',
    discountPercent: discount && discount.percent != null ? Math.min(100, Math.max(0, Number(discount.percent))) : null,
    totalCents,
    total: money(totalCents, { currency: cfg.currency }),
    breakdown: parts.join(' x '),
  }
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')
}

/**
 * Everything a renderer needs, as plain JSON: safe to pass from a server
 * component to a client one, or to embed in the page for the browser script.
 */
export function view(cfg, { query, account = null, action = '', error = '', notes = [], closed = '' } = {}) {
  const f = fields(query)
  const sel = select(cfg, f)
  const q = quote(cfg, sel)
  const code = error || f.error || ''
  const known = Object.hasOwn(cfg.errors, code)
  return {
    site: cfg.site,
    action,
    currency: cfg.currency,
    title: cfg.title,
    subtitle: cfg.subtitle,
    logo: cfg.logo,
    theme: cfg.theme,
    error: known ? { code, message: cfg.errors[code] } : null,
    // Per-request lines under the button: a balance, a reminder. Plain text.
    notes: (Array.isArray(notes) ? notes : [notes]).filter(Boolean).map(String),
    // Sales paused: the message shows and the button is off.
    closed: closed ? String(closed) : '',
    // Sign-in is required: no guest email field; the post sends them to sign in and back.
    needsSignIn: cfg.requireAccount && !account,
    // Never render an email from the link for a signed-in person: the account
    // is the truth, the link is only a hint for guests.
    account: account ? { email: account.email || '' } : null,
    email: account ? '' : sel.email,
    source: sel.source,
    audienceLabel: cfg.audienceLabel,
    audiences: cfg.audiences,
    audience: sel.audience ? sel.audience.id : '',
    seats: sel.audience ? sel.audience.seats : cfg.seats,
    anySeats: Boolean(cfg.seats || cfg.audiences.some((a) => a.seats)),
    quantity: sel.quantity,
    optionsLabel: cfg.optionsLabel,
    options: cfg.options.map((o) => ({
      id: o.id,
      name: o.name,
      detail: o.detail,
      kind: o.kind,
      // A pack named "$25" already says its price; do not print it twice.
      price:
        o.kind === 'once' && o.name.trim() === money(o.unitCents, { currency: cfg.currency, short: true })
          ? ''
          : money(o.kind === 'plan' && o.display === 'total' ? o.chargeCents : o.unitCents, { currency: cfg.currency }),
      unit: o.kind !== 'plan' ? '' : o.display === 'total' ? (o.months === 1 ? '/ 1 month' : `/ ${o.months} months`) : '/mo',
      chargeCents: o.chargeCents,
      months: o.months,
      gets: o.gets,
      badges: [
        ...(o.savePercent ? [{ tone: 'save', text: `Save ${o.savePercent}%` }] : []),
        ...(o.popular ? [{ tone: 'popular', text: 'Most popular' }] : []),
        ...o.badges.map((text) => ({ tone: 'note', text })),
      ],
    })),
    custom: cfg.custom
      ? { ...cfg.custom, amount: sel.amountCents == null && cfg.custom.blank ? '' : ((sel.amountCents ?? cfg.custom.defaultCents) / 100).toFixed(2).replace(/\.00$/, '') }
      : null,
    selected: sel.option.id,
    hasDiscount: cfg.hasDiscount,
    discountLabel: cfg.discountLabel,
    code: sel.code,
    total: q.total,
    breakdown: q.breakdown,
    cta: cfg.cta,
    guarantee: cfg.guarantee,
    processor: cfg.processor,
    compare: cfg.compare
      ? {
          title: cfg.compare.title,
          items: cfg.compare.items.map((i, n) => ({ label: i.label, price: `${n ? '+ ' : ''}${money(i.cents, { currency: cfg.currency, short: true })}${cfg.compare.unit}` })),
          total: `= ${money(cfg.compare.totalCents, { currency: cfg.currency, short: true })}${cfg.compare.unit}`,
          ours: cfg.compare.ours ? { label: cfg.compare.ours.label, price: `${money(cfg.compare.ours.cents, { currency: cfg.currency, short: true })}${cfg.compare.unit}` } : null,
          heading: cfg.compare.heading,
          body: cfg.compare.body,
          footnote: cfg.compare.footnote,
        }
      : null,
  }
}
