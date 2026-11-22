// One element tree for the checkout page. toHtml() turns it into a string for
// plain sites; the React entry turns the same tree into elements, so the two
// can never drift apart.

export function h(tag, attrs, ...children) {
  return { tag, attrs: attrs || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== '') }
}

const VOID = new Set(['input', 'img', 'br', 'hr'])

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function toHtml(node) {
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('')
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`
  return `<${node.tag}${attrs}>${node.children.map(toHtml).join('')}</${node.tag}>`
}

/** The checkout page for a view (see view() in core.js). */
export function tree(v) {
  const optionCard = (o) =>
    h(
      'label',
      { class: 'pfc-option' },
      h('input', { type: 'radio', name: 'option', value: o.id, checked: v.selected === o.id, required: true }),
      o.badges && o.badges.length ? h('span', { class: 'pfc-badges' }, o.badges.map((b) => h('span', { class: `pfc-badge pfc-badge-${b.tone}` }, b.text))) : null,
      h('span', { class: 'pfc-option-text' }, h('span', { class: 'pfc-option-name' }, o.name), o.detail ? h('span', { class: 'pfc-option-detail' }, o.detail) : null),
      o.custom
        ? h(
            'span',
            { class: 'pfc-option-price pfc-amount' },
            h('span', { class: 'pfc-amount-currency' }, v.currency),
            h('input', {
              type: 'number',
              name: 'amount',
              value: o.amount,
              min: (o.minCents / 100).toString(),
              max: (o.maxCents / 100).toString(),
              step: '0.01',
              inputmode: 'decimal',
              'aria-label': `${o.name} in ${v.currency}`,
            }),
          )
        : h(
            'span',
            { class: 'pfc-option-price' },
            o.price ? h('span', { class: 'pfc-option-amount' }, o.price) : null,
            o.unit ? h('span', { class: 'pfc-option-unit' }, o.unit) : null,
            o.gets ? h('span', { class: 'pfc-option-gets' }, o.gets) : null,
          ),
    )

  const seats = v.anySeats
    ? h(
        'label',
        { class: 'pfc-field pfc-seats' },
        h('span', { class: 'pfc-label' }, (v.seats && v.seats.label) || 'Seats'),
        h('input', {
          type: 'number',
          name: 'quantity',
          value: String(v.quantity),
          min: String(v.seats ? v.seats.min : 1),
          max: String(v.seats ? v.seats.max : 500),
          step: '1',
          inputmode: 'numeric',
        }),
      )
    : null

  const form = h(
    'form',
    { class: 'pfc-main', method: 'post', action: v.action || undefined },
    h(
      'header',
      { class: 'pfc-head' },
      v.logo ? h('img', { class: 'pfc-logo', src: v.logo.src, alt: v.logo.alt, width: '56', height: '56' }) : null,
      h('h1', { class: 'pfc-title' }, v.title),
      v.subtitle ? h('p', { class: 'pfc-subtitle' }, v.subtitle) : null,
    ),
    v.error ? h('p', { class: 'pfc-error', role: 'alert' }, v.error.message) : null,
    v.source ? h('input', { type: 'hidden', name: 'source', value: v.source }) : null,
    v.account
      ? v.account.email
        ? h('p', { class: 'pfc-account' }, 'Buying as ', h('strong', null, v.account.email))
        : null
      : h(
          'label',
          { class: 'pfc-field' },
          h('span', { class: 'pfc-label' }, 'Email'),
          h('input', { type: 'email', name: 'email', value: v.email, required: true, autocomplete: 'email', placeholder: 'you@example.com' }),
        ),
    v.audiences.length
      ? h(
          'label',
          { class: 'pfc-field' },
          h('span', { class: 'pfc-label' }, v.audienceLabel),
          h(
            'select',
            { name: 'audience' },
            v.audiences.map((a) => h('option', { value: a.id, selected: a.id === v.audience, 'data-seats': a.seats ? '1' : undefined }, a.label)),
          ),
        )
      : null,
    seats,
    h(
      'fieldset',
      { class: 'pfc-options' },
      h('legend', { class: 'pfc-label' }, v.optionsLabel),
      v.options.map(optionCard),
      v.custom ? optionCard({ ...v.custom, custom: true, badges: [] }) : null,
    ),
    v.hasDiscount
      ? h(
          'details',
          { class: 'pfc-discount', open: Boolean(v.code) },
          h('summary', null, v.discountLabel),
          h('input', { type: 'text', name: 'code', value: v.code, maxlength: '64', autocomplete: 'off', 'aria-label': 'Discount code' }),
          h('p', { class: 'pfc-discount-note', 'data-pfc-code-note': true, 'aria-live': 'polite' }),
        )
      : null,
    h(
      'p',
      { class: 'pfc-total', 'aria-live': 'polite' },
      h('span', { class: 'pfc-total-label' }, 'Due today'),
      h('strong', { 'data-pfc-total': true }, v.total),
      h('span', { class: 'pfc-total-note', 'data-pfc-breakdown': true }, v.breakdown),
    ),
    h('button', { class: 'pfc-cta', type: 'submit' }, v.cta),
    v.guarantee || v.processor ? h('p', { class: 'pfc-assure' }, [v.guarantee, v.processor].filter(Boolean).join(' ')) : null,
  )

  const c = v.compare
  const compare = c
    ? h(
        'aside',
        { class: 'pfc-compare' },
        h('h2', { class: 'pfc-compare-title' }, c.title),
        h(
          'ul',
          { class: 'pfc-compare-list' },
          c.items.map((i) => h('li', null, h('span', null, i.label), h('span', { class: 'pfc-compare-price' }, i.price))),
        ),
        c.items.length > 1 ? h('p', { class: 'pfc-compare-total' }, c.total) : null,
        c.ours ? h('p', { class: 'pfc-compare-ours' }, h('span', null, c.ours.label), h('strong', null, c.ours.price)) : null,
        c.heading ? h('p', { class: 'pfc-compare-heading' }, c.heading) : null,
        c.body ? h('p', { class: 'pfc-compare-body' }, c.body) : null,
        c.footnote ? h('p', { class: 'pfc-compare-footnote' }, c.footnote) : null,
      )
    : null

  // The browser script reads prices from here instead of scraping the page.
  const data = JSON.stringify({
    currency: v.currency,
    options: Object.fromEntries(v.options.map((o) => [o.id, { c: o.chargeCents, m: o.months }])),
    seats: Object.fromEntries(v.audiences.map((a) => [a.id, a.seats || null])),
    baseSeats: v.audiences.length ? null : v.seats,
  })

  return h('section', { class: compare ? 'pfc pfc-split' : 'pfc', 'data-pfc': data }, form, compare)
}
