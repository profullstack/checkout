'use client'
// Keep this module to the one component: every export of a 'use client' file
// is a client reference when a server component imports it.

import { useEffect } from 'react'
import { mountCheckout } from './browser.js'

export function CheckoutEnhancer() {
  useEffect(() => {
    mountCheckout()
  }, [])
  return null
}
