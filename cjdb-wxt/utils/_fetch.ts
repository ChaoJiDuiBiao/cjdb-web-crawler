import { browser } from 'wxt/browser'
import { MessageTypes } from '@/types'

type HTTPRequestPayload = {
  url: string
  init?: RequestInit
}

type HTTPResponsePayload =
  | {
      ok: true
      status: number
      statusText: string
      headers: Array<[string, string]>
      body: ArrayBuffer
    }
  | {
      ok: false
      error: string
    }

/**
 * Proxy fetch through background script to avoid page-context CORS issues.
 *
 * Limited implementation: supports typical JSON/text API calls
 * (string body, plain headers). AbortSignal/FormData/streaming are intentionally
 * not supported yet.
 */
export async function _fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url = ''
  let mergedInit: RequestInit | undefined = init

  if (typeof input === 'string') {
    url = input
  } else if (input instanceof URL) {
    url = input.toString()
  } else if (input instanceof Request) {
    url = input.url
    // Prefer explicit init, otherwise clone request fields.
    if (!mergedInit) {
      // NOTE: Request.body is a stream; we intentionally do not support streaming.
      mergedInit = {
        method: input.method,
        headers: input.headers
      }
    }
  } else {
    url = String(input as any)
  }

  if (!url) throw new TypeError('Failed to fetch')
  if (mergedInit?.signal) throw new TypeError('AbortSignal is not supported by _fetch')

  const payload: HTTPRequestPayload = { url, init: mergedInit }
  const resp = (await browser.runtime.sendMessage({
    type: MessageTypes.HTTPRequest,
    payload
  })) as HTTPResponsePayload | undefined

  if (!resp) throw new TypeError('Failed to fetch')
  if (!resp.ok) throw new TypeError(resp.error || 'Failed to fetch')

  const headers = new Headers()
  resp.headers.forEach(([k, v]) => headers.append(k, v))
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers
  })
}

