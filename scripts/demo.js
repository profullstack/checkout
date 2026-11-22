// Serve two demo checkouts for a look in a browser: `node scripts/demo.js [port]`.
//   /            plans with seats, a discount code (HALF) and a comparison
//   /topup       credit packs with a custom amount
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

import { createCheckout } from '../src/index.js'

const pay = async (order) => ({ url: `/paid?total=${order.totalCents}` })

const plans = createCheckout({
  site: 'example.com',
  title: 'Get Example Pro',
  subtitle: 'Pick a plan. Cancel anytime.',
  audienceLabel: 'Who are you upgrading?',
  audiences: [
    { id: 'personal', label: 'Myself only' },
    { id: 'team', label: 'My team', seats: { min: 2, max: 100, default: 3 } },
  ],
  options: [
    { id: 'year', name: '1-Year Plan', monthly: 15, months: 12, popular: true },
    { id: 'month', name: '1-Month Plan', monthly: 30, months: 1 },
  ],
  discount: (code) => (code.toUpperCase() === 'HALF' ? { percent: 50 } : null),
  compare: {
    unit: '/y',
    items: [
      { label: 'Tasks: unlimited projects', price: 48 },
      { label: 'Scheduling across calendars', price: 120 },
      { label: 'A modern calendar app', price: 57 },
      { label: 'Calendar automations', price: 96 },
    ],
    ours: { label: 'All of it in one place', price: 180 },
    heading: 'One tool instead of four.',
    body: 'No more switching between apps and no more stack of subscriptions.',
    footnote: 'Prices are the annual offer of comparable tools.',
  },
  pay,
})

const topup = createCheckout({
  site: 'example.com',
  title: 'Add credit',
  subtitle: 'Credit never expires. Unused credit stays on your account.',
  action: '/topup',
  options: [
    { id: '10', name: '$10', price: 10, detail: 'A light month' },
    { id: '25', name: '$25', price: 25, detail: 'Most people start here', popular: true },
    { id: '100', name: '$100', price: 100, detail: 'For heavy use' },
  ],
  custom: { min: 5, max: 5000, default: 50 },
  cta: 'Continue to payment',
  pay,
})

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout demo</title>
<link rel="stylesheet" href="/checkout.css"><style>body{margin:0;font-family:system-ui,sans-serif;background:#fafafa}@media (prefers-color-scheme:dark){body{background:#030712}}</style>
</head><body>${body}<script type="module" src="/src/browser.js"></script></body></html>`

const file = (path) => readFileSync(new URL(`..${path}`, import.meta.url))

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://demo.local')
  const send = (status, type, body, headers = {}) => {
    res.writeHead(status, { 'content-type': type, ...headers })
    res.end(body)
  }
  try {
    if (url.pathname === '/checkout.css') return send(200, 'text/css', file('/checkout.css'))
    if (/^\/src\/[a-z-]+\.js$/.test(url.pathname)) return send(200, 'text/javascript', file(url.pathname))
    if (url.pathname === '/paid') return send(200, 'text/plain', `payment page would open here: ${url.search}`)
    const checkout = url.pathname === '/topup' ? topup : plans
    if (req.method === 'POST') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const out = await checkout.POST(new Request(url, { method: 'POST', headers: req.headers, body: Buffer.concat(chunks) }))
      return send(out.status, out.headers.get('content-type') || 'text/plain', await out.text(), out.headers.get('location') ? { location: out.headers.get('location') } : {})
    }
    return send(200, 'text/html; charset=utf-8', page(checkout.html({ query: url.searchParams })))
  } catch (error) {
    send(500, 'text/plain', String(error))
  }
}).listen(Number(process.argv[2]) || 4173, '127.0.0.1', function () {
  console.log(`http://127.0.0.1:${this.address().port}/  and  /topup`)
})
