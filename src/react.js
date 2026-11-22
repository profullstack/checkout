// React entry: the same tree as the HTML renderer, as elements. A server
// component; the small client part lives in react-client.js.

import { createElement, Fragment } from 'react'
import { CheckoutEnhancer } from './react-client.js'
import { tree } from './tree.js'

const RENAME = {
  class: 'className',
  for: 'htmlFor',
  maxlength: 'maxLength',
  inputmode: 'inputMode',
  autocomplete: 'autoComplete',
}

// Inputs whose `value` is what they submit, not what the person typed.
const FIXED_VALUE = new Set(['radio', 'checkbox', 'hidden'])

function toReact(node) {
  if (typeof node === 'string' || typeof node === 'number') return node
  const props = {}
  for (const [key, value] of Object.entries(node.attrs)) {
    if (value === false || value === null || value === undefined) continue
    if (key === 'selected') continue // carried by the select's defaultValue below
    if (key === 'checked') props.defaultChecked = Boolean(value)
    else if (key === 'value' && node.tag === 'input' && !FIXED_VALUE.has(node.attrs.type)) props.defaultValue = value
    else if (key.startsWith('data-') || key.startsWith('aria-')) props[key] = value === true ? '' : value
    else props[RENAME[key] || key] = value
  }
  if (node.tag === 'select') {
    const chosen = node.children.find((c) => c.attrs && c.attrs.selected)
    if (chosen) props.defaultValue = chosen.attrs.value
  }
  return createElement(node.tag, props, ...node.children.map(toReact))
}

/**
 * <Checkout view={checkout.view({ query, account })} />
 * `enhance={false}` leaves out the browser script (the page then works as a
 * plain form).
 */
export function Checkout({ view, enhance = true }) {
  return createElement(Fragment, null, toReact(tree(view)), enhance ? createElement(CheckoutEnhancer, null) : null)
}

export default Checkout
