/** Node half: registers the /api prefix route bridging to the api gateway. */
import { EventEmitter, once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  API_PATH,
  apply,
  HOST_EVENTS_PATH,
  inject,
  MUX_EVENTS_PATH,
  type ConnectionConfig,
  type HostConnectionHandle,
} from '../src/index.ts'

async function untilAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

async function * idleFrames(signal: AbortSignal): AsyncGenerator<never> {
  await untilAbort(signal)
}

function fakeApiProxy(): ApiProxy {
  const events: ApiProxy['events'] = {
    mux: (_request, signal) => idleFrames(signal),
    host: (_request, signal) => idleFrames(signal),
  }
  return {
    events,
  } as unknown as ApiProxy
}

/** Structural webServer fake recording both route registries. */
function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

/** Bodyless GET carrying the given headers (enough for the trust fence + bridge). */
function fakeRequest(
  headers: Record<string, string>,
  url = `${API_PATH}/session.list`,
  remoteAddress = '127.0.0.1',
): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'GET', headers, socket: { remoteAddress } })
  return request
}

/** JSON POST carrying a complete client-request envelope. */
function fakePost(headers: Record<string, string>, url: string, body: unknown): IncomingMessage {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(request, {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  })
  return request
}

/** Raw POST for malformed-body and media-type boundary cases. */
function fakeRawPost(headers: Record<string, string>, url: string, body: string): IncomingMessage {
  const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers, socket: { remoteAddress: '127.0.0.1' } })
  return request
}

/** Response recorder compatible with both the fence's short-circuit and the bridge. */
function fakeResponse(): { response: ServerResponse; state: { status?: number; body?: unknown } } {
  const state: { status?: number; body?: unknown } = {}
  const chunks: Buffer[] = []
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(value: number) { state.status = value; return this },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true },
    end(this: { writableEnded: boolean }, value?: unknown) {
      if (typeof value === 'string' || value instanceof Uint8Array) chunks.push(Buffer.from(value))
      else if (value !== undefined) throw new TypeError('fake response only accepts string or Uint8Array bodies')
      if (chunks.length > 0) state.body = Buffer.concat(chunks).toString()
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return { response, state }
}

async function mounted(config?: ConnectionConfig): Promise<{
  ctx: Context
  routes: WebRoute[]
  upgrades: WebUpgradeRoute[]
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  const upgrades: WebUpgradeRoute[] = []
  ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
  ctx.provide('apiProxy', fakeApiProxy())
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { ctx, routes, upgrades, dispose: () => fiber.dispose() }
}

describe('connection node half', () => {
  it('fails loud when the carrier cap cannot hold the configured image batch', () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    ctx.provide('attachments', {
      imageLimits: { maxMessageImageBytes: 20 * 1024 * 1024 },
    } as AttachmentStore)
    ctx.provide('apiProxy', {} as ApiProxy)
    expect(() => { apply(ctx, { maxRequestBodyBytes: 1024 }) })
      .toThrow(/must be at least .* aggregate image limit/)
    expect(routes).toHaveLength(0)
  })

  it('fails the load on a trustedHosts entry that is not a bare authority', async () => {
    const routes: WebRoute[] = []
    const upgrades: WebUpgradeRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
    ctx.provide('apiProxy', {} as unknown as ApiProxy)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.internal/path'] })
    await expect(fiber).rejects.toThrow(/not a bare host\[:port\] authority/)
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('registers one HTTP route plus one upgrade route per downlink and removes all three with the fiber', async () => {
    const { routes, upgrades, dispose } = await mounted()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })
    expect(upgrades.map(route => route.path)).toEqual([MUX_EVENTS_PATH, HOST_EVENTS_PATH])
    await dispose()
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('requires WebSocket upgrade for network GETs to either event path', async () => {
    const { routes, dispose } = await mounted()
    for (const path of [MUX_EVENTS_PATH, HOST_EVENTS_PATH]) {
      const { response, state } = fakeResponse()
      await routes[0]!.handler(fakeRequest({ host: '127.0.0.1:3080' }, path), response)
      expect(state.status).toBe(426)
      expect(state.body).toBe('upgrade required')
    }
    await dispose()
  })

  it('rejects an untrusted WebSocket upgrade before protocol negotiation', async () => {
    const { upgrades, dispose } = await mounted()
    const socket = new PassThrough()
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    const ended = once(socket, 'end')
    await upgrades[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }, MUX_EVENTS_PATH), socket, Buffer.alloc(0))
    await ended
    expect(Buffer.concat(chunks).toString()).toContain('HTTP/1.1 403 Forbidden')
    await dispose()
  })

  it('refuses an untrusted Host on any /api path before the bridge runs', async () => {
    const { routes, dispose } = await mounted()
    const { response, state } = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }), response)
    expect(state.status).toBe(403)
    expect(state.body).toBe('forbidden')
    await dispose()
  })

  it('accepts a paired remote authority without opening cross-site requests', async () => {
    const { ctx, routes, dispose } = await mounted()
    let authorizerCalls = 0
    ctx.on('remote-web-ui/authorize-http', (request) => {
      authorizerCalls += 1
      return request.headers.cookie === 'dsh_pair=paired-device' ? 'allow' : 'deny'
    })

    const paired = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'fresh-tunnel.trycloudflare.com',
      origin: 'https://fresh-tunnel.trycloudflare.com',
      'sec-fetch-site': 'same-origin',
      cookie: 'dsh_pair=paired-device',
    }), paired.response)
    expect(paired.state.status).toBe(404)
    expect(authorizerCalls).toBe(1)

    const crossSite = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'fresh-tunnel.trycloudflare.com',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      cookie: 'dsh_pair=paired-device',
    }), crossSite.response)
    expect(crossSite.state).toMatchObject({ status: 403, body: 'forbidden' })
    expect(authorizerCalls).toBe(1)
    await dispose()
  })

  it('does not let a loopback Host spoof the desktop shortcut over a remote socket', async () => {
    const { routes, dispose } = await mounted()
    const denied = fakeResponse()
    await routes[0]!.handler(fakeRequest(
      { host: '127.0.0.1:3080' },
      `${API_PATH}/session.list`,
      '203.0.113.9',
    ), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    await dispose()
  })

  it.each([
    'cf-connecting-ip',
    'x-forwarded-for',
    'forwarded',
    'x-real-ip',
  ])('does not grant the desktop shortcut when %s marks a proxy hop', async (proxyHeader) => {
    const { routes, dispose } = await mounted()
    const denied = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: '127.0.0.1:3080',
      [proxyHeader]: '203.0.113.9',
    }), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    await dispose()
  })

  it('pins privileged methods to loopback even for a declared trusted authority', async () => {
    const { ctx, routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    // Simulate a valid paired device. Authentication admits ordinary API
    // reads, but it must not turn Host settings or native actions into remote
    // capabilities.
    ctx.on('remote-web-ui/authorize-http', () => 'allow')
    // The privileged set: native dialogs plus the whole settings/credential
    // configuration plane, reads included, plus the one method that makes the
    // host fetch a caller-chosen URL. The same paired authority reaches
    // ordinary reads, but each privileged method stays loopback-only.
    for (const method of [
      'host.pickDirectory', 'host.openPath',
      'settings.describe', 'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
      'credentials.describe', 'credentials.set', 'credentials.unset',
      'llm.discoverModels',
      // A composition names the plugins a session runs: reading one is
      // reconnaissance, and copy/remove/openDocument manage the roster and
      // drive the host desktop.
      'agentPreset.read', 'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
    ]) {
      const denied = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: 'harness.example' }, `${API_PATH}/${method}`),
        denied.response,
      )
      expect(denied.state.status).toBe(403)
      expect(denied.state.body).toBe('forbidden')
    }
    const read = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: 'harness.example' }), read.response)
    expect(read.state.status).toBe(404)
    await dispose()
  })

  it('preserves declared authorities when no remote authorizer is mounted', async () => {
    const { routes, dispose } = await mounted({ trustedHosts: ['harness.example:3080', '192.168.1.5'] })
    // Loopback, no browser markers (curl shape): the fence passes; the carrier
    // answers 404 for a GET unary path — proof the bridge ran.
    const loopback = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: '127.0.0.1:3080' }), loopback.response)
    expect(loopback.state.status).toBe(404)
    // Legacy all-interface deployments use declared LAN literals without the
    // optional remote-web-ui plugin.
    const lan = fakeResponse()
    await routes[0]!.handler(fakeRequest(
      { host: '192.168.1.5:3080' },
      `${API_PATH}/session.list`,
      '192.168.1.20',
    ), lan.response)
    expect(lan.state.status).toBe(404)
    // A declared same-origin browser authority follows the same fallback.
    const declared = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example:3080', origin: 'http://harness.example:3080', 'sec-fetch-site': 'same-origin',
    }), declared.response)
    expect(declared.state.status).toBe(404)
    await dispose()
  })

  it('lets an installed remote authorizer veto a declared authority', async () => {
    const { ctx, routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    ctx.on('remote-web-ui/authorize-http', () => 'deny')
    const denied = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example',
      origin: 'http://harness.example',
      'sec-fetch-site': 'same-origin',
    }, `${API_PATH}/session.list`, '192.168.1.20'), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    await dispose()
  })

  it('provides a disposable dedicated RPC channel without requiring apiProxy', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })

    const connection = ctx.get('connection') as HostConnectionHandle
    const calls: unknown[] = []
    const remove = connection.rpc.handle('/rpc', async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { accepted: true } }
    }, { authority: 'trusted-host' })
    const route = routes.find(candidate => candidate.path === '/rpc')
    expect(route).toBeDefined()

    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-dedicated'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }
    const result = fakeResponse()
    await route!.handler(fakePost({ host: '127.0.0.1:3080' }, '/rpc/goals/create', request), result.response)
    expect(result.state.status).toBe(200)
    expect(JSON.parse(String(result.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-dedicated',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    expect(() => connection.rpc.handle('/rpc', async () => ({ ok: true, value: null }), {
      authority: 'trusted-host',
    })).toThrow(/duplicate route/)
    await remove()
    expect(routes.map(candidate => candidate.path)).toEqual([API_PATH])
    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })

  it('dispatches claimed /api endpoints before the API Proxy fallback and withdraws the claim', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    ctx.provide('apiProxy', {} as unknown as ApiProxy)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const calls: unknown[] = []
    const remove = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { accepted: true } }
      },
      { authority: 'trusted-host' },
    )
    expect(() => connection.rpc.intercept(
      '/api',
      () => true,
      async () => ({ ok: true, value: null }),
      { authority: 'trusted-host' },
    )).toThrow('already has an interceptor')
    expect(() => connection.rpc.intercept(
      '/rpc' as '/api',
      () => true,
      async () => ({ ok: true, value: null }),
      { authority: 'trusted-host' },
    )).toThrow('invalid shared RPC channel')
    const route = routes.find(candidate => candidate.path === API_PATH)!
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-shared'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }

    const claimed = fakeResponse()
    await route.handler(fakePost({ host: '127.0.0.1:3080' }, '/api/goals/create', request), claimed.response)
    expect(JSON.parse(String(claimed.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-shared',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/api/goals/create', request), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    expect(calls).toHaveLength(1)

    const unclaimed = fakeResponse()
    await route.handler(fakeRequest({ host: '127.0.0.1:3080' }, '/api/session.list'), unclaimed.response)
    expect(unclaimed.state.status).toBe(404)

    await remove()
    const withdrawn = fakeResponse()
    await route.handler(fakePost({ host: '127.0.0.1:3080' }, '/api/goals/create', request), withdrawn.response)
    expect(withdrawn.state.status).toBe(404)
    expect(calls).toHaveLength(1)

    const removeLoopback = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async () => ({ ok: true, value: null }),
      { authority: 'loopback' },
    )
    const loopbackOnly = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/api/goals/create', request), loopbackOnly.response)
    expect(loopbackOnly.state.status).toBe(403)
    await removeLoopback()
    await fiber.dispose()
  })

  it('applies the configured trust fence and JSON envelope checks to generic channels', async () => {
    const ctx = new Context()
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const remove = connection.rpc.handle('/rpc', async (endpoint) => {
      if (endpoint === 'fail') throw new Error('handler broke')
      return { ok: true, value: null }
    }, {
      authority: 'trusted-host',
    })
    const route = routes.find(candidate => candidate.path === '/rpc')!

    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/rpc/goals/create', {}), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })

    const methodMismatch = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/rpc/goals/create', {
      type: 'client-request', rpcId: 'rpc-bad', method: 'other', payload: {},
    }), methodMismatch.response)
    expect(JSON.parse(String(methodMismatch.state.body))).toMatchObject({
      rpcId: 'rpc-bad',
      result: { ok: false, error: { code: 'bad-request' } },
    })

    for (const [request, status] of [
      [fakeRequest({ host: 'harness.example' }, '/rpc/goals/create'), 404],
      [fakePost({ host: 'harness.example' }, '/outside/goals/create', {}), 404],
      [fakePost({ host: 'harness.example' }, '/rpc/goals//create', {}), 404],
      [fakeRawPost({ host: 'harness.example' }, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ host: 'harness.example', 'content-type': 'text/plain' }, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ host: 'harness.example', 'content-type': 'application/json; charset=utf-8' }, '/rpc/goals/create', '{'), 400],
    ] as const) {
      const response = fakeResponse()
      await route.handler(request, response.response)
      expect(response.state.status).toBe(status)
    }

    for (const [body, rpcId] of [
      [{ rpcId: 'retained-id' }, 'retained-id'],
      [{ rpcId: 42 }, 'invalid-request'],
      [null, 'invalid-request'],
    ] as const) {
      const response = fakeResponse()
      await route.handler(fakePost({ host: 'harness.example' }, '/rpc/goals/create', body), response.response)
      expect(JSON.parse(String(response.state.body))).toMatchObject({
        rpcId,
        result: { ok: false, error: { code: 'bad-request' } },
      })
    }

    const failed = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/rpc/fail', {
      type: 'client-request', rpcId: 'rpc-fail', method: 'fail', payload: {},
    }), failed.response)
    expect(failed.state).toMatchObject({ status: 500, body: 'handler failure: Error: handler broke' })

    expect(() => connection.rpc.handle('/api', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })).toThrow('invalid or reserved RPC channel')
    expect(() => connection.rpc.handle('api3', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })).toThrow('invalid or reserved RPC channel')

    const removeLoopback = connection.rpc.handle('/loopback', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })
    const loopbackRoute = routes.find(candidate => candidate.path === '/loopback')!
    const publicResponse = fakeResponse()
    await loopbackRoute.handler(fakePost({ host: 'harness.example' }, '/loopback/read', {
      type: 'client-request', rpcId: 'rpc-public', method: 'read', payload: {},
    }), publicResponse.response)
    expect(publicResponse.state.status).toBe(403)
    await removeLoopback()
    await remove()
    await fiber.dispose()
  })
})

describe('connection node half over a real HTTP server', () => {
  /** Serve the registered prefix route from a real server and return its port. */
  async function serve(routes: WebRoute[]): Promise<{ port: number; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
      void routes[0]!.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    return {
      port: address.port,
      close: () => new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      }),
    }
  }

  /** One real request; `host` spoofs the authority the way a LAN client's browser would send it. */
  function call(port: number, method: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, path: `${API_PATH}/${method}`, method: 'GET', headers: { host } },
        (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode ?? 0) })
        },
      )
      request.on('error', reject)
      request.end()
    })
  }

  /** One real JSON-envelope RPC POST. */
  function callRpc(port: number, method: string, host: string, payload: unknown): Promise<number> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        type: 'client-request', rpcId: `rpc-${method}`, method, payload,
      })
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `${API_PATH}/${method}`,
          method: 'POST',
          headers: {
            host,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode ?? 0) })
        },
      )
      request.on('error', reject)
      request.end(body)
    })
  }

  async function serveWithUpgrades(
    routes: WebRoute[],
    upgrades: WebUpgradeRoute[],
  ): Promise<{ port: number; close: () => Promise<void> }> {
    const server = createServer((request, response) => {
      const route = routes.find(candidate => (request.url ?? '').startsWith(candidate.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://dsh.internal').pathname
      const route = upgrades.find(candidate => candidate.path === pathname)
      if (route === undefined) {
        socket.destroy()
        return
      }
      void route.handler(request, socket, head)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    return {
      port,
      close: () => new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      }),
    }
  }

  function webSocketStatus(
    port: number,
    path: string,
    headers: Record<string, string>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, { headers })
      socket.once('open', () => {
        const closed = once(socket, 'close')
        socket.close()
        void closed.then(() => { resolve(101) }, reject)
      })
      socket.once('unexpected-response', (_request, response) => {
        const status = response.statusCode ?? 0
        response.resume()
        response.once('end', () => { resolve(status) })
      })
      socket.once('error', reject)
    })
  }

  async function openWebSocket(
    port: number,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, { headers })
    await once(socket, 'open')
    return socket
  }

  it('applies no-listener, allow, deny, and same-origin decisions to WebSocket upgrades', async () => {
    const mountedApp = await mounted({ trustedHosts: ['harness.example'] })
    const server = await serveWithUpgrades(mountedApp.routes, mountedApp.upgrades)
    try {
      expect(await webSocketStatus(server.port, MUX_EVENTS_PATH, {
        host: 'harness.example',
        origin: 'http://harness.example',
        'sec-fetch-site': 'same-origin',
      })).toBe(101)

      const removeDeny = mountedApp.ctx.on('remote-web-ui/authorize-http', () => 'deny')
      expect(await webSocketStatus(server.port, MUX_EVENTS_PATH, {
        host: 'harness.example',
        origin: 'http://harness.example',
        'sec-fetch-site': 'same-origin',
      })).toBe(403)
      removeDeny()

      mountedApp.ctx.on('remote-web-ui/authorize-http', () => 'allow')
      expect(await webSocketStatus(server.port, HOST_EVENTS_PATH, {
        host: 'fresh.trycloudflare.com',
        origin: 'https://fresh.trycloudflare.com',
        'sec-fetch-site': 'same-origin',
        cookie: 'dsh_pair=paired-device',
      })).toBe(101)
      expect(await webSocketStatus(server.port, HOST_EVENTS_PATH, {
        host: 'fresh.trycloudflare.com',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
        cookie: 'dsh_pair=paired-device',
      })).toBe(403)
    } finally {
      await mountedApp.dispose()
      await server.close()
    }
  })

  it('fails closed for HTTP and WebSocket when explicit remote authorization is required', async () => {
    const mountedApp = await mounted({
      trustedHosts: ['harness.example'],
      requireRemoteAuthorization: true,
    })
    const server = await serveWithUpgrades(mountedApp.routes, mountedApp.upgrades)
    const headers = {
      host: 'harness.example',
      origin: 'http://harness.example',
      'sec-fetch-site': 'same-origin',
    }
    try {
      expect(await call(server.port, 'session.list', 'harness.example')).toBe(403)
      expect(await webSocketStatus(server.port, MUX_EVENTS_PATH, headers)).toBe(403)

      const removeAllow = mountedApp.ctx.on('remote-web-ui/authorize-http', () => 'allow')
      expect(await call(server.port, 'session.list', 'harness.example')).toBe(404)
      expect(await webSocketStatus(server.port, HOST_EVENTS_PATH, headers)).toBe(101)

      removeAllow()
      expect(await call(server.port, 'session.list', 'harness.example')).toBe(403)
      expect(await webSocketStatus(server.port, MUX_EVENTS_PATH, headers)).toBe(403)
    } finally {
      await mountedApp.dispose()
      await server.close()
    }
  })

  it('closes an existing paired downlink after revocation without touching loopback', async () => {
    const mountedApp = await mounted({
      trustedHosts: ['harness.example'],
      requireRemoteAuthorization: true,
    })
    let authorized = true
    mountedApp.ctx.on('remote-web-ui/authorize-http', () => authorized ? 'allow' : 'deny')
    const server = await serveWithUpgrades(mountedApp.routes, mountedApp.upgrades)
    let remote: WebSocket | undefined
    let local: WebSocket | undefined
    try {
      remote = await openWebSocket(server.port, MUX_EVENTS_PATH, {
        host: 'harness.example',
        origin: 'http://harness.example',
        'sec-fetch-site': 'same-origin',
        cookie: 'dsh_pair=paired-device',
      })
      local = await openWebSocket(server.port, HOST_EVENTS_PATH)
      const remoteClosed = once(remote, 'close')
      authorized = false
      mountedApp.ctx.emit('remote-web-ui/authorization-changed')
      await remoteClosed
      expect(remote.readyState).toBe(WebSocket.CLOSED)
      expect(local.readyState).toBe(WebSocket.OPEN)
    } finally {
      if (remote?.readyState === WebSocket.OPEN) remote.terminate()
      if (local?.readyState === WebSocket.OPEN) {
        const localClosed = once(local, 'close')
        local.close()
        await localClosed
      }
      await mountedApp.dispose()
      await server.close()
    }
  })

  it('closes existing downlinks when the connection plugin stops', async () => {
    const mountedApp = await mounted({ requireRemoteAuthorization: true })
    mountedApp.ctx.on('remote-web-ui/authorize-http', () => 'allow')
    const server = await serveWithUpgrades(mountedApp.routes, mountedApp.upgrades)
    let socket: WebSocket | undefined
    let disposed = false
    try {
      socket = await openWebSocket(server.port, HOST_EVENTS_PATH, {
        host: 'fresh.trycloudflare.com',
        origin: 'https://fresh.trycloudflare.com',
        'sec-fetch-site': 'same-origin',
        cookie: 'dsh_pair=paired-device',
      })
      const closed = once(socket, 'close')
      await mountedApp.dispose()
      disposed = true
      await closed
      expect(socket.readyState).toBe(WebSocket.CLOSED)
    } finally {
      if (socket?.readyState === WebSocket.OPEN) socket.terminate()
      if (!disposed) await mountedApp.dispose()
      await server.close()
    }
  })

  it('keeps arbitrary workspace roots local while paired clients use registered workspaces', async () => {
    const mountedApp = await mounted({ trustedHosts: ['harness.example'] })
    mountedApp.ctx.on('remote-web-ui/authorize-http', () => 'allow')
    const connection = mountedApp.ctx.get('connection') as HostConnectionHandle
    const calls: unknown[] = []
    const remove = connection.rpc.intercept(
      API_PATH,
      endpoint => endpoint === 'workspace.create' || endpoint === 'session.create' || endpoint === 'session.list',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: null }
      },
      { authority: 'trusted-host' },
    )
    const server = await serve(mountedApp.routes)
    try {
      expect(await callRpc(server.port, 'workspace.create', 'harness.example', { path: '/private' })).toBe(403)
      expect(await call(server.port, 'host.listDirectory', 'harness.example')).toBe(403)
      expect(await call(server.port, 'host.createDirectory', 'harness.example')).toBe(403)
      expect(await callRpc(server.port, 'session.create', 'harness.example', { cwd: '/private' })).toBe(403)

      expect(await callRpc(server.port, 'session.create', 'harness.example', { workspaceId: 'known' })).toBe(200)
      expect(await callRpc(server.port, 'session.list', 'harness.example', {})).toBe(200)
      expect(await callRpc(
        server.port,
        'workspace.create',
        `127.0.0.1:${String(server.port)}`,
        { path: '/tmp/local' },
      )).toBe(200)
      expect(calls).toEqual([
        { endpoint: 'session.create', payload: { workspaceId: 'known' } },
        { endpoint: 'session.list', payload: {} },
        { endpoint: 'workspace.create', payload: { path: '/tmp/local' } },
      ])
    } finally {
      await remove()
      await server.close()
      await mountedApp.dispose()
    }
  })

  it('answers a declared LAN authority with 403 on every configuration method, over real HTTP', async () => {
    // The fence's input is a real IncomingMessage parsed by Node from the
    // wire, not a hand-assembled object: the Host header a LAN browser sends
    // is exactly what decides loopback-only here, so the boundary is asserted
    // against the parse the server actually performs.
    const { ctx, routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    ctx.on('remote-web-ui/authorize-http', () => 'allow')
    const { port, close } = await serve(routes)
    try {
      // Reads are as privileged as writes: describe returns the exposed
      // configuration, and credentials.describe probes arbitrary env-var names.
      for (const method of [
        'settings.describe', 'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
        'credentials.describe', 'credentials.set', 'credentials.unset',
        'host.pickDirectory', 'host.openPath',
        // Carries a draft credential and turns the host into a fetcher for a
        // URL the caller picked: an anonymous LAN caller must not reach it.
        'llm.discoverModels',
        'agentPreset.read', 'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
      ]) {
        expect([method, await call(port, method, 'harness.example')]).toEqual([method, 403])
      }
      // The model catalog stays reachable for the same authority: a LAN
      // client's model picker needs it, and it carries no key or endpoint
      // state (404 is the empty proxy's carrier answer — the fence passed).
      // `agentPreset.list` joins the model catalog for the same reason: ids and
      // trust only, and a LAN client's preset picker needs it. `select` is
      // reachable too: `session.create` already takes an `agentPreset`, and the
      // deployment's own default already carries bash, so pinning the switch
      // would be a fence beside an open gate.
      for (const method of ['llm.providers', 'llm.models', 'agentPreset.list', 'agentPreset.select']) {
        expect([method, await call(port, method, 'harness.example')]).toEqual([method, 404])
      }
      // Loopback reaches everything, configuration included.
      expect(await call(port, 'settings.describe', `127.0.0.1:${String(port)}`)).toBe(404)
    } finally {
      await close()
      await dispose()
    }
  })
})
