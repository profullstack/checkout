// Progressive enhancement for the checkout page. The page works without this
// (a plain form post, a 303 to the payment page); with it the total follows
// the selection, the seat field follows the audience and a discount code is
// checked before the person leaves.

import { money } from './core.js'

function setup(root) {
  if (root.dataset.pfcReady) return
  let data
  try {
    data = JSON.parse(root.dataset.pfc || '{}')
  } catch {
    return
  }
  const form = root.querySelector('form.pfc-main')
  if (!form) return
  root.dataset.pfcReady = '1'

  const total = root.querySelector('[data-pfc-total]')
  const breakdown = root.querySelector('[data-pfc-breakdown]')
  const note = root.querySelector('[data-pfc-code-note]')
  const seatsField = form.querySelector('.pfc-seats')
  const button = form.querySelector('.pfc-cta')
  let discount = null

  const field = (name) => form.elements.namedItem(name)
  const value = (name) => {
    const el = field(name)
    return el ? el.value : ''
  }

  function seatRule() {
    const audience = field('audience')
    return audience ? (data.seats || {})[audience.value] || null : data.baseSeats || null
  }

  function quantity() {
    const rule = seatRule()
    if (!rule) return 1
    const n = Number.parseInt(value('quantity'), 10)
    return Number.isFinite(n) ? Math.min(rule.max, Math.max(rule.min, n)) : rule.default
  }

  function update() {
    const rule = seatRule()
    if (seatsField) {
      seatsField.hidden = !rule
      const input = seatsField.querySelector('input')
      if (rule && input) {
        input.min = rule.min
        input.max = rule.max
        if (!input.value || Number(input.value) < rule.min) input.value = rule.default
      }
    }
    const id = value('option')
    const option = (data.options || {})[id]
    let unit = option ? option.c : Math.round(Number(value('amount') || 0) * 100)
    if (!Number.isFinite(unit) || unit < 0) unit = 0
    const qty = quantity()
    const subtotal = unit * qty
    let off = 0
    if (discount) off = discount.percent != null ? Math.round((subtotal * discount.percent) / 100) : discount.cents || 0
    const due = Math.max(0, subtotal - Math.min(subtotal, off))
    if (total) total.textContent = money(due, { currency: data.currency })
    if (breakdown) {
      const parts = []
      if (qty > 1) parts.push(`${qty} seats`)
      if (option && option.m) parts.push(option.m === 1 ? '1 month' : `${option.m} months`)
      breakdown.textContent = parts.join(' x ')
    }
  }

  // Typing in the custom amount selects it.
  const amount = field('amount')
  if (amount) {
    amount.addEventListener('focus', () => {
      const radio = form.querySelector('input[name="option"][value="custom"]')
      if (radio && !radio.checked) {
        radio.checked = true
        update()
      }
    })
  }

  async function checkCode() {
    const code = value('code').trim()
    discount = null
    if (!code) {
      if (note) note.textContent = ''
      update()
      return
    }
    try {
      const body = Object.fromEntries(new FormData(form).entries())
      body.intent = 'quote'
      const res = await fetch(form.getAttribute('action') || window.location.pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      })
      const out = await res.json()
      if (out.ok && out.quote) {
        // Keep the percentage so the total still follows a changed selection.
        const q = out.quote
        discount = q.discountPercent != null ? { percent: q.discountPercent } : { cents: q.discountCents }
        if (note) {
          note.textContent = `${q.discountLabel} applied`
          note.dataset.state = 'ok'
        }
      } else if (note) {
        note.textContent = out.message || 'That discount code is not valid.'
        note.dataset.state = 'bad'
      }
    } catch {
      // The server checks the code again on submit; say nothing on a network blip.
    }
    update()
  }

  form.addEventListener('input', update)
  form.addEventListener('change', (event) => {
    if (event.target && event.target.name === 'code') checkCode()
    else update()
  })
  form.addEventListener('submit', () => {
    if (!button) return
    button.dataset.label = button.textContent
    button.textContent = 'Opening payment...'
    button.setAttribute('aria-busy', 'true')
    // Disable after the submit has been collected, or the form will not post.
    setTimeout(() => {
      button.disabled = true
    }, 0)
  })
  // Back from the payment page: the button must work again.
  window.addEventListener('pageshow', () => {
    if (!button || !button.dataset.label) return
    button.disabled = false
    button.textContent = button.dataset.label
    button.removeAttribute('aria-busy')
  })

  update()
  if (value('code').trim()) checkCode()
}

/** Wire up every checkout on the page (or inside `root`). Safe to call twice. */
export function mountCheckout(root = document) {
  const nodes = root.matches && root.matches('[data-pfc]') ? [root] : root.querySelectorAll('[data-pfc]')
  for (const node of nodes) setup(node)
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountCheckout())
  else mountCheckout()
}
