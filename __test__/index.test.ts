import { Hoa } from 'hoa'
import { describe, it, expect, beforeEach } from '@jest/globals'
import { etag } from '../src/index'
import { generateDigest } from '../src/digest'
import { router } from '@hoajs/router'

async function getHash (response: Response, alg = 'SHA-1'): Promise<string | null> {
  const res = response.clone()
  return await generateDigest(res.body, (body: Uint8Array) => crypto.subtle.digest({ name: alg }, body))
}

describe('generateDigest utility', () => {
  it('Should generate digest from stream', async () => {
    const content = 'Test content'
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(new TextEncoder().encode(content))
        controller.close()
      }
    })

    const digest = await generateDigest(
      stream,
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    expect(digest).not.toBeNull()
    expect(typeof digest).toBe('string')
    expect(digest?.length).toBe(40) // SHA-1 produces 40 hex characters
  })

  it('Should return null for null stream', async () => {
    const digest = await generateDigest(
      null,
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    expect(digest).toBeNull()
  })

  it('Should handle chunked streams', async () => {
    const chunks = ['Hello', ' ', 'World']
    const stream = new ReadableStream({
      start (controller) {
        chunks.forEach(chunk => {
          controller.enqueue(new TextEncoder().encode(chunk))
        })
        controller.close()
      }
    })

    const digest = await generateDigest(
      stream,
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    expect(digest).not.toBeNull()
  })

  it('Should produce consistent digests for same content', async () => {
    const content = 'Consistent content'

    const createStream = () => new ReadableStream({
      start (controller) {
        controller.enqueue(new TextEncoder().encode(content))
        controller.close()
      }
    })

    const digest1 = await generateDigest(
      createStream(),
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    const digest2 = await generateDigest(
      createStream(),
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    expect(digest1).toEqual(digest2)
  })

  it('Should handle empty stream', async () => {
    const stream = new ReadableStream({
      start (controller) {
        controller.close()
      }
    })

    const digest = await generateDigest(
      stream,
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-1' }, body)
    )

    expect(digest).toBeNull()
  })

  it('Should work with different hash algorithms', async () => {
    const content = 'Algorithm test'
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(new TextEncoder().encode(content))
        controller.close()
      }
    })

    const digest = await generateDigest(
      stream,
      (body: Uint8Array) => crypto.subtle.digest({ name: 'SHA-256' }, body)
    )

    expect(digest).not.toBeNull()
    expect(digest?.length).toBe(64) // SHA-256 produces 64 hex characters
  })
})

describe('Etag middleware', () => {
  describe('Basic ETag generation', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should generate and return ETag header for response body', async () => {
      app.get('/test', etag(), (ctx) => {
        ctx.res.body = 'Hello Hoa'
      })

      const response = await app.fetch(new Request('http://localhost/test'))
      const hash = await getHash(response)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(body).toBe('Hello Hoa')
      expect(response.headers.get('ETag')).not.toBeNull()
      expect(response.headers.get('ETag')).toEqual(`"${hash}"`)
    })

    it('Should generate different ETags for different content', async () => {
      app.get('/content1', etag(), (ctx) => {
        ctx.res.body = 'Content 1'
      })
      app.get('/content2', etag(), (ctx) => {
        ctx.res.body = 'Content 2'
      })

      const response1 = await app.fetch(new Request('http://localhost/content1'))
      const response2 = await app.fetch(new Request('http://localhost/content2'))

      const etag1 = response1.headers.get('ETag')
      const etag2 = response2.headers.get('ETag')

      expect(etag1).not.toBeNull()
      expect(etag2).not.toBeNull()
      expect(etag1).not.toEqual(etag2)
    })

    it('Should generate same ETag for identical content', async () => {
      app.get('/same1', etag(), (ctx) => {
        ctx.res.body = 'Same Content'
      })
      app.get('/same2', etag(), (ctx) => {
        ctx.res.body = 'Same Content'
      })

      const response1 = await app.fetch(new Request('http://localhost/same1'))
      const response2 = await app.fetch(new Request('http://localhost/same2'))

      expect(response1.headers.get('ETag')).toEqual(response2.headers.get('ETag'))
    })

    it('Should not generate ETag for empty body', async () => {
      app.get('/empty', etag(), (ctx) => {
        ctx.res.body = null
      })

      const response = await app.fetch(new Request('http://localhost/empty'))
      expect(response.headers.get('ETag')).toBeNull()
    })

    it('Should preserve existing ETag header if already set', async () => {
      const customETag = '"custom-etag-value"'
      app.get('/custom', etag(), (ctx) => {
        ctx.res.set('ETag', customETag)
        ctx.res.body = 'Hello'
      })

      const response = await app.fetch(new Request('http://localhost/custom'))
      expect(response.headers.get('ETag')).toBe(customETag)
    })
  })

  describe('Weak validation', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should add W/ prefix for weak ETags', async () => {
      app.get('/weak', etag({ weak: true }), (ctx) => {
        ctx.res.body = 'Weak validation'
      })

      const response = await app.fetch(new Request('http://localhost/weak'))
      const etagValue = response.headers.get('ETag')

      expect(etagValue).not.toBeNull()
      expect(etagValue?.startsWith('W/')).toBe(true)
    })

    it('Should not add W/ prefix for strong ETags (default)', async () => {
      app.get('/strong', etag(), (ctx) => {
        ctx.res.body = 'Strong validation'
      })

      const response = await app.fetch(new Request('http://localhost/strong'))
      const etagValue = response.headers.get('ETag')

      expect(etagValue).not.toBeNull()
      expect(etagValue?.startsWith('W/')).toBe(false)
    })
  })

  describe('If-None-Match header handling', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should return 304 when If-None-Match matches ETag', async () => {
      app.get('/match', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/match'))
      const etagValue = firstResponse.headers.get('ETag')

      const secondResponse = await app.fetch(
        new Request('http://localhost/match', {
          headers: { 'If-None-Match': etagValue! }
        })
      )

      expect(secondResponse.status).toBe(304)
    })

    it('Should return 200 when If-None-Match does not match ETag', async () => {
      app.get('/nomatch', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })

      const response = await app.fetch(
        new Request('http://localhost/nomatch', {
          headers: { 'If-None-Match': '"different-etag"' }
        })
      )

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('Test content')
    })

    it('Should handle multiple ETags in If-None-Match', async () => {
      app.get('/multiple', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/multiple'))
      const etagValue = firstResponse.headers.get('ETag')

      const secondResponse = await app.fetch(
        new Request('http://localhost/multiple', {
          headers: { 'If-None-Match': `"other-etag", ${etagValue}, "another-etag"` }
        })
      )

      expect(secondResponse.status).toBe(304)
    })

    it('Should match weak ETags with strong ETags', async () => {
      app.get('/weakmatch', etag({ weak: true }), (ctx) => {
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/weakmatch'))
      const weakETag = firstResponse.headers.get('ETag')!
      const strongETag = weakETag.replace(/^W\//, '')

      const secondResponse = await app.fetch(
        new Request('http://localhost/weakmatch', {
          headers: { 'If-None-Match': strongETag }
        })
      )

      expect(secondResponse.status).toBe(304)
    })

    it('Should match strong ETags with weak ETags in If-None-Match', async () => {
      app.get('/strongmatch', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/strongmatch'))
      const strongETag = firstResponse.headers.get('ETag')!
      const weakETag = `W/${strongETag}`

      const secondResponse = await app.fetch(
        new Request('http://localhost/strongmatch', {
          headers: { 'If-None-Match': weakETag }
        })
      )

      expect(secondResponse.status).toBe(304)
    })

    it('Should handle If-None-Match: * for different HTTP methods', async () => {
      // GET should return 304
      app.get('/wildcard-get', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })
      const getResponse = await app.fetch(
        new Request('http://localhost/wildcard-get', {
          headers: { 'If-None-Match': '*' }
        })
      )
      expect(getResponse.status).toBe(304)

      // POST should return 200
      app.post('/wildcard-post', etag(), (ctx) => {
        ctx.res.body = 'Test content'
      })
      const postResponse = await app.fetch(
        new Request('http://localhost/wildcard-post', {
          method: 'POST',
          headers: { 'If-None-Match': '*' }
        })
      )
      expect(postResponse.status).toBe(200)
    })
  })

  describe('304 response header retention', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should retain default headers on 304 response', async () => {
      app.get('/retain', etag(), (ctx) => {
        ctx.res.set('Cache-Control', 'max-age=3600')
        ctx.res.set('Date', new Date().toUTCString())
        ctx.res.set('Vary', 'Accept-Encoding')
        ctx.res.set('Content-Type', 'text/plain')
        ctx.res.set('X-Custom-Header', 'custom-value')
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/retain'))
      const etagValue = firstResponse.headers.get('ETag')

      const secondResponse = await app.fetch(
        new Request('http://localhost/retain', {
          headers: { 'If-None-Match': etagValue! }
        })
      )

      expect(secondResponse.status).toBe(304)
      expect(secondResponse.headers.get('Cache-Control')).toBe('max-age=3600')
      expect(secondResponse.headers.get('Date')).not.toBeNull()
      expect(secondResponse.headers.get('Vary')).toBe('Accept-Encoding')
      expect(secondResponse.headers.get('ETag')).toBe(etagValue)
      expect(secondResponse.headers.get('Content-Type')).toBeNull()
      expect(secondResponse.headers.get('X-Custom-Header')).toBeNull()
    })

    it('Should respect custom retainedHeaders option', async () => {
      app.get('/custom-retain', etag({ retainedHeaders: ['etag', 'x-custom-header'] }), (ctx) => {
        ctx.res.set('Cache-Control', 'max-age=3600')
        ctx.res.set('X-Custom-Header', 'keep-me')
        ctx.res.set('Content-Type', 'text/plain')
        ctx.res.body = 'Test content'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/custom-retain'))
      const etagValue = firstResponse.headers.get('ETag')

      const secondResponse = await app.fetch(
        new Request('http://localhost/custom-retain', {
          headers: { 'If-None-Match': etagValue! }
        })
      )

      expect(secondResponse.status).toBe(304)
      expect(secondResponse.headers.get('ETag')).toBe(etagValue)
      expect(secondResponse.headers.get('X-Custom-Header')).toBe('keep-me')
      expect(secondResponse.headers.get('Cache-Control')).toBeNull()
      expect(secondResponse.headers.get('Content-Type')).toBeNull()
    })
  })

  describe('Custom digest generator', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should use custom digest generator', async () => {
      const customGenerator = async (body: Uint8Array) => {
        return crypto.subtle.digest({ name: 'SHA-256' }, body)
      }

      app.get('/custom-digest', etag({ generateDigest: customGenerator }), (ctx) => {
        ctx.res.body = 'Custom digest'
      })

      const response = await app.fetch(new Request('http://localhost/custom-digest'))
      const etagValue = response.headers.get('ETag')

      expect(etagValue).not.toBeNull()
      // SHA-256 produces 64 hex characters + 2 quotes = 66, SHA-1 produces 40 + 2 = 42
      expect(etagValue?.length).toBe(66)
    })

    it('Should handle synchronous custom digest generator', async () => {
      const syncGenerator = (body: Uint8Array) => {
        return crypto.subtle.digest({ name: 'SHA-1' }, body)
      }

      app.get('/sync-digest', etag({ generateDigest: syncGenerator }), (ctx) => {
        ctx.res.body = 'Sync digest'
      })

      const response = await app.fetch(new Request('http://localhost/sync-digest'))
      expect(response.headers.get('ETag')).not.toBeNull()
    })
  })

  describe('Edge cases', () => {
    let app: Hoa

    beforeEach(() => {
      app = new Hoa()
      app.extend(router())
    })

    it('Should handle various content types', async () => {
      // Large content
      const largeContent = 'x'.repeat(100000)
      app.get('/large', etag(), (ctx) => {
        ctx.res.body = largeContent
      })
      const largeResponse = await app.fetch(new Request('http://localhost/large'))
      expect(largeResponse.headers.get('ETag')).not.toBeNull()

      // Unicode content
      app.get('/unicode', etag(), (ctx) => {
        ctx.res.body = '你好世界 🌍 مرحبا'
      })
      const unicodeResponse = await app.fetch(new Request('http://localhost/unicode'))
      expect(unicodeResponse.headers.get('ETag')).not.toBeNull()

      // JSON content
      const jsonData = { message: 'Hello', count: 42 }
      app.get('/json', etag(), (ctx) => {
        ctx.res.body = JSON.stringify(jsonData)
      })
      const jsonResponse = await app.fetch(new Request('http://localhost/json'))
      expect(jsonResponse.headers.get('ETag')).not.toBeNull()
      expect(JSON.parse(await jsonResponse.text())).toEqual(jsonData)
    })

    it('Should handle empty If-None-Match header', async () => {
      app.get('/empty-header', etag(), (ctx) => {
        ctx.res.body = 'Test'
      })

      const response = await app.fetch(
        new Request('http://localhost/empty-header', {
          headers: { 'If-None-Match': '' }
        })
      )

      expect(response.status).toBe(200)
    })

    it('Should return empty Etag when default cypto api is not available', async () => {
      const originalCrypto = (globalThis as any).crypto
      try {
        (globalThis as any).crypto = undefined
        app.get('/empty-digest', etag(), (ctx) => {
          ctx.res.body = 'Test'
        })

        const response = await app.fetch(new Request('http://localhost/empty-digest'))
        expect(response.headers.get('ETag')).toBeNull()
      } finally {
        (globalThis as any).crypto = originalCrypto
      }
    })

    it('Should not return 304 for non-2xx status codes', async () => {
      app.get('/error', etag(), (ctx) => {
        ctx.res.status = 404
        ctx.res.body = 'Not Found'
      })

      const firstResponse = await app.fetch(new Request('http://localhost/error'))
      const etagValue = firstResponse.headers.get('ETag')

      const secondResponse = await app.fetch(
        new Request('http://localhost/error', {
          headers: { 'If-None-Match': etagValue! }
        })
      )

      expect(secondResponse.status).toBe(404)
    })
  })
})
