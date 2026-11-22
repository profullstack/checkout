import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Checkout } from './index.js'

export interface NodeRequestOptions {
  /** The body, when your server already read the stream. */
  body?: Buffer | string
  /** The public origin, when Host is not it. */
  origin?: string
}

export function toWebRequest(req: IncomingMessage, opts?: NodeRequestOptions): Promise<Request>
export function sendWebResponse(res: ServerResponse, response: Response): Promise<void>
/** The form handler for a Node http server. */
export function nodeHandler(checkout: Checkout): (req: IncomingMessage, res: ServerResponse, opts?: NodeRequestOptions) => Promise<void>
