/** Mobile history pagination and transport deadlines for the patched remote surface. */

import {
  history,
  MOBILE_HISTORY_PAGE_MESSAGES,
} from '../node_modules/@linxin666/dsh-remote-web-ui/src/mobile/api.ts'
import {
  callUnary,
  MOBILE_RPC_TIMEOUT_MS,
} from '../node_modules/@linxin666/dsh-remote-web-ui/src/mobile/rpc.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

function jsonRequestBody(init?: RequestInit): string {
  const body = init?.body
  if (typeof body !== 'string') throw new TypeError('expected a JSON request body')
  return body
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('mobile remote request bounds', () => {
  it('uses a small history page for tool-heavy sessions', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(jsonRequestBody(init)) as { rpcId: string; payload: { maxMessages: number } }
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: { events: [], hasMore: false } },
      }))
    })
    vi.stubGlobal('fetch', fetcher)

    await history('session-heavy')

    expect(MOBILE_HISTORY_PAGE_MESSAGES).toBe(5)
    const request = JSON.parse(jsonRequestBody(fetcher.mock.calls[0]?.[1])) as { payload: { maxMessages: number } }
    expect(request.payload.maxMessages).toBe(MOBILE_HISTORY_PAGE_MESSAGES)
  })

  it('aborts a mobile request that never settles', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }))

    const pending = callUnary('session.history', { sessionId: 'session-stalled' })
    const rejected = expect(pending).rejects.toThrow('transport failed: timed out')

    await vi.advanceTimersByTimeAsync(MOBILE_RPC_TIMEOUT_MS)
    await rejected

    expect(MOBILE_RPC_TIMEOUT_MS).toBe(15_000)
    expect(requestSignal?.aborted).toBe(true)
  })

  it('preserves an explicit caller abort', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }))

    const pending = callUnary('session.history', { sessionId: 'session-cancelled' }, controller.signal)
    const rejected = expect(pending).rejects.toThrow('transport failed: aborted')

    controller.abort()
    await rejected
  })
})
