import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { coinpay, createCheckout, css, money, readOrder, toCents } from '../src/index.js'
import { Checkout } from '../src/react.js'

const plans = (extra = {}) =>
  createCheckout({
    site: 'example.com',
    title: 'Get Example Pro',
    subtitle: 'Pick a plan.',
    audiences: [
      { id: 'personal', label: 'Myself only' },
      { id: 'team', label: 'My team', seats: { min: 2, max: 50, default: 3 } },
    ],
    options: [
      { id: 'year', name: '1-Year Plan', monthly: 15, months: 12, popular: true },
      { id: 'month', name: '1-Month Plan', monthly: 30, months: 1 },
    ],
    compare: { unit: '/y', items: [{ label: 'A', price: 48 }, { label: 'B', price: 120 }], ours: { label: 'Us', price: 180 } },
    pay: async (order) => ({ url: `https://pay.test/${order.totalCents}` }),
    ...extra,
  })

const post = (body, headers = {}) =>
  new Request('https://example.com/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'https://example.com/checkout?x=1', ...headers },
    body: new URLSearchParams(body).toString(),
  })

test('money is integer cents', () => {
  assert.equal(toCents('19.99'), 1999)
  assert.equal(toCents(0.07), 7)
  assert.equal(money(154000), 'USD 1,540.00')
  assert.equal(money(32100, { short: true }), '$321')
  assert.throws(() => toCents('abc'))
  assert.throws(() => toCents(''))
})

test('the popular plan is preselected and the saving is computed', () => {
  const html = plans().html()
  assert.match(html, /value="year" checked/)
  assert.match(html, /Save 50%/)
  assert.match(html, /Most popular/)
  assert.match(html, /USD 15\.00/)
  assert.match(html, /Billed USD 180\.00 for 12 months/)
  assert.match(html, /= \$168\/y/)
  assert.match(html, /\$180\/y/)
})

test('a link prefills plan, seats, audience and email', () => {
  const c = plans()
  const v = c.view({ query: '?plan=month&quantity=3&manage=team&email=a%40b.co&source=billing' })
  assert.equal(v.selected, 'month')
  assert.equal(v.audience, 'team')
  assert.equal(v.quantity, 3)
  assert.equal(v.email, 'a@b.co')
  assert.equal(v.total, 'USD 90.00')
  // quantity alone picks the audience that takes seats
  assert.equal(c.view({ query: 'quantity=4' }).audience, 'team')
  // a stale link still renders
  assert.equal(c.view({ query: 'plan=gone&quantity=9999&manage=nope' }).selected, 'year')
})

test('a signed-in account beats the email in the link', () => {
  const html = plans().html({ query: 'email=evil%40x.co', account: { email: 'me@example.com' } })
  assert.match(html, /me@example\.com/)
  assert.doesNotMatch(html, /evil/)
  assert.doesNotMatch(html, /name="email"/)
})

test('output is escaped', () => {
  const html = plans({ title: '<script>x</script>' }).html({ query: { email: '"><img src=x>' } })
  assert.doesNotMatch(html, /<script>x/)
  assert.doesNotMatch(html, /<img src=x>/)
})

test('a plain form post prices on the server and 303s to payment', async () => {
  const res = await plans().POST(post({ option: 'year', audience: 'team', quantity: '3', email: 'a@b.co' }))
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), 'https://pay.test/54000')
})

test('personal ignores a smuggled quantity', async () => {
  const r = await plans().handle({ option: 'month', audience: 'personal', quantity: '40', email: 'a@b.co' })
  assert.equal(r.order.quantity, 1)
  assert.equal(r.order.totalCents, 3000)
})

test('bad input goes back with an error code, never free text', async () => {
  const c = plans()
  let res = await c.POST(post({ option: 'nope', email: 'a@b.co' }))
  assert.equal(res.status, 303)
  assert.match(res.headers.get('location'), /^\/checkout\?.*error=invalid_option/)
  res = await c.POST(post({ option: 'year', audience: 'team', quantity: '999', email: 'a@b.co' }))
  assert.match(res.headers.get('location'), /error=invalid_quantity/)
  res = await c.POST(post({ option: 'year' }))
  assert.match(res.headers.get('location'), /error=email_required/)
  assert.match(c.html({ query: 'error=email_required' }), /role="alert"/)
  assert.doesNotMatch(c.html({ query: 'error=<b>hi</b>' }), /role="alert"/)
})

test('a post from another site is refused', async () => {
  const c = plans()
  const res = await c.POST(post({ option: 'year', email: 'a@b.co' }, { origin: 'https://evil.test', accept: 'application/json' }))
  assert.equal(res.status, 403)
  const ok = await c.POST(post({ option: 'year', email: 'a@b.co' }, { origin: 'https://example.com' }))
  assert.equal(ok.status, 303)
  const nul = await c.POST(post({ option: 'year', email: 'a@b.co' }, { origin: 'null' }))
  assert.equal(nul.status, 303)
})

test('discount codes are checked on the server', async () => {
  const c = plans({ discount: (code) => (code === 'HALF' ? { percent: 50 } : code === 'FREE' ? { percent: 100 } : null), free: async () => ({ url: '/granted' }) })
  assert.match(c.html(), /Have a discount code\?/)
  const good = await c.handle({ option: 'year', audience: 'personal', email: 'a@b.co', code: 'HALF' })
  assert.equal(good.order.totalCents, 9000)
  assert.equal(good.order.code, 'HALF')
  const bad = await c.handle({ option: 'year', audience: 'personal', email: 'a@b.co', code: 'NOPE' })
  assert.deepEqual(bad, { ok: false, error: 'invalid_code' })
  const q = await c.quote({ option: 'year', audience: 'personal', code: 'HALF' })
  assert.equal(q.quote.discountPercent, 50)
  assert.equal(q.quote.total, 'USD 90.00')
  const free = await c.handle({ option: 'year', audience: 'personal', email: 'a@b.co', code: 'FREE' })
  assert.equal(free.url, '/granted')
})

test('accounts: signed-in wins, guests need an email, requireAccount sends to sign-in', async () => {
  const signed = plans({ account: async () => ({ id: 42, email: 'me@example.com' }) })
  const r = await signed.handle({ option: 'month', audience: 'personal', email: 'other@x.co' })
  assert.equal(r.order.account.id, '42')
  assert.equal(r.order.account.email, 'me@example.com')

  const gated = plans({ requireAccount: true, signIn: '/login', page: '/checkout' })
  const res = await gated.POST(post({ option: 'year', audience: 'team', quantity: '3' }))
  assert.equal(res.status, 303)
  const loc = res.headers.get('location')
  assert.match(loc, /^\/login\?next=/)
  assert.match(decodeURIComponent(loc), /\/checkout\?option=year&quantity=3&audience=team/)
})

test('a failing pay() is payment_unavailable, with JSON for fetch callers', async () => {
  const errors = []
  const c = plans({ pay: async () => { throw new Error('boom') }, onError: (e) => errors.push(e.message) })
  const res = await c.POST(post({ option: 'year', email: 'a@b.co' }, { accept: 'application/json' }))
  assert.equal(res.status, 502)
  assert.equal((await res.json()).error, 'payment_unavailable')
  assert.deepEqual(errors, ['boom'])
})

test('top-ups: packs plus a custom amount inside its range', async () => {
  const c = createCheckout({
    site: 'example.com',
    title: 'Add credit',
    options: [
      { id: '10', name: '$10', price: 10 },
      { id: '25', name: '$25', price: 25, popular: true, gets: 'about 5M tokens' },
    ],
    custom: { min: 5, max: 500, default: 50 },
    pay: async (o) => ({ url: `/pay/${o.totalCents}` }),
  })
  const html = c.html()
  assert.match(html, /value="25" checked/)
  assert.match(html, /name="amount"/)
  assert.match(html, /about 5M tokens/)
  assert.doesNotMatch(html, /Save \d+%/)
  assert.equal((await c.handle({ option: 'custom', amount: '42.50', email: 'a@b.co' })).url, '/pay/4250')
  assert.equal((await c.handle({ option: 'custom', amount: '1', email: 'a@b.co' })).error, 'invalid_amount')
  assert.equal((await c.handle({ option: 'custom', amount: '9999', email: 'a@b.co' })).error, 'invalid_amount')
  assert.equal(c.view({ query: 'option=custom&amount=9999' }).custom.amount, '500')
})

test('coinpay() opens a session and the order survives the metadata round trip', async () => {
  const calls = []
  const pay = coinpay({
    apiKey: () => 'cp_live_x',
    property: 'example.com',
    successUrl: (o) => `https://example.com/done?o=${o.option.id}`,
    metadata: { type: 'topup' },
    fetch: async (url, init) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ success: true, id: 'cs_1', url: 'https://coinpayportal.com/checkout/cs_1' }), { status: 201 })
    },
  })
  const c = plans({ pay })
  const r = await c.handle({ option: 'year', audience: 'team', quantity: '2', email: 'A@b.co', source: 'billing' })
  assert.equal(r.url, 'https://coinpayportal.com/checkout/cs_1')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, 'https://coinpayportal.com/api/checkout/sessions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer cp_live_x')
  assert.equal(body.amount, 360)
  assert.equal(body.customer_email, 'A@b.co')
  assert.equal(body.account_id, 'a@b.co')
  assert.equal(body.property, 'example.com')
  assert.equal(body.success_url, 'https://example.com/done?o=year')
  assert.equal(body.metadata.type, 'topup')
  assert.deepEqual(readOrder(body.metadata), { option: 'year', kind: 'plan', months: 12, quantity: 2, totalCents: 36000, subtotalCents: 36000, audience: 'team', code: '', source: 'billing' })
  assert.equal(readOrder({ something: 'else' }), null)

  const down = coinpay({ apiKey: 'k', fetch: async () => new Response(JSON.stringify({ code: 'NO_PAYMENT_METHODS' }), { status: 400 }) })
  await assert.rejects(() => down(r.order), /HTTP 400 NO_PAYMENT_METHODS/)
})

test('React renders the same page as html()', () => {
  const c = plans({ discount: () => null })
  const v = c.view({ query: 'plan=month&quantity=3&manage=team&email=a%40b.co' })
  const markup = renderToStaticMarkup(createElement(Checkout, { view: v, enhance: false }))
  for (const needle of ['Get Example Pro', 'Save 50%', 'Most popular', 'Continue to payment', 'USD 90.00', 'name="quantity"', 'value="a@b.co"', 'Have a discount code?']) {
    assert.ok(markup.includes(needle), `react markup has ${needle}`)
    assert.ok(c.html({ query: 'plan=month&quantity=3&manage=team&email=a%40b.co' }).includes(needle), `html has ${needle}`)
  }
  assert.match(markup, /value="month"[^>]*checked|checked[^>]*value="month"/)
  assert.match(markup, /<option value="team"[^>]*selected/)
})

test('a pack named for its price shows the price once', () => {
  const c = createCheckout({
    site: 'x',
    options: [
      { id: '25', name: '$25', price: 25, gets: 'about 5,000 chats' },
      { id: 'pro', name: 'Starter pack', price: 25 },
    ],
    pay: async () => ({ url: '/p' }),
  })
  const html = c.html()
  assert.equal(html.match(/USD 25\.00/g).length, 2) // the Starter pack card and the total
  assert.match(html, /about 5,000 chats/)
})

test('behind a proxy: siteUrl names the public origin, and cross-site fetches are refused', async () => {
  const internal = (headers) =>
    new Request('http://10.0.0.5:3000/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: '10.0.0.5:3000', ...headers },
      body: 'option=year&email=a%40b.co',
    })
  const without = await plans().POST(internal({ origin: 'https://example.com', accept: 'application/json' }))
  assert.equal(without.status, 403)
  const withUrl = await plans({ siteUrl: 'https://example.com' }).POST(internal({ origin: 'https://example.com' }))
  assert.equal(withUrl.status, 303)
  const cross = await plans({ siteUrl: 'https://example.com' }).POST(internal({ 'sec-fetch-site': 'cross-site', accept: 'application/json' }))
  assert.equal(cross.status, 403)
})

test('theme defaults carry no specificity, so a plain .pfc rule wins in dark mode too', () => {
  assert.match(css, /:where\(\.pfc\) \{\n {2}--pfc-accent/)
  assert.match(css, /:where\(\.pfc:not\(\[data-theme="light"\]\)\) \{/)
  assert.doesNotMatch(css, /margin: 0 auto/)
})

test('src/css.js matches checkout.css', () => {
  assert.equal(css, readFileSync(new URL('../checkout.css', import.meta.url), 'utf8'))
})

test('config mistakes fail at startup', () => {
  assert.throws(() => createCheckout({ site: 'x', options: [{ id: 'a', price: 1 }] }), /pay/)
  assert.throws(() => createCheckout({ site: 'x', options: [], pay() {} }), /at least one/)
  assert.throws(() => createCheckout({ site: 'x', options: [{ id: 'a', price: 1 }, { id: 'a', price: 2 }], pay() {} }), /duplicate/)
  assert.throws(() => createCheckout({ site: 'x', options: [{ id: 'custom', price: 1 }], pay() {} }), /reserved/)
})
