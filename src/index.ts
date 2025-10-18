import type { HoaContext, HoaMiddleware } from 'hoa'
import { generateDigest } from './digest.ts'

export interface ETagOptions {
  retainedHeaders?: string[]
  weak?: boolean
  generateDigest?: (body: Uint8Array) => ArrayBuffer | Promise<ArrayBuffer>
}

export const RETAINED_304_HEADERS = [
  'cache-control',
  'content-location',
  'date',
  'etag',
  'expires',
  'vary',
]

/**
 * ETag middleware for Hoa.
 *
 * @param {Object} options - The options for the ETag middleware.
 * @param {boolean} [options.weak=false] - Whether use weak validation, if set true, should add `W/` to the prefix of ETag value.
 * @param {((body: Uint8Array) => ArrayBuffer | Promise<ArrayBuffer>)} [options.generateDigest] - custom ETag generator alg default use SHA-1
 * @param {string[]} [options.retainedHeaders=['cache-control','content-location','date','etag','expires','vary']] - An array of headers when ETag matches should retain while other headers will delete
 * @returns {HoaMiddleware} The middleware handler function.
 */
export function etag (options: ETagOptions = {}): HoaMiddleware {
  const retainedHeaders = Array.isArray(options.retainedHeaders)
    ? options.retainedHeaders.map((h) => h.toLowerCase())
    : RETAINED_304_HEADERS
  const weak = options.weak ?? false
  const generator = initializeGenerator(options.generateDigest)

  return async function etagMiddleware (ctx: HoaContext, next) {
    const method = ctx.req.method
    const ifNoneMatch = ctx.req.get('If-None-Match')?.trim() ?? null

    await next()

    let etag = ctx.res.get('ETag')
    if (!etag) {
      if (!generator) {
        return
      }
      const hash = await generateDigest(ctx.response.body, generator)
      if (hash === null) {
        return
      }
      etag = weak ? `W/"${hash}"` : `"${hash}"`
    }

    ctx.res.set('ETag', etag)

    // Only return 304 for successful 2xx responses
    const status = ctx.res.status
    if (status >= 200 && status < 300 && etagMatches(etag, ifNoneMatch, method)) {
      ctx.res.body = null
      ctx.res.status = 304
      for (const h in ctx.res.headers) {
        if (!retainedHeaders.includes(h)) {
          ctx.res.delete(h)
        }
      }
    }
  }
}

function stripWeak (tag: string) {
  return tag.replace(/^W\//, '')
}

function etagMatches (etag: string, ifNoneMatch: string | null, method: string) {
  if (ifNoneMatch == null) return false
  // RFC 7232: If-None-Match: * matches any current representation for GET/HEAD
  if (ifNoneMatch === '*') return method === 'GET' || method === 'HEAD'
  return ifNoneMatch.split(/\s*,\s*/).some((t) => stripWeak(t) === stripWeak(etag))
}

function initializeGenerator (
  generator?: ETagOptions['generateDigest']
): ETagOptions['generateDigest'] | undefined {
  if (!generator) {
    if (crypto?.subtle) {
      generator = (body: Uint8Array) =>
        crypto.subtle.digest(
          {
            name: 'SHA-1',
          },
          body
        )
    }
  }

  return generator
}

export default etag
