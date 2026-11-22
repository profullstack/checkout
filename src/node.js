// Plain Node `http` glue: the checkout speaks web Request/Response, a Node
// server speaks IncomingMessage/ServerResponse. Kept in its own entry so the
// main one stays runtime-neutral.

const MAX_BODY = 64 * 1024 // a checkout form is a few hundred bytes

/** Read the request body, refusing anything far larger than a form. */
async function readBody(req, limit = MAX_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('request body too large'), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * A web Request for a Node request. Pass `body` when your server has already
 * read it (a Buffer or string); otherwise it is read here.
 */
export async function toWebRequest(req, { body, origin } = {}) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v)
    else if (value != null) headers.set(key, String(value))
  }
  const base = origin || `${req.socket && req.socket.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`
  const method = (req.method || 'GET').toUpperCase()
  const init = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') init.body = body != null ? body : await readBody(req)
  return new Request(new URL(req.url || '/', base), init)
}

/** Write a web Response to a Node response. */
export async function sendWebResponse(res, response) {
  const headers = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
}

/**
 * The form handler for a Node http server:
 *
 *   if (req.method === 'POST' && url.pathname === '/checkout') return handle(req, res)
 *
 * `body` is for servers that have already consumed the stream.
 */
export function nodeHandler(checkout) {
  return async function handle(req, res, { body, origin } = {}) {
    let request
    try {
      request = await toWebRequest(req, { body, origin })
    } catch (error) {
      res.writeHead(error && error.status === 413 ? 413 : 400, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad request')
      return
    }
    await sendWebResponse(res, await checkout.POST(request))
  }
}
