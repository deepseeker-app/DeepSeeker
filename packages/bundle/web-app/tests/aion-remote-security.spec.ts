import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  isRemoteSensitivePath,
  registerPanelRoutes,
} from '@linxin666/dsh-client-ui-aionui-panel/src/host/routes.ts'
import type { FsService } from '@linxin666/dsh-client-ui-aionui-panel/src/host/fs-service.ts'
import type { GitService as AionGitService } from '@linxin666/dsh-client-ui-aionui-panel/src/host/git-service.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface CapturedRoute {
  path: string
  handler(request: IncomingMessage, response: ServerResponse): Promise<void> | void
}

interface RecordedResponse {
  response: ServerResponse
  status(): number
  body(): string
  ends(): number
}

interface PanelHarness {
  routes: Map<string, CapturedRoute>
  fs: FsService
  readFile: ReturnType<typeof vi.fn>
  git: AionGitService
  setDecision(next: 'allow' | 'deny' | undefined): void
  authorizationChanged(): void
  dispose(): void
  watchDisposals(): number
}

function request(options: {
  url: string
  method?: string
  body?: unknown
  loopback?: boolean
}): IncomingMessage {
  const emitter = new EventEmitter() as EventEmitter & Record<PropertyKey, unknown>
  emitter.method = options.method ?? 'POST'
  emitter.url = options.url
  emitter.headers = {
    host: options.loopback === true ? '127.0.0.1:3091' : 'deepseeker.example',
    origin: options.loopback === true ? 'http://127.0.0.1:3091' : 'https://deepseeker.example',
    ...(options.method === 'GET' ? {} : { 'content-type': 'application/json' }),
  }
  emitter.socket = { remoteAddress: options.loopback === true ? '127.0.0.1' : '198.51.100.9' }
  emitter.destroy = vi.fn()
  emitter[Symbol.asyncIterator] = async function* () {
    if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body))
  }
  return emitter as unknown as IncomingMessage
}

function responseRecorder(): RecordedResponse {
  let status = 0
  let body = ''
  let ends = 0
  const response = new EventEmitter() as EventEmitter & Record<string, unknown>
  response.writeHead = (next: number) => {
    status = next
    return response
  }
  response.write = (chunk: string | Buffer) => {
    body += chunk.toString()
    return true
  }
  response.end = (chunk?: string | Buffer) => {
    if (chunk !== undefined) body += chunk.toString()
    ends += 1
    return response
  }
  return {
    response: response as unknown as ServerResponse,
    status: () => status,
    body: () => body,
    ends: () => ends,
  }
}

function makePanelHarness(): PanelHarness {
  const routes = new Map<string, CapturedRoute>()
  let decision: 'allow' | 'deny' | undefined = 'allow'
  let changed: (() => void) | undefined
  let watchDisposals = 0
  const readFile = vi.fn(async (_root: string, path: string) => ({ path, content: 'ok', mtime: 1, size: 2 }))
  const fs = {
    verify: vi.fn(async (root: string) => ({ ok: true, canonical: root })),
    watch: vi.fn(() => () => { watchDisposals += 1 }),
    list: vi.fn(async (root: string) => ({
      root,
      path: '',
      entries: [
        { name: 'src', path: 'src', kind: 'directory' },
        { name: '.env', path: '.env', kind: 'file' },
      ],
    })),
    read: readFile,
    readRaw: vi.fn(async () => ({ data: Buffer.from('ok'), mime: 'text/plain', size: 2 })),
    write: vi.fn(async (_root: string, path: string) => ({ path, mtime: 2, size: 2 })),
    search: vi.fn(async (root: string) => ({
      root,
      query: '',
      hits: [
        { path: 'src/index.ts', name: 'index.ts' },
        { path: '.ssh/id_ed25519', name: 'id_ed25519' },
      ],
    })),
    delete: vi.fn(async () => ({ ok: true })),
  } as unknown as FsService
  const status = {
    root: '/workspace',
    branch: 'main',
    staged: [{ path: '.git/config', state: 'modified', staged: true }],
    unstaged: [{ path: 'src/index.ts', state: 'modified', staged: false }],
    untracked: [{ path: '.env.local', state: 'untracked', staged: false }],
  } as const
  const git = {
    gitAvailable: vi.fn(async () => true),
    status: vi.fn(async () => status),
    diff: vi.fn(async () => ({ content: 'diff' })),
    stage: vi.fn(async () => ({ applied: [], status })),
    unstage: vi.fn(async () => ({ applied: [], status })),
    discard: vi.fn(async () => ({ applied: [], status })),
  } as unknown as AionGitService
  const context = {
    webServer: {
      register(route: CapturedRoute) {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
    logger: { warn: vi.fn() },
    bail: () => decision,
    on(event: string, listener: () => void) {
      if (event === 'remote-web-ui/authorization-changed') changed = listener
      return () => { if (changed === listener) changed = undefined }
    },
  } as unknown as Context
  const dispose = registerPanelRoutes(context, fs, git)
  return {
    routes,
    fs,
    readFile,
    git,
    setDecision(next) { decision = next },
    authorizationChanged() { changed?.() },
    dispose,
    watchDisposals: () => watchDisposals,
  }
}

async function invoke(
  route: CapturedRoute,
  options: Parameters<typeof request>[0],
): Promise<RecordedResponse> {
  const recorder = responseRecorder()
  await route.handler(request(options), recorder.response)
  return recorder
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Aion paired-device file fence', () => {
  it.each([
    '.git/config',
    '.env',
    '.environment',
    'nested\\.ssh\\id_rsa',
    '.npmrc',
    '.yarnrc.yml',
    '.pnpmfile.cjs',
    'certs/client.PEM',
    'certs/client.p12',
    'keys/id_ed25519',
  ])('classifies %s as sensitive after separator normalization', (path) => {
    expect(isRemoteSensitivePath(path)).toBe(true)
  })

  it.each(['src/index.ts', '.github/workflows/ci.yml', 'docs/architecture.md'])('keeps %s remotely visible', (path) => {
    expect(isRemoteSensitivePath(path)).toBe(false)
  })

  it('blocks every sensitive read or mutation for paired phones while loopback keeps desktop access', async () => {
    const harness = makePanelHarness()
    const route = harness.routes.get('/aionui-panel')
    if (route === undefined) throw new Error('Aion route not registered')
    const cases = [
      ['/aionui-panel/read', { root: '/workspace', path: '.env.local' }],
      ['/aionui-panel/write', { root: '/workspace', path: '.env.production', content: 'secret' }],
      ['/aionui-panel/delete', { root: '/workspace', path: '.ssh\\id_ed25519' }],
      ['/aionui-panel/git-diff', { root: '/workspace', path: '.git\\config' }],
      ['/aionui-panel/git-stage', { root: '/workspace', paths: ['src/index.ts', '.npmrc'] }],
      ['/aionui-panel/git-unstage', { root: '/workspace', paths: ['client.key'] }],
      ['/aionui-panel/git-discard', { root: '/workspace', paths: ['certs/client.p12'] }],
    ] as const
    for (const [url, body] of cases) {
      expect((await invoke(route, { url, body })).status()).toBe(403)
    }
    expect((await invoke(route, {
      url: '/aionui-panel/raw?root=%2Fworkspace&path=.env',
      method: 'GET',
    })).status()).toBe(403)

    const desktop = await invoke(route, {
      url: '/aionui-panel/read',
      body: { root: '/workspace', path: '.env.local' },
      loopback: true,
    })
    expect(desktop.status()).toBe(200)
    expect(harness.readFile).toHaveBeenCalledWith('/workspace', '.env.local', false)
    harness.dispose()
  })

  it('filters sensitive rows from paired list, search, and status responses', async () => {
    const harness = makePanelHarness()
    const route = harness.routes.get('/aionui-panel')
    if (route === undefined) throw new Error('Aion route not registered')
    const list = JSON.parse((await invoke(route, {
      url: '/aionui-panel/list',
      body: { root: '/workspace', path: '' },
    })).body()) as { value: { entries: Array<{ path: string }> } }
    const search = JSON.parse((await invoke(route, {
      url: '/aionui-panel/search',
      body: { root: '/workspace', query: '' },
    })).body()) as { value: { hits: Array<{ path: string }> } }
    const status = JSON.parse((await invoke(route, {
      url: '/aionui-panel/git-status',
      body: { root: '/workspace' },
    })).body()) as { value: { staged: unknown[]; unstaged: unknown[]; untracked: unknown[] } }

    expect(list.value.entries.map(row => row.path)).toEqual(['src'])
    expect(search.value.hits.map(row => row.path)).toEqual(['src/index.ts'])
    expect(status.value).toMatchObject({ staged: [], unstaged: [{ path: 'src/index.ts' }], untracked: [] })
    harness.dispose()
  })

  it('rejects revoked requests and immediately closes only the denied paired SSE', async () => {
    const harness = makePanelHarness()
    const route = harness.routes.get('/aionui-panel')
    const events = harness.routes.get('/aionui-panel/events')
    if (route === undefined || events === undefined) throw new Error('Aion routes not registered')
    const pairedResponse = responseRecorder()
    await events.handler(request({ url: '/aionui-panel/events?root=%2Fworkspace', method: 'GET' }), pairedResponse.response)
    const loopbackResponse = responseRecorder()
    await events.handler(request({
      url: '/aionui-panel/events?root=%2Fworkspace',
      method: 'GET',
      loopback: true,
    }), loopbackResponse.response)

    harness.setDecision(undefined)
    harness.authorizationChanged()
    expect(pairedResponse.ends()).toBe(0)
    harness.setDecision('deny')
    harness.authorizationChanged()
    expect(pairedResponse.ends()).toBe(1)
    expect(loopbackResponse.ends()).toBe(0)
    expect(harness.watchDisposals()).toBe(1)
    expect((await invoke(route, {
      url: '/aionui-panel/read',
      body: { root: '/workspace', path: 'src/index.ts' },
    })).status()).toBe(403)

    harness.dispose()
    expect(loopbackResponse.ends()).toBe(1)
  })
})
