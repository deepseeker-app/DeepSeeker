import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, parseBalancePayload } from '../src/index.ts'

interface RecordedResponse {
  status?: number
  headers?: Record<string, string | number>
  body?: string
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function bench(resolveCredential: () => Promise<{ value: string; source: string } | undefined>): Promise<{
  call: (method?: string) => Promise<RecordedResponse>
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  let route: WebRoute | undefined
  ctx.provide('credentials', { resolve: resolveCredential } as never)
  ctx.provide('webServer', {
    register: (next: WebRoute) => {
      route = next
      return () => { route = undefined }
    },
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    call: async (method = 'GET') => {
      const recorded: RecordedResponse = {}
      const res = {
        writeHead: (status: number, headers?: Record<string, string | number>) => {
          recorded.status = status
          if (headers !== undefined) recorded.headers = headers
        },
        end: (body?: string) => { if (body !== undefined) recorded.body = body },
      } as unknown as ServerResponse
      await route!.handler({ method } as IncomingMessage, res)
      return recorded
    },
    dispose: async () => { await fiber.dispose() },
  }
}

function upstream(balanceInfos: unknown[] = [{
  currency: 'CNY', total_balance: '14.92', granted_balance: '4.00', topped_up_balance: '10.92',
}]): Record<string, unknown> {
  return { is_available: true, balance_infos: balanceInfos }
}

describe('DeepSeek balance Host half', () => {
  it('declares its strict Host dependencies', () => {
    expect(inject).toEqual(['webServer', 'credentials'])
  })

  it('sends the resolved key only to the official endpoint and returns normalized money', async () => {
    const fetchMock = vi.fn(async () => Response.json(upstream()))
    vi.stubGlobal('fetch', fetchMock)
    const b = await bench(async () => ({ value: 'sk-secret', source: 'memory' }))

    const response = await b.call()
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    expect(JSON.parse(response.body!)).toMatchObject({
      ok: true,
      balance: {
        isAvailable: true,
        currency: 'CNY',
        totalBalance: 14.92,
        grantedBalance: 4,
        toppedUpBalance: 10.92,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.objectContaining({
      headers: { accept: 'application/json', authorization: 'Bearer sk-secret' },
    }))

    const head = await b.call('HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBeUndefined()
    await b.dispose()
  })

  it('maps missing and rejected keys to stable failures', async () => {
    const missing = await bench(async () => undefined)
    expect(await missing.call()).toMatchObject({ status: 200, body: '{"ok":false,"code":"missing_key"}' })
    await missing.dispose()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const invalid = await bench(async () => ({ value: 'bad', source: 'memory' }))
    expect(await invalid.call()).toMatchObject({ status: 200, body: '{"ok":false,"code":"invalid_key"}' })
    await invalid.dispose()
  })

  it('contains credential, network, upstream, and malformed-response failures', async () => {
    const credentialFailure = await bench(async () => { throw new Error('vault down') })
    expect(await credentialFailure.call()).toMatchObject({ status: 200, body: '{"ok":false,"code":"unavailable"}' })
    await credentialFailure.dispose()

    for (const implementation of [
      async () => new Response('busy', { status: 503 }),
      async () => Response.json({ nope: true }),
      async () => { throw new Error('offline') },
    ]) {
      vi.stubGlobal('fetch', vi.fn(implementation))
      const b = await bench(async () => ({ value: 'key', source: 'memory' }))
      expect(await b.call()).toMatchObject({ status: 200, body: '{"ok":false,"code":"unavailable"}' })
      await b.dispose()
    }
  })

  it('rejects unsupported methods without contacting DeepSeek', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const b = await bench(async () => ({ value: 'key', source: 'memory' }))
    const response = await b.call('POST')
    expect(response).toMatchObject({ status: 405, headers: { allow: 'GET, HEAD' } })
    expect(fetchMock).not.toHaveBeenCalled()
    await b.dispose()
  })
})

describe('DeepSeek balance payload normalization', () => {
  it('prefers CNY, falls back to USD, and supports an unavailable empty account', () => {
    const time = '2026-08-16T00:00:00.000Z'
    expect(parseBalancePayload(upstream([
      { currency: 'USD', total_balance: '2.50', granted_balance: '0.50', topped_up_balance: '2.00' },
      { currency: 'CNY', total_balance: '18', granted_balance: '8', topped_up_balance: '10' },
    ]), time)).toEqual({
      isAvailable: true, currency: 'CNY', totalBalance: 18, grantedBalance: 8, toppedUpBalance: 10, updatedAt: time,
    })
    expect(parseBalancePayload(upstream([
      { currency: 'USD', total_balance: '2.50', granted_balance: '0.50', topped_up_balance: '2.00' },
    ]), time).currency).toBe('USD')
    expect(parseBalancePayload({ is_available: false, balance_infos: [] }, time)).toEqual({
      isAvailable: false, currency: 'CNY', totalBalance: 0, grantedBalance: 0, toppedUpBalance: 0, updatedAt: time,
    })
  })

  it('rejects malformed shapes, currencies, money, and non-finite values', () => {
    expect(() => parseBalancePayload(null)).toThrow('invalid balance response')
    expect(() => parseBalancePayload({ is_available: true, balance_infos: [] })).toThrow('no supported currency')
    expect(() => parseBalancePayload(upstream([{ currency: 'EUR' }]))).toThrow('no supported currency')
    expect(() => parseBalancePayload(upstream([{ currency: 'CNY', total_balance: '-1', granted_balance: '0', topped_up_balance: '0' }]))).toThrow('invalid money')
    expect(() => parseBalancePayload(upstream([{ currency: 'CNY', total_balance: '1', granted_balance: undefined, topped_up_balance: '0' }]))).toThrow('invalid money')
    expect(() => parseBalancePayload(upstream([{ currency: 'CNY', total_balance: '9'.repeat(400), granted_balance: '0', topped_up_balance: '0' }]))).toThrow('not finite')
  })
})
