// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDeepSeekBalance } from '../src/client/balance-client.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DeepSeek balance browser client', () => {
  it('accepts a valid Host projection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ok: true,
      balance: {
        isAvailable: true,
        currency: 'USD',
        totalBalance: 2.5,
        grantedBalance: 0.5,
        toppedUpBalance: 2,
        updatedAt: '2026-08-16T00:00:00.000Z',
      },
    })))
    const controller = new AbortController()
    await expect(loadDeepSeekBalance(controller.signal)).resolves.toMatchObject({ currency: 'USD', totalBalance: 2.5 })
    expect(fetch).toHaveBeenCalledWith('/deepseeker/deepseek-balance', {
      method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal,
    })
  })

  it('keeps stable Host failures and contains malformed responses', async () => {
    for (const [response, code] of [
      [Response.json({ ok: false, code: 'missing_key' }), 'missing_key'],
      [Response.json({ ok: false, code: 'invalid_key' }), 'invalid_key'],
      [Response.json({ ok: false, code: 'surprise' }, { status: 500 }), 'unavailable'],
      [Response.json(null), 'unavailable'],
      [Response.json({ ok: true, balance: null }), 'unavailable'],
      [Response.json({ ok: true, balance: 'bad' }), 'unavailable'],
      [Response.json({ ok: true, balance: { currency: 'CNY' } }), 'unavailable'],
      [new Response('not json'), 'unavailable'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(loadDeepSeekBalance(new AbortController().signal)).rejects.toMatchObject({ code })
    }
  })
})
