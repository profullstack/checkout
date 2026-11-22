// The CoinPay hosted checkout as a pay() function. One session takes any coin
// the business has a wallet for, or PayPal, and the webhook carries the order
// back in its metadata.

const DEFAULT_BASE = 'https://coinpayportal.com'

/** The order as flat strings, the shape payment metadata wants. */
export function orderMetadata(order) {
  const meta = {
    checkout_option: order.option.id,
    checkout_kind: order.option.kind,
    checkout_months: String(order.option.months || 0),
    checkout_quantity: String(order.quantity),
    checkout_total_cents: String(order.totalCents),
    checkout_subtotal_cents: String(order.subtotalCents),
  }
  if (order.audience) meta.checkout_audience = order.audience
  if (order.code) meta.checkout_code = order.code
  if (order.source) meta.checkout_source = order.source
  return meta
}

/** Read an order back out of webhook metadata. Null when it is not ours. */
export function readOrder(metadata) {
  if (!metadata || typeof metadata !== 'object' || !metadata.checkout_option) return null
  const int = (v) => {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return {
    option: String(metadata.checkout_option),
    kind: String(metadata.checkout_kind || 'once'),
    months: int(metadata.checkout_months),
    quantity: Math.max(1, int(metadata.checkout_quantity)),
    totalCents: int(metadata.checkout_total_cents),
    subtotalCents: int(metadata.checkout_subtotal_cents),
    audience: String(metadata.checkout_audience || ''),
    code: String(metadata.checkout_code || ''),
    source: String(metadata.checkout_source || ''),
  }
}

const resolve = (value, order) => (typeof value === 'function' ? value(order) : value)

/**
 * pay() backed by CoinPay checkout sessions.
 *
 *   pay: coinpay({ apiKey: () => process.env.COINPAY_API_KEY, property: 'example.com',
 *                  successUrl: 'https://example.com/billing?paid=1' })
 *
 * `apiKey`, `successUrl`, `cancelUrl` and `metadata` may be functions, so a
 * secret is read when the payment opens and not when the module loads.
 */
export function coinpay({ apiKey, base = DEFAULT_BASE, property, successUrl, cancelUrl, expiresInMinutes, allowedMethods, metadata, fetch: f } = {}) {
  if (!apiKey) throw new TypeError('coinpay() needs apiKey: the business cp_live_ key, or a function returning it')
  return async function pay(order) {
    const key = await resolve(apiKey)
    if (!key) throw new Error('CoinPay api key is not set')
    const body = {
      amount: order.totalCents / 100,
      currency: order.currency || 'USD',
      description: order.description,
      customer_email: order.account.email,
      account_id: order.account.id,
      metadata: { ...orderMetadata(order), ...((await resolve(metadata, order)) || {}) },
    }
    const prop = (await resolve(property, order)) || order.site
    if (prop) body.property = prop
    const success = await resolve(successUrl, order)
    if (success) body.success_url = success
    const cancel = await resolve(cancelUrl, order)
    if (cancel) body.cancel_url = cancel
    if (expiresInMinutes) body.expires_in_minutes = expiresInMinutes
    if (allowedMethods && allowedMethods.length) body.allowed_methods = allowedMethods

    const res = await (f || fetch)(`${String(base).replace(/\/$/, '')}/api/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      // fall through to the status error
    }
    if (!res.ok || !data || !data.url) {
      const why = data && (data.code || data.error || data.message)
      throw new Error(`CoinPay checkout session failed: HTTP ${res.status}${why ? ` ${why}` : ''}`)
    }
    return { url: data.url, id: data.id }
  }
}
