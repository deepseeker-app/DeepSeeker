import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { GitService } from '@linxin666/dsh-client-ui-git-graph/src/host/git-service.ts'
import { registerGitRoutes } from '@linxin666/dsh-client-ui-git-graph/src/host/routes.ts'
import { describe, expect, it, vi } from 'vitest'

interface Route {
  path: string
  handler(request: IncomingMessage, response: ServerResponse): Promise<void> | void
}

function request(url: string, options: { body?: unknown; loopback?: boolean; method?: string } = {}): IncomingMessage {
  const emitter = new EventEmitter() as EventEmitter & Record<PropertyKey, unknown>
  emitter.url = url
  emitter.method = options.method ?? 'POST'
  emitter.headers = {
    host: options.loopback === true ? '127.0.0.1:3091' : 'deepseeker.example',
    origin: options.loopback === true ? 'http://127.0.0.1:3091' : 'https://deepseeker.example',
    ...(options.method === 'GET' ? {} : { 'content-type': 'application/json' }),
  }
  emitter.socket = { remoteAddress: options.loopback === true ? '127.0.0.1' : '198.51.100.10' }
  emitter.destroy = vi.fn()
  emitter[Symbol.asyncIterator] = async function* () {
    if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
  }
  return emitter as unknown as IncomingMessage
}

function responseRecorder(): { response: ServerResponse; status(): number; ends(): number } {
  let status = 0
  let ends = 0
  const response = new EventEmitter() as EventEmitter & Record<string, unknown>
  response.writeHead = (next: number) => {
    status = next
    return response
  }
  response.write = () => true
  response.end = () => {
    ends += 1
    return response
  }
  return { response: response as unknown as ServerResponse, status: () => status, ends: () => ends }
}

function harness(): {
  routes: Map<string, Route>
  service: GitService
  switchBranch: ReturnType<typeof vi.fn>
  createBranch: ReturnType<typeof vi.fn>
  decision(next: 'allow' | 'deny' | undefined): void
  authorizationChanged(): void
  dispose(): void
} {
  const routes = new Map<string, Route>()
  let auth: 'allow' | 'deny' | undefined = 'allow'
  let changed: (() => void) | undefined
  const repository = { root: '/workspace', branch: 'main', head: 'abc123', dirtyFiles: 0 }
  const switchBranch = vi.fn(async (_path: string, branch: string) => ({ ok: true, branch }))
  const createBranch = vi.fn(async (_path: string, name: string) => ({ ok: true, branch: name }))
  const service = {
    status: vi.fn(async () => repository),
    branches: vi.fn(async () => ({ ...repository, branches: [], untrackedFiles: 0, conflicts: 0, operationInProgress: false })),
    graph: vi.fn(async () => ({ root: '/workspace', branch: 'main', commits: [], hasMore: false })),
    switchBranch,
    createBranch,
  } as unknown as GitService
  const context = {
    webServer: {
      register(route: Route) {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
    logger: { warn: vi.fn() },
    bail: () => auth,
    on(event: string, listener: () => void) {
      if (event === 'remote-web-ui/authorization-changed') changed = listener
      return () => { if (changed === listener) changed = undefined }
    },
  } as unknown as Context
  const dispose = registerGitRoutes(context, service)
  return {
    routes,
    service,
    switchBranch,
    createBranch,
    decision(next) { auth = next },
    authorizationChanged() { changed?.() },
    dispose,
  }
}

async function invoke(route: Route, requestValue: IncomingMessage): Promise<ReturnType<typeof responseRecorder>> {
  const recorder = responseRecorder()
  await route.handler(requestValue, recorder.response)
  return recorder
}

describe('Git graph remote authorization', () => {
  it('allows paired reads but keeps branch switch and creation loopback-only', async () => {
    const value = harness()
    const route = value.routes.get('/git')
    if (route === undefined) throw new Error('Git route not registered')
    expect((await invoke(route, request('/git/status', { body: { path: '/workspace' } }))).status()).toBe(200)
    expect((await invoke(route, request('/git/switch', { body: { path: '/workspace', branch: 'feature' } }))).status()).toBe(403)
    expect((await invoke(route, request('/git/create-branch', { body: { path: '/workspace', name: 'feature' } }))).status()).toBe(403)
    expect(value.switchBranch).not.toHaveBeenCalled()
    expect(value.createBranch).not.toHaveBeenCalled()

    expect((await invoke(route, request('/git/switch', {
      body: { path: '/workspace', branch: 'feature' },
      loopback: true,
    }))).status()).toBe(200)
    expect((await invoke(route, request('/git/create-branch', {
      body: { path: '/workspace', name: 'other' },
      loopback: true,
    }))).status()).toBe(200)
    value.dispose()
  })

  it('immediately closes a revoked paired SSE without touching loopback streams', async () => {
    const value = harness()
    const events = value.routes.get('/git/events')
    if (events === undefined) throw new Error('Git event route not registered')
    const paired = responseRecorder()
    await events.handler(request('/git/events?path=%2Fworkspace', { method: 'GET' }), paired.response)
    const loopback = responseRecorder()
    await events.handler(request('/git/events?path=%2Fworkspace', { method: 'GET', loopback: true }), loopback.response)

    value.decision(undefined)
    value.authorizationChanged()
    expect(paired.ends()).toBe(0)
    value.decision('deny')
    value.authorizationChanged()
    expect(paired.ends()).toBe(1)
    expect(loopback.ends()).toBe(0)

    value.dispose()
    expect(loopback.ends()).toBe(1)
  })
})
