export type Money = number | string

export interface Seats {
  min?: number
  max?: number
  default?: number
  label?: string
}

export interface Audience {
  id: string
  label: string
  /** Give this to the audience that buys more than one seat. */
  seats?: Seats
}

/**
 * A plan, charged once up front for its term. Price it per month
 * (`monthly` x `months`) or by the term total (`price` for `months`); the
 * total form is exact when the price does not divide into whole cents.
 */
export interface PlanOption {
  id: string
  name: string
  monthly?: Money
  /** The whole term's price. Use with `months`, instead of `monthly`. */
  price?: Money
  months?: number
  detail?: string
  popular?: boolean
  /** Preselect this option without the "Most popular" badge. */
  default?: boolean
  /** 'total' leads with the term total ("USD 15.00 / 12 months") instead of the per-month price. */
  display?: 'monthly' | 'total'
  badges?: string[]
  gets?: string
  meta?: Record<string, unknown>
}

/** A one-off: a credit pack, a top-up amount, a single purchase. */
export interface OnceOption {
  id: string
  name: string
  price: Money
  detail?: string
  popular?: boolean
  /** Preselect this option without the "Most popular" badge. */
  default?: boolean
  badges?: string[]
  /** What the buyer gets, shown under the price ("2,500 credits"). */
  gets?: string
  meta?: Record<string, unknown>
}

export type Option = PlanOption | OnceOption

export interface Compare {
  title?: string
  /** Appended to every price: "/y", "/mo". */
  unit?: string
  items: { label: string; price: Money }[]
  ours?: { label: string; price: Money }
  heading?: string
  body?: string
  footnote?: string
}

export interface Account {
  id: string
  email: string
  guest?: boolean
  [key: string]: unknown
}

export interface Discount {
  percent?: number
  /** USD off. */
  amount?: Money
  label?: string
}

export interface Order {
  site: string
  option: { id: string; name: string; kind: 'plan' | 'once'; months: number; meta?: Record<string, unknown> }
  audience: string
  quantity: number
  code: string
  source: string
  currency: string
  unitCents: number
  subtotalCents: number
  discountCents: number
  totalCents: number
  /** totalCents / 100. */
  amount: number
  account: Account
  description: string
}

export type Pay = (order: Order, ctx: { request: Request | null }) => Promise<{ url: string; id?: string } | string> | { url: string; id?: string } | string

export interface CheckoutConfig {
  site: string
  title?: string
  subtitle?: string
  logo?: string | { src: string; alt?: string }
  currency?: string
  /** Where the form posts. Default: the page it is on. */
  action?: string
  /** The checkout page path, used when a failed post has no Referer. */
  page?: string
  audienceLabel?: string
  audiences?: Audience[]
  /** Seats when there is no audience choice. */
  seats?: Seats
  optionsLabel?: string
  options?: Option[]
  /** Alias of options. */
  plans?: Option[]
  /** Let the buyer type an amount (top-ups). */
  custom?: { min?: Money; max?: Money; default?: Money; label?: string; detail?: string }
  discountLabel?: string
  discount?: (code: string, ctx: { option: unknown; quantity: number; audience: string }) => Promise<Discount | null> | Discount | null
  cta?: string
  /** Only say what is true: there is no default guarantee line. */
  guarantee?: string
  processor?: string
  compare?: Compare
  /** Who is signed in. Return null for a guest. */
  account?: (request: Request | null) => Promise<Account | null> | Account | null
  /** Refuse guests. With signIn, they are sent there and come back. */
  requireAccount?: boolean
  signIn?: string
  /** The site's public URL. Set it behind a proxy, where Host is internal and the browser's Origin is not. */
  siteUrl?: string
  /** Extra origins allowed to post the form. */
  origins?: string[]
  pay: Pay
  /** Pin the colour scheme instead of following the visitor's. */
  theme?: 'light' | 'dark'
  /** Your own error messages by code (a-z, 0-9, _). pay() throws { code } to show one. */
  errors?: Record<string, string>
  /** Called instead of pay when a code takes the total to zero. */
  free?: Pay
  onError?: (error: unknown, order: Order) => void
}

export interface Quote {
  currency: string
  unitCents: number
  subtotalCents: number
  discountCents: number
  discountLabel: string
  discountPercent: number | null
  totalCents: number
  total: string
  breakdown: string
}

export type ErrorCode = 'invalid_option' | 'invalid_quantity' | 'invalid_amount' | 'invalid_code' | 'email_required' | 'sign_in_required' | 'payment_unavailable' | 'bad_origin'

export type HandleResult = { ok: true; url: string; order: Order; id?: string } | { ok: true; quote: Quote } | { ok: false; error: ErrorCode | string }

export type FieldsInput = string | URLSearchParams | FormData | Record<string, unknown> | null | undefined

/** Plain JSON describing the page. Opaque: pass it to html() or <Checkout view>. */
export type CheckoutView = Record<string, unknown>

export interface ViewOptions {
  /** The page's query: prefills option/plan, quantity, audience/manage, amount, code, email, source, error. */
  query?: FieldsInput
  /** Who is signed in. Only the email is shown; passing your whole account object is fine. */
  account?: { email?: string; [key: string]: unknown } | null
  action?: string
  error?: ErrorCode | string
  /** Per-request lines under the button (a balance, a reminder). Plain text. */
  notes?: string[]
  /** Sales are paused: this message shows and the button is disabled. */
  closed?: string
}

export interface Checkout {
  config: Record<string, unknown>
  css: string
  view(opts?: ViewOptions): CheckoutView
  html(opts?: ViewOptions): string
  quote(input: FieldsInput): Promise<HandleResult>
  /** The sign-in URL that returns to this page with the selection, for the page's GET. Null without `signIn`. */
  signInUrl(query?: FieldsInput): string | null
  handle(input: FieldsInput, ctx?: { request?: Request | null; account?: Account | null; intent?: 'quote' | '' }): Promise<HandleResult>
  POST(request: Request): Promise<Response>
}

export function createCheckout(config: CheckoutConfig): Checkout

export interface CoinPayOptions {
  /** The business cp_live_ key, or a function returning it (read when the payment opens). */
  apiKey: string | (() => string | undefined | Promise<string | undefined>)
  base?: string
  property?: string | ((order: Order) => string)
  successUrl?: string | ((order: Order) => string)
  cancelUrl?: string | ((order: Order) => string)
  expiresInMinutes?: number
  allowedMethods?: string[]
  metadata?: Record<string, string> | ((order: Order) => Record<string, string> | Promise<Record<string, string>>)
  fetch?: typeof fetch
}

export function coinpay(options: CoinPayOptions): (order: Order) => Promise<{ url: string; id?: string }>
export function orderMetadata(order: Order): Record<string, string>
export function readOrder(metadata: unknown): { option: string; kind: string; months: number; quantity: number; totalCents: number; subtotalCents: number; audience: string; code: string; source: string } | null

export const ERRORS: Record<ErrorCode, string>
export const css: string
export function toCents(value: Money): number
export function money(cents: number, opts?: { currency?: string; short?: boolean }): string
export function fields(input: FieldsInput): Record<string, string>
export function escapeHtml(value: unknown): string
