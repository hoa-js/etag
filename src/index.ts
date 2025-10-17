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
 * @param {boolean} [options.weak=false] - Whether use weak validation, if set true, should add `W/` to th prefix of ETag value.
 * @param {((body: Uint8Array) => ArrayBuffer | Promise<ArrayBuffer>)} [options.generateDigest] - custom ETag generator alg default use SHA-1
 * @param {string[]} [options.retainedHeaders=['cache-control','content-location','date','etag','expires','vary']] - An array of headers when ETag matches should retain while other headers will delete
 * @returns {HoaMiddleware} The middleware handler function.
 */
export function etag (options: ETagOptions = {}): HoaMiddleware {
  const {
    retainedHeaders = RETAINED_304_HEADERS,
    weak = false,
  } = options
  const generator = initGenerator(options.generateDigest)
  return async function etagMiddleware (ctx: HoaContext, next) {
    const ifNoneMatch = ctx.req.get('If-None-Match') ?? null
    await next()
    const res = ctx.response
    let etag = res.headers.get('ETag')
    if (!etag) {
      if (!generator) {
        return
      }
      const hash = await generateDigest(res.clone().body, generator)
      if (hash === null) {
        return
      }
      etag = weak ? `W/${hash}` : hash
    }
    ctx.res.set('ETag', etag)
    if (etagMatches(etag, ifNoneMatch)) {
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

function etagMatches (etag: string, ifNoneMatch: string | null) {
  return (
    ifNoneMatch != null && ifNoneMatch.split(/,\s*/).some((t) => stripWeak(t) === stripWeak(etag))
  )
}
function initGenerator (generator?: ETagOptions['generateDigest']) {
  if (!generator) {
    if (crypto?.subtle) {
      return (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    }
  }
  return generator
}
export default etag
