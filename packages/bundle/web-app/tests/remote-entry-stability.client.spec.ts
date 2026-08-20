// @vitest-environment jsdom
/** Browser regressions for bounded and recoverable mobile pairing requests. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  issuePair,
  PAIR_ISSUE_TIMEOUT_MS,
  PAIR_STOP_TIMEOUT_MS,
  stopPair,
  type PairStateFrame,
} from '../node_modules/@linxin666/dsh-remote-web-ui/src/client/pair-api.ts'

type ElementFactory = (component: unknown, props: Record<string, unknown>) => unknown
type EntryComponent = (props: Record<string, unknown>) => unknown
interface SharedEventSourceOptions {
  url: string
  key: string
  onMessage(data: string): void
  onCoordinationError(error: unknown): void
}
type SharedEventSourceSubscribe = (options: SharedEventSourceOptions) => () => void

let createElement: ElementFactory
let RemoteEntry: EntryComponent
let retryDelays: readonly number[]

beforeAll(async () => {
  const react = await vi.importActual('react') as { createElement: ElementFactory }
  const modulePath = [
    '../node_modules/@linxin666/dsh-remote-web-ui/src/client',
    'RemoteEntry.tsx',
  ].join('/')
  const entry = await vi.importActual(modulePath) as {
    RemoteEntry: EntryComponent
    PAIR_RETRY_DELAYS_MS: readonly number[]
  }
  createElement = react.createElement
  RemoteEntry = entry.RemoteEntry
  retryDelays = entry.PAIR_RETRY_DELAYS_MS
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closeCalls = 0

  constructor(url: string | URL) {
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closeCalls += 1
  }

  emit(frame: PairStateFrame): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }))
  }
}

function tunnelFrame(url: string): PairStateFrame {
  return {
    type: 'state',
    phase: 'lan-required',
    lanAvailable: false,
    deviceCount: 0,
    onlineCount: 0,
    tunnel: { state: 'running', url },
  }
}

function failedTunnelFrame(error: string): PairStateFrame {
  return {
    type: 'state',
    phase: 'lan-required',
    lanAvailable: false,
    deviceCount: 0,
    onlineCount: 0,
    tunnel: { state: 'failed', error },
  }
}

function issueResponse(publicBaseUrl: string, token: string): Response {
  return new Response(JSON.stringify({
    ok: true,
    url: `${publicBaseUrl}/m?pair=${token}`,
    token,
    expiresAt: Date.now() + 60_000,
    lanAddresses: [],
    publicBaseUrl,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function renderEntry(subscribe?: SharedEventSourceSubscribe): ReturnType<typeof render> {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  const useWorkspaces = ((selector: (state: { recentWorkspaceId?: string }) => unknown) => {
    return selector({ recentWorkspaceId: 'workspace-1' })
  })
  const t = (key: string, params?: Record<string, unknown>): string => {
    return params === undefined ? key : `${key}:${JSON.stringify(params)}`
  }
  const defaultSubscribe: SharedEventSourceSubscribe = (options) => {
    const source = new FakeEventSource(options.url)
    source.onmessage = (event) => { options.onMessage(event.data) }
    return () => {
      source.onmessage = null
      source.onerror = null
      source.close()
    }
  }
  const sharedEventSource = { subscribe: subscribe ?? defaultSubscribe }
  return render(createElement(RemoteEntry, { wide: true, useWorkspaces, t, sharedEventSource }) as never)
}

async function settlePromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('mobile remote pairing lifecycle', () => {
  it('routes pair status through the cross-tab event-source coordinator', async () => {
    const publicBaseUrl = 'https://shared.trycloudflare.com'
    vi.stubGlobal('fetch', vi.fn(async () => issueResponse(publicBaseUrl, 'shared-token')))
    const subscribe = vi.fn<SharedEventSourceSubscribe>(() => () => {})
    renderEntry(subscribe)

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await waitFor(() => { expect(subscribe).toHaveBeenCalledOnce() })

    expect(subscribe.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      url: '/api/pair/events',
      key: 'remote-pair-events',
    }))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('aborts a pairing request that cannot settle', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = issuePair()
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(PAIR_ISSUE_TIMEOUT_MS)
    await rejected

    expect(PAIR_ISSUE_TIMEOUT_MS).toBe(8_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('aborts a stop request that cannot settle', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const request = stopPair()
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(PAIR_STOP_TIMEOUT_MS)
    await rejected

    expect(PAIR_STOP_TIMEOUT_MS).toBe(8_000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps access active when stopping fails and only reports stopped after a successful retry', async () => {
    const publicBaseUrl = 'https://stop-check.trycloudflare.com'
    let resolveRetry: ((response: Response) => void) | undefined
    const requestUrl = (input: RequestInfo | URL): string => typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : input.url
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = requestUrl(input)
      if (url === '/api/pair/issue') return Promise.resolve(issueResponse(publicBaseUrl, 'stop-token'))
      if (fetchMock.mock.calls.filter(([request]) => requestUrl(request) === '/api/pair/stop').length === 1) {
        return Promise.resolve(new Response(null, { status: 503 }))
      }
      return new Promise<Response>((resolve) => { resolveRetry = resolve })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await screen.findByText(`${publicBaseUrl}/m?pair=stop-token`)

    fireEvent.click(screen.getByRole('button', { name: 'action.stop' }))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('stop.failed')
    })
    expect(screen.queryByText('status.stopped')).toBeNull()
    expect(screen.getByText('status.waiting')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'action.stop' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'action.stopping' })).toHaveProperty('disabled', true)
    })
    act(() => { resolveRetry?.(new Response(null, { status: 204 })) })

    await waitFor(() => { expect(screen.getByText('status.stopped')).toBeTruthy() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('waits through the initial 409 and mints one QR when the tunnel becomes ready', async () => {
    const publicBaseUrl = 'https://first.trycloudflare.com'
    const fetchMock = vi.fn(async (): Promise<Response> => {
      if (fetchMock.mock.calls.length === 1) return new Response(null, { status: 409 })
      return issueResponse(publicBaseUrl, 'token-1')
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(FakeEventSource.instances).toHaveLength(1) })
    expect(FakeEventSource.instances[0]!.url).toBe('/api/pair/events')
    expect(screen.getByRole('alert').textContent).toContain('status.lanRequired')

    act(() => {
      FakeEventSource.instances[0]!.emit(tunnelFrame(publicBaseUrl))
      FakeEventSource.instances[0]!.emit(tunnelFrame(publicBaseUrl))
    })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(screen.getByText(`${publicBaseUrl}/m?pair=token-1`)).toBeTruthy() })

    act(() => { FakeEventSource.instances[0]!.emit(tunnelFrame(publicBaseUrl)) })
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const staleMessage = FakeEventSource.instances[0]!.onmessage
    view.unmount()
    expect(FakeEventSource.instances[0]!.closeCalls).toBe(1)
    expect(FakeEventSource.instances[0]!.onmessage).toBeNull()
    act(() => { staleMessage?.(new MessageEvent('message', { data: JSON.stringify(tunnelFrame('https://stale.example')) })) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows the tunnel failure received after an initial 409', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await waitFor(() => { expect(FakeEventSource.instances).toHaveLength(1) })
    expect(screen.getByRole('alert').textContent).toContain('status.lanRequired')

    act(() => { FakeEventSource.instances[0]!.emit(failedTunnelFrame('cloudflared exited')) })

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('tunnel.failedTitle')
      expect(alert.textContent).toContain('cloudflared exited')
    })
  })

  it('aborts a pending retry and isolates it from a reopened panel run', async () => {
    const replacementBaseUrl = 'https://replacement.trycloudflare.com'
    let pendingRetryAborted = false
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      switch (fetchMock.mock.calls.length) {
        case 1:
        case 3:
          return Promise.resolve(new Response(null, { status: 409 }))
        case 2:
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              pendingRetryAborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            }, { once: true })
          })
        default:
          return Promise.resolve(issueResponse(replacementBaseUrl, 'token-2'))
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const view = renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await waitFor(() => { expect(FakeEventSource.instances).toHaveLength(1) })
    const firstSource = FakeEventSource.instances[0]!
    const staleMessage = firstSource.onmessage
    act(() => { firstSource.emit(tunnelFrame('https://pending.trycloudflare.com')) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })

    fireEvent.click(screen.getByRole('button', { name: 'close.label' }))
    await waitFor(() => { expect(pendingRetryAborted).toBe(true) })
    expect(firstSource.closeCalls).toBe(1)
    expect(firstSource.onmessage).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(3) })
    await waitFor(() => { expect(FakeEventSource.instances).toHaveLength(2) })
    act(() => {
      staleMessage?.(new MessageEvent('message', { data: JSON.stringify(tunnelFrame('https://stale.example')) }))
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    act(() => { FakeEventSource.instances[1]!.emit(tunnelFrame(replacementBaseUrl)) })
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(4) })
    await waitFor(() => { expect(screen.getByText(`${replacementBaseUrl}/m?pair=token-2`)).toBeTruthy() })

    view.unmount()
    expect(FakeEventSource.instances[1]!.closeCalls).toBe(1)
  })

  it('keeps an immediate retry action and cancels the backoff after success', async () => {
    vi.useFakeTimers()
    const publicBaseUrl = 'https://manual-retry.trycloudflare.com'
    const fetchMock = vi.fn(async (): Promise<Response> => {
      if (fetchMock.mock.calls.length === 1) throw new TypeError('temporary network failure')
      return issueResponse(publicBaseUrl, 'manual-token')
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('status.unreachable')

    fireEvent.click(screen.getByRole('button', { name: 'action.retry' }))
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByText(`${publicBaseUrl}/m?pair=manual-token`)).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off transient failures and stops after the bounded attempt budget', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('pairing service temporarily unavailable')
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    for (const [index, delay] of retryDelays.entries()) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
      expect(fetchMock).toHaveBeenCalledTimes(index + 1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(fetchMock).toHaveBeenCalledTimes(index + 2)
    }

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1 + retryDelays.length)
    expect(screen.getByRole('button', { name: 'action.retry' })).toBeTruthy()
  })

  it.each([403, 409])('does not blindly retry deterministic HTTP %s refusals', async (status) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(null, { status }))
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resets backoff and retries immediately when the tunnel host changes', async () => {
    vi.useFakeTimers()
    const replacementBaseUrl = 'https://replacement-host.trycloudflare.com'
    const fetchMock = vi.fn(async (): Promise<Response> => {
      if (fetchMock.mock.calls.length < 3) throw new TypeError('temporary network failure')
      return issueResponse(replacementBaseUrl, 'replacement-token')
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await settlePromises()
    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]!

    act(() => { source.emit(tunnelFrame('https://first-host.trycloudflare.com')) })
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    act(() => { source.emit(tunnelFrame('https://first-host.trycloudflare.com/changed-path')) })
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    act(() => { source.emit(tunnelFrame(replacementBaseUrl)) })
    await settlePromises()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.getByText(`${replacementBaseUrl}/m?pair=replacement-token`)).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('cancels a scheduled retry and status listener when the panel closes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('temporary network failure')
    })
    vi.stubGlobal('fetch', fetchMock)
    renderEntry()

    fireEvent.click(screen.getByRole('button', { name: 'entry.label' }))
    await settlePromises()
    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]!

    fireEvent.click(screen.getByRole('button', { name: 'close.label' }))
    expect(source.closeCalls).toBe(1)
    expect(source.onmessage).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
