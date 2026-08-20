// @vitest-environment jsdom
/** Request-bounding and teardown coverage for the patched pet client artifact. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PLUGIN_ID = '@linxin666/dsh-pet'
const runtimeRequire = createRequire(import.meta.url)

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => { apply(ctx: Context): void; inject: string[] }
}

type LoaderWindow = Window & { __ModuleLoader__?: { load(handoff: Handoff): void } }

interface RenderedPet {
  props: {
    ensure(): void
    store: {
      getSnapshot(): { state: string }
    }
  }
}

interface DeferredRequest {
  signal: AbortSignal
  resolve(response: Response): void
}

interface MountedPet {
  fiber: { await(): Promise<unknown>; dispose(): Promise<void> }
  createRoot: ReturnType<typeof vi.fn>
  rendered: () => RenderedPet
  scope: StubSettingsScope<Record<string, unknown>>
  unmount: ReturnType<typeof vi.fn>
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as LoaderWindow).__ModuleLoader__
  document.body.replaceChildren()
})

function successfulStateResponse(): Response {
  return {
    ok: true,
    json: async () => ({ state: 'idle', display: { visible: true, size: 160, right: 24, bottom: 20 } }),
  } as Response
}

function pendingResponse(signal: AbortSignal, requests: DeferredRequest[]): Promise<Response> {
  return new Promise((resolve, reject) => {
    const rejectAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      rejectAbort()
      return
    }
    signal.addEventListener('abort', rejectAbort, { once: true })
    requests.push({ signal, resolve })
  })
}

async function loadArtifact(createRoot: ReturnType<typeof vi.fn>): Promise<ReturnType<Handoff['factory']>> {
  let handoff: Handoff | undefined
  ;(window as LoaderWindow).__ModuleLoader__ = { load: (value) => { handoff = value } }
  const code = readFileSync(resolve('packages/bundle/web-app/node_modules/@linxin666/dsh-pet/lib/client.js'), 'utf8')
  // Deliberate execution of the shipped client artifact under its real loader handoff.
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
  new Function(code)()
  expect(handoff?.id).toBe(PLUGIN_ID)
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-client-runtime/client', await import('@deepseek-ai/dsh-client-runtime/client')],
    ['react', runtimeRequire('react')],
    ['react-dom/client', { createRoot }],
    ['react-dom', runtimeRequire('react-dom')],
    ['react/jsx-runtime', runtimeRequire('react/jsx-runtime')],
  ])
  return handoff!.factory((specifier) => {
    const module = modules.get(specifier)
    if (module === undefined) throw new Error(`unexpected client require: ${specifier}`)
    return module
  })
}

async function mountPet(isLoopback = true): Promise<MountedPet> {
  let rendered: RenderedPet | undefined
  const unmount = vi.fn()
  const createRoot = vi.fn(() => ({
    render: (element: RenderedPet) => { rendered = element },
    unmount,
  }))
  const plugin = await loadArtifact(createRoot)
  const ctx = new Context()
  const scope = stubSettingsScope<Record<string, unknown>>()
  scope.publish({ status: 'ready', value: { enabled: true }, revision: 0 })
  ctx.provide('slots', {
    inject: () => () => {},
    register: () => () => {},
  } as never)
  ctx.provide('locale', { register: () => () => {} } as never)
  ctx.provide('connection', { isLoopback } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => scope.scope } as never)
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  return {
    fiber,
    createRoot,
    rendered: () => {
      if (rendered === undefined) throw new Error('pet was not rendered')
      return rendered
    },
    scope,
    unmount,
  }
}

describe('patched pet client artifact', () => {
  it('does not mount or poll on a remote page', async () => {
    const fetchFn = vi.fn()
    vi.stubGlobal('fetch', fetchFn)

    const mounted = await mountPet(false)

    expect(fetchFn).not.toHaveBeenCalled()
    expect(mounted.createRoot).not.toHaveBeenCalled()
    expect(mounted.scope.listenerCount()).toBe(0)
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()

    await mounted.fiber.dispose()
  })

  it('keeps one state request in flight and resumes on the self-scheduled poll', async () => {
    vi.useFakeTimers()
    const requests: DeferredRequest[] = []
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return pendingResponse(init!.signal as AbortSignal, requests)
    })
    vi.stubGlobal('fetch', fetchFn)

    const mounted = await mountPet()
    expect(fetchFn).toHaveBeenCalledTimes(1)

    mounted.rendered().props.ensure()
    mounted.rendered().props.ensure()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fetchFn).toHaveBeenCalledTimes(1)

    requests[0]!.resolve(successfulStateResponse())
    await vi.advanceTimersByTimeAsync(0)
    expect(mounted.rendered().props.store.getSnapshot().state).toBe('ready')

    await vi.advanceTimersByTimeAsync(799)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await mounted.fiber.dispose()
  })

  it('aborts a stalled poll and backs off instead of retrying every 800 ms', async () => {
    vi.useFakeTimers()
    const requests: DeferredRequest[] = []
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return pendingResponse(init!.signal as AbortSignal, requests)
    })
    vi.stubGlobal('fetch', fetchFn)

    const mounted = await mountPet()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(requests[0]!.signal.aborted).toBe(true)
    expect(mounted.rendered().props.store.getSnapshot().state).toBe('error')

    await vi.advanceTimersByTimeAsync(1_599)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await mounted.fiber.dispose()
  })

  it('aborts a stuck poll and removes every page-lifetime resource on dispose', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const requests: DeferredRequest[] = []
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return pendingResponse(init!.signal as AbortSignal, requests)
    }))

    const mounted = await mountPet()
    expect(requests).toHaveLength(1)
    expect(document.querySelectorAll('[data-dsh-pet-root]')).toHaveLength(1)
    expect(mounted.scope.listenerCount()).toBe(2)

    await mounted.fiber.dispose()
    await Promise.resolve()

    expect(requests[0]!.signal.aborted).toBe(true)
    expect(mounted.scope.listenerCount()).toBe(0)
    expect(mounted.unmount).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-dsh-pet-root]')).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
})
