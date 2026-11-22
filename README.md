# @profullstack/checkout

One focused checkout page for plans, credit packs and top-ups. The buyer lands on a page that is already filled in from its link, sees the best option preselected, and has one button to press.

What the page does:

- **Prefilled from the link.** `?plan=year&quantity=3&manage=team&email=...&source=billing` opens with that plan, three seats and the email in place. A stale link still opens a working page.
- **Who is this for.** An audience select ("Myself only" / "My team"); the seat field shows only for the audience that buys seats.
- **Option cards.** Plans or one-off amounts as a radio group. The popular one is preselected. "Save 50%" is computed from the real prices, never typed.
- **Discount code**, collapsed until asked for, checked on the server.
- **One button**, with the amount due today above it and a short reassurance line below.
- **A comparison panel** beside the form: what the alternatives add up to, and what this costs.

It works as a plain HTML form (a post, then a 303 to the payment page). A small script adds the live total. Prices are integer cents and are worked out on the server; the browser never decides what is charged. Zero dependencies. Payment goes through [CoinPay](https://coinpayportal.com) checkout sessions (any coin the business takes, or PayPal), or through any `pay()` you write.

```sh
npm install @profullstack/checkout
```

## Plans

```js
// lib/checkout.js
import { coinpay, createCheckout } from '@profullstack/checkout'

export const checkout = createCheckout({
  site: 'example.com',
  title: 'Get Example Pro',
  subtitle: 'Pick a plan.',
  action: '/api/checkout',
  page: '/checkout',
  audienceLabel: 'Who are you upgrading?',
  audiences: [
    { id: 'personal', label: 'Myself only' },
    { id: 'team', label: 'My team', seats: { min: 2, max: 100, default: 3 } },
  ],
  options: [
    { id: 'year', name: '1-Year Plan', monthly: 15, months: 12, popular: true },
    { id: 'month', name: '1-Month Plan', monthly: 30, months: 1 },
  ],
  discount: async (code) => (code === 'LAUNCH' ? { percent: 20 } : null),
  compare: {
    unit: '/y',
    items: [
      { label: 'Tool A', price: 48 },
      { label: 'Tool B', price: 120 },
    ],
    ours: { label: 'Both, in one place', price: 180 },
  },
  account: async (request) => getSignedInUser(request), // { id, email } or null
  pay: coinpay({
    apiKey: () => process.env.COINPAY_API_KEY,
    property: 'example.com',
    successUrl: 'https://example.com/billing?paid=1',
    cancelUrl: 'https://example.com/checkout',
  }),
})
```

A plan is `monthly` USD for `months` months, charged once up front: the card shows `USD 15.00 /mo` and "Billed USD 180.00 for 12 months". When the real price is the term total, give that instead: `{ id: 'year', name: 'Yearly', price: 50, months: 12 }` charges exactly USD 50.00 and shows `USD 4.17 /mo`. Only write `guarantee: '30-day money-back guarantee.'` if it is true; there is no default.

## Credits and top-ups

```js
export const topup = createCheckout({
  site: 'example.com',
  title: 'Add credit',
  action: '/api/topup',
  options: [
    { id: '10', name: '$10', price: 10 },
    { id: '25', name: '$25', price: 25, popular: true, gets: 'about 5M tokens' },
    { id: '100', name: '$100', price: 100 },
  ],
  custom: { min: 5, max: 5000, default: 50 }, // "Other amount"
  requireAccount: true,
  signIn: '/login',
  account,
  pay,
})
```

## The page

Next (a server component):

```jsx
import '@profullstack/checkout/checkout.css'
import { Checkout } from '@profullstack/checkout/react'
import { checkout } from '@/lib/checkout'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }) {
  const account = await getSignedInUser()
  return <Checkout view={checkout.view({ query: await searchParams, account })} />
}
```

```js
// app/api/checkout/route.js
import { checkout } from '@/lib/checkout'
export const POST = checkout.POST
```

Anything else (Hono, Express, a static server):

```js
const html = `<link rel="stylesheet" href="/checkout.css">
${checkout.html({ query: url.searchParams, account })}
<script type="module" src="/checkout-browser.js"></script>`
```

`checkout.css` is the stylesheet (also exported as the string `css`), and `@profullstack/checkout/browser` is the script. Without a bundler, serve `@profullstack/checkout/browser.bundle.js` (`node_modules/@profullstack/checkout/dist/browser.js`): the same script as one file with no imports. Leave the script out and the page still sells.

## Link parameters

| Parameter | Does |
| --- | --- |
| `option` or `plan` | preselects that option (`custom` for the typed amount) |
| `quantity` | seats; a number above one also selects the audience that takes seats |
| `audience` or `manage` | preselects the audience |
| `amount` | fills the custom amount |
| `code` | opens the discount field with the code in it |
| `email` | fills the email for a guest; ignored when someone is signed in |
| `source` | passed through to the order and the payment metadata |

The link is a hint. Who is paying comes from `account(request)`, never from the URL.

## After payment

`coinpay()` puts the order in the session metadata, and CoinPay sends it back on the webhook:

```js
import { readOrder } from '@profullstack/checkout'

const order = readOrder(event.data.metadata)
// { option: 'year', kind: 'plan', months: 12, quantity: 3, totalCents: 54000, audience: 'team', code: '', source: 'billing' }
```

Grant what was bought from `order.option` and `order.quantity`, to the `account_id` on the webhook. Verify the webhook signature first (`@profullstack/coinpay-onboard` has `verifyWebhook` and `readWebhook`).

## Rules it keeps

- The form may only be posted from its own site (`origins: [...]` adds more).
- A failed post goes back to the page with `?error=<code>`: a code from a fixed list, never text from the request.
- A signed-in buyer cannot be charged to another email by editing the link or the form.
- `pay()` that throws shows "We could not open the payment page. Nothing was charged." and calls `onError`.
- A code that takes the total to zero calls `free(order)` instead of `pay(order)` when you provide it.

## Without a framework

A plain Node `http` server, or any site without a bundler:

```js
import { assets } from '@profullstack/checkout/assets'
import { nodeHandler } from '@profullstack/checkout/node'

const { css, js } = assets() // { body, type, hash } each
const handle = nodeHandler(checkout)

// GET  /assets/checkout.css  -> css.body with content-type css.type
// GET  /assets/checkout.js   -> js.body  with content-type js.type
// POST /checkout             -> return handle(req, res)   (pass { body } if you already read it)
// GET  /checkout             -> checkout.html({ query, account }) inside your page, with
//   <link rel="stylesheet" href="/assets/checkout.css?v=${css.hash}">
//   <script type="module" src="/assets/checkout.js?v=${js.hash}"></script>
```

Hono, Bun.serve and other web-standard servers use `checkout.POST(request)` directly; `assets()` works there too.

## Smaller options

- `signIn` may be a function `(nextPath) => url` for sites with their own sign-in scheme, and `signInParam: 'return_to'` renames the return parameter.
- `strictOrigin: true` also refuses a post with no `Origin` header or `Origin: null`.

- `default: true` on an option preselects it without the "Most popular" badge (`popular: true` does both).
- `display: 'total'` on a plan leads with the term total (`USD 15.00 / 12 months`, then "USD 1.25 a month") for sites that quote the whole term.
- `theme: 'light'` or `'dark'` pins the colour scheme.
- `errors: { rate_limited: 'Too many payments opened. Wait a minute.' }` adds your own messages; `pay()` throws an error with `code: 'rate_limited'` to show one. Anything else is the generic "could not open the payment page".
- `checkout.view({ notes: ['Balance $4.21'] })` puts per-request lines under the button, and `closed: 'Top-ups open soon.'` shows a message and disables the button. Both are plain text.
- `checkout.signInUrl(query)` is the URL a signed-out POST redirects to (sign in, then back to this page with the selection). Use it for the page's GET: `if (!user) redirect(checkout.signInUrl(query))`. With `requireAccount`, a signed-out page shows no email field.
- Tier x term (Pro/Team, each monthly/yearly): build one `createCheckout` per tier, cached in a `Map`, on `/checkout/<tier>`; each tier's options are its terms.
- With your own `pay()`, `order.source`, `order.code` and the rest are yours to pass on or drop; only the `coinpay()` adapter writes them to the payment metadata.

## Accounts and the same-site check

- `account(request)` returns `{ id, email }` for the signed-in buyer, or null. `email` may be `''` when you do not keep one (the page then shows no "Buying as" line), and any extra keys you return ride along on `order.account` for your `pay()`.
- With `requireAccount` and `signIn`, a signed-out post is sent to `signIn?next=<the checkout page with the selection>`. The page path comes from the Referer, falling back to `page`.
- The form may only be posted from its own site. The check compares the browser's `Origin` with the request's Host (and `X-Forwarded-Host`), and refuses `Sec-Fetch-Site: cross-site`. Behind a proxy that rewrites Host, set `siteUrl: 'https://example.com'`. A request with no `Origin` at all (curl) passes this check, so keep your own session cookie `SameSite=Lax` or stricter.

## Theme

Set any of these in a plain `.pfc { }` rule (the defaults have no specificity, so yours win in light and dark):

`--pfc-accent`, `--pfc-accent-fg`, `--pfc-fg`, `--pfc-muted`, `--pfc-card`, `--pfc-border`, `--pfc-error`, `--pfc-save-bg`, `--pfc-save-fg`, `--pfc-popular-bg`, `--pfc-popular-fg`, `--pfc-panel-bg`, `--pfc-panel-fg`, `--pfc-panel-muted`, `--pfc-radius`, `--pfc-title-size`.

Without a theme it follows `prefers-color-scheme`; `data-theme="light"` on `.pfc` pins it light. `.pfc` sets no top or bottom margin: the page decides its spacing.

A one-off option whose name is its price (`name: '$25', price: 25`) shows the price once.

## Try it

```sh
node scripts/demo.js   # http://127.0.0.1:4173/ and /topup, code HALF
npm test
```

MIT
