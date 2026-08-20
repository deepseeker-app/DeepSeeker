// @vitest-environment jsdom
/** Cold-start concurrency and teardown coverage for the patched Web UI settings bridge. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PLUGIN_ID = '@linxin666/dsh-client-ui-web-ui-settings'
const runtimeRequire = createRequire(import.meta.url)
const NAMESPACES = ['dsh-ssh', 'describe-image', 'live-stats', 'pet', 'remote-web-ui', 'skin-background', 'task-board']

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => { apply(ctx: Context): void; inject: string[] }
}

type LoaderWindow = Window & { __ModuleLoader__?: { load(handoff: Handoff): void } }

interface MountedBridge {
  binder: { bind<T>(spec: { namespace: string }): SettingsScope<T> }
  fiber: { await(): Promise<unknown>; dispose(): Promise<void> }
  primaries: Array<StubSettingsScope<Record<string, unknown>>>
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as LoaderWindow).__ModuleLoader__
  for (const element of document.querySelectorAll('style')) element.remove()
})

async function loadArtifact(): Promise<Handoff['factory'] extends (...args: never[]) => infer R ? R : never> {
  let handoff: Handoff | undefined
  ;(window as LoaderWindow).__ModuleLoader__ = { load: (value) => { handoff = value } }
  const code = readFileSync(resolve('packages/bundle/web-app/node_modules/@linxin666/dsh-client-ui-web-ui-settings/lib/client.js'), 'utf8')
  // Deliberate execution of the shipped client artifact under its real loader handoff.
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
  new Function(code)()
  expect(handoff?.id).toBe(PLUGIN_ID)
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/cordis', await import('@deepseek-ai/cordis')],
    ['@deepseek-ai/dsh-client-runtime/client', await import('@deepseek-ai/dsh-client-runtime/client')],
    ['react', runtimeRequire('react')],
    ['react/jsx-runtime', runtimeRequire('react/jsx-runtime')],
  ])
  return handoff!.factory((specifier) => {
    const module = modules.get(specifier)
    if (module === undefined) throw new Error(`unexpected client require: ${specifier}`)
    return module
  })
}

async function mountBridge(): Promise<MountedBridge> {
  const plugin = await loadArtifact()
  const ctx = new Context()
  const primaries: MountedBridge['primaries'] = []
  ctx.provide('slots', { inject: () => () => {} } as never)
  ctx.provide('locale', { register: () => () => {} } as never)
  ctx.provide('connection', { isLoopback: true } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', {
    bind: () => {
      const primary = stubSettingsScope<Record<string, unknown>>()
      primary.publish({ status: 'unavailable' })
      primaries.push(primary)
      return primary.scope
    },
  } as never)
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  return {
    binder: ctx.get('webUiSettings') as MountedBridge['binder'],
    fiber,
    primaries,
  }
}

function successfulDescribeResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      value: {
        namespaces: NAMESPACES.map(ns => ({
          ns,
          value: { enabled: true },
          base: { enabled: true },
          revision: 0,
        })),
        writable: true,
      },
    }),
  } as Response
}

function successfulMutationResponse(namespace: string): Response {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      value: {
        ns: namespace,
        value: { enabled: false },
        base: { enabled: true },
        user: { enabled: false },
        revision: 1,
      },
    }),
  } as Response
}

function rejectWhenAborted(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError'))
    }
    if (signal.aborted) rejectAbort()
    else signal.addEventListener('abort', rejectAbort, { once: true })
  })
}

describe('patched Web UI settings bridge artifact', () => {
  it('coalesces namespace reads and retries one cold-start timeout', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) return rejectWhenAborted(init!.signal as AbortSignal)
      return Promise.resolve(successfulDescribeResponse())
    })
    vi.stubGlobal('fetch', fetchFn)

    const mounted = await mountBridge()
    const scopes = NAMESPACES.map(namespace => mounted.binder.bind<Record<string, unknown>>({ namespace }))
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_100)
    await Promise.resolve()
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(scopes.every(scope => scope.getSnapshot().status === 'ready')).toBe(true)
    expect(error).not.toHaveBeenCalled()

    await mounted.fiber.dispose()
    expect(mounted.primaries.every(primary => primary.listenerCount() === 0)).toBe(true)
  })

  it('aborts an in-flight read quietly when the plugin is disposed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init!.signal as AbortSignal
      return rejectWhenAborted(requestSignal)
    }))

    const mounted = await mountBridge()
    mounted.binder.bind<Record<string, unknown>>({ namespace: NAMESPACES[0]! })
    await Promise.resolve()
    await Promise.resolve()
    expect(requestSignal?.aborted).toBe(false)

    await mounted.fiber.dispose()
    await Promise.resolve()
    expect(requestSignal?.aborted).toBe(true)
    expect(error).not.toHaveBeenCalled()
    expect(mounted.primaries[0]?.listenerCount()).toBe(0)
  })

  it('passes save cancellation through the fallback bridge and ignores a late response', async () => {
    const lateMutation = Promise.withResolvers<Response>()
    let mutationSignal: AbortSignal | undefined
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (fetchFn.mock.calls.length === 1) return Promise.resolve(successfulDescribeResponse())
      mutationSignal = init?.signal as AbortSignal
      return lateMutation.promise
    })
    vi.stubGlobal('fetch', fetchFn)
    const mounted = await mountBridge()
    const scope = mounted.binder.bind<Record<string, unknown>>({ namespace: 'remote-web-ui' })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const controller = new AbortController()
    const reason = new Error('settings card deadline elapsed')
    const write = scope.set('enabled', false, controller.signal)
    await vi.waitFor(() => { expect(fetchFn).toHaveBeenCalledTimes(2) })

    controller.abort(reason)

    await expect(write).rejects.toBe(reason)
    expect(mutationSignal?.aborted).toBe(true)
    lateMutation.resolve(successfulMutationResponse('remote-web-ui'))
    await mounted.fiber.dispose()
    expect(scope.getSnapshot()).toMatchObject({ value: { enabled: true }, revision: 0 })
  })
})
