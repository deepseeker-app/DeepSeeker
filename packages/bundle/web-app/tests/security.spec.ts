/** Security regressions for DeepSeeker's patched third-party host plugins. */

import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { connect as connectTcp, type AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  HostKeyMismatchError,
  SshEngine,
  fingerprintHostKey,
  retryOperation,
} from '@linxin666/dsh-ssh/src/engine.ts'
import type { ShellSession } from '@linxin666/dsh-ssh/src/engine.ts'
import type { SshHostSummary } from '@linxin666/dsh-ssh/src/protocol.ts'
import { SSH_API } from '@linxin666/dsh-ssh/src/protocol.ts'
import { makeRoutes } from '@linxin666/dsh-ssh/src/routes.ts'
import { HostStore, storePath } from '@linxin666/dsh-ssh/src/store.ts'
import { isLoopbackClient, makeHttpAuthorizer } from '@linxin666/dsh-remote-web-ui/src/gate.ts'
import type { PairingService } from '@linxin666/dsh-remote-web-ui/src/pairing.ts'
import {
  authorizeAttachRequest,
  registerAttachRoute,
} from '@linxin666/dsh-tool-describe-image/src/attach-routes.ts'
import { describe, expect, it } from 'vitest'

interface SshAuthContext {
  method: string
  username: string
  password?: string
  accept(): void
  reject(): void
}

interface SshChannel {
  write(data: string): void
  exit(code: number): void
  close(): void
}

interface SshSession {
  on(event: 'exec', listener: (accept: () => unknown, reject: () => void, info: { command: string }) => void): this
  on(event: 'pty', listener: (accept: () => void, reject: () => void) => void): this
  on(event: 'shell', listener: (accept: () => SshChannel, reject: () => void) => void): this
}

interface SshConnection {
  on(event: 'authentication', listener: (context: SshAuthContext) => void): this
  on(event: 'ready', listener: () => void): this
  on(event: 'session', listener: (accept: () => SshSession) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  end(): void
}

interface SshServerInstance {
  on(event: 'connection', listener: () => void): this
  listen(port: number, host: string, listener: () => void): void
  address(): AddressInfo | string | null
  close(listener: () => void): void
}

interface Ssh2Module {
  Server: new (
    options: { hostKeys: Array<string | Buffer> },
    listener: (connection: SshConnection) => void,
  ) => SshServerInstance
}

interface TestWebSocket {
  readonly readyState: number
  once(event: 'open', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'message', listener: (data: Buffer) => void): this
  once(event: 'close', listener: (code: number, reason: Buffer) => void): this
  send(data: string | Buffer, options?: { binary?: boolean }): void
  close(code?: number): void
  terminate(): void
}

interface TestWebSocketConstructor {
  new (address: string): TestWebSocket
  readonly CONNECTING: number
  readonly OPEN: number
}

interface WsModule extends TestWebSocketConstructor {
  WebSocket?: TestWebSocketConstructor
}

interface TestSshServer {
  port: number
  connections: number
  shellsOpened: number
  closeClients(): void
  stop(): Promise<void>
}

const tick = async (milliseconds = 80): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, milliseconds))
}

function waitForShellExit(shell: ShellSession): Promise<void> {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => { rejectExit(new Error('SSH shell did not close')) }, 2_000)
    shell.onExit = () => {
      clearTimeout(timeout)
      resolveExit()
    }
  })
}

function requireSsh2(): Ssh2Module {
  const packageJson = fileURLToPath(import.meta.resolve('@linxin666/dsh-ssh/package.json'))
  return createRequire(packageJson)('ssh2') as Ssh2Module
}

function requireWebSocket(): TestWebSocketConstructor {
  const packageJson = fileURLToPath(import.meta.resolve('@linxin666/dsh-ssh/package.json'))
  const loaded = createRequire(packageJson)('ws') as WsModule
  return loaded.WebSocket ?? loaded
}

const WebSocketClient = requireWebSocket()

async function startSshServer(): Promise<TestSshServer> {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' })
  const clients: SshConnection[] = []
  const ssh2 = requireSsh2()
  const state = { connections: 0, shellsOpened: 0 }
  const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    clients.push(client)
    // Host-key rejection deliberately tears down key exchange in one test.
    client.on('error', () => undefined)
    client.on('authentication', (auth) => {
      if (auth.method === 'password' && auth.username === 'tester' && auth.password === 'secret') auth.accept()
      else auth.reject()
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acceptPty) => { acceptPty() })
        session.on('exec', (acceptExec, _rejectExec, info) => {
          const channel = acceptExec() as SshChannel
          channel.write(`${info.command}\n`)
          channel.exit(0)
          channel.close()
        })
        session.on('shell', (acceptShell) => {
          acceptShell()
          state.shellsOpened += 1
        })
      })
    })
  })
  server.on('connection', () => { state.connections += 1 })
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('SSH test server did not expose a TCP address')
  return {
    port: address.port,
    get connections() {
      return state.connections
    },
    get shellsOpened() {
      return state.shellsOpened
    },
    closeClients() {
      for (const client of clients.splice(0)) client.end()
    },
    async stop() {
      for (const client of clients.splice(0)) client.end()
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose()
        })
      })
    },
  }
}

function createPinnedHost(store: HostStore, port: number): void {
  store.create({
    alias: 'pinned',
    host: '127.0.0.1',
    port,
    user: 'tester',
    auth: { kind: 'password', password: 'secret' },
  })
}

describe('SSH host-key pinning', () => {
  it('trusts the first key, accepts the same key, and rejects a changed pin without reconnecting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-security-'))
    const path = join(dir, 'hosts.json')
    const server = await startSshServer()
    const store = new HostStore(path)
    createPinnedHost(store, server.port)
    try {
      const first = new SshEngine(store, { connectTimeoutMs: 2_000, defaultExecTimeoutMs: 2_000 })
      expect((await first.exec('pinned', 'first')).stdout).toContain('first')
      const pinned = store.find('pinned')?.hostKeyFingerprint
      expect(pinned).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
      first.dispose()
      server.closeClients()
      await tick()

      const second = new SshEngine(store, { connectTimeoutMs: 2_000, defaultExecTimeoutMs: 2_000 })
      expect((await second.exec('pinned', 'second')).stdout).toContain('second')
      expect(store.find('pinned')?.hostKeyFingerprint).toBe(pinned)
      second.dispose()
      server.closeClients()
      await tick()

      const file = JSON.parse(readFileSync(path, 'utf8')) as { hosts: Array<{ hostKeyFingerprint?: string }> }
      file.hosts[0]!.hostKeyFingerprint = `SHA256:${'A'.repeat(43)}`
      writeFileSync(path, JSON.stringify(file, null, 2) + '\n', 'utf8')
      const before = server.connections
      const rejected = new SshEngine(store, { connectTimeoutMs: 2_000, defaultExecTimeoutMs: 2_000 })
      await expect(rejected.exec('pinned', 'blocked')).rejects.toBeInstanceOf(HostKeyMismatchError)
      expect(server.connections).toBe(before + 1)
      rejected.dispose()
    } finally {
      await server.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('clears a pin only when the configured endpoint changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-store-'))
    const store = new HostStore(join(dir, 'hosts.json'))
    try {
      createPinnedHost(store, 22)
      const fingerprint = fingerprintHostKey(Buffer.from('server-key'))
      expect(store.verifyOrTrustHostKey('pinned', fingerprint)).toEqual({ status: 'trusted' })
      expect(store.verifyOrTrustHostKey('pinned', fingerprint)).toEqual({ status: 'matched' })
      store.update('pinned', { user: 'deploy' })
      expect(store.find('pinned')?.hostKeyFingerprint).toBe(fingerprint)
      store.update('pinned', { port: 2222 })
      expect(store.find('pinned')?.hostKeyFingerprint).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('retries ordinary failures but never retries a host-key mismatch', async () => {
    const attempts: number[] = []
    await expect(retryOperation(3, async (attempt) => {
      attempts.push(attempt)
      if (attempt < 3) throw new Error('temporary')
      return 'ok'
    })).resolves.toBe('ok')
    expect(attempts).toEqual([1, 2, 3])

    let mismatchAttempts = 0
    await expect(retryOperation(3, async () => {
      mismatchAttempts += 1
      throw new HostKeyMismatchError('pinned', `SHA256:${'A'.repeat(43)}`, `SHA256:${'B'.repeat(43)}`)
    })).rejects.toBeInstanceOf(HostKeyMismatchError)
    expect(mismatchAttempts).toBe(1)
  })

  it('isolates host stores by DSH_HOME and keeps the legacy path when it is unset', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-homes-'))
    const previous = process.env.DSH_HOME
    try {
      delete process.env.DSH_HOME
      expect(storePath()).toBe(join(homedir(), '.dsh', 'dsh-ssh.json'))

      const firstHome = join(root, 'first')
      process.env.DSH_HOME = firstHome
      const first = new HostStore()
      expect(first.path).toBe(join(firstHome, 'dsh-ssh.json'))
      first.create({
        alias: 'only-first',
        host: '127.0.0.1',
        user: 'tester',
        auth: { kind: 'password', password: 'secret' },
      })

      const secondHome = join(root, 'second')
      process.env.DSH_HOME = secondHome
      const second = new HostStore()
      expect(second.path).toBe(join(secondHome, 'dsh-ssh.json'))
      expect(second.list()).toEqual([])
      expect(first.find('only-first')?.alias).toBe('only-first')

      process.env.DSH_HOME = '   '
      expect(storePath()).toBe(join(homedir(), '.dsh', 'dsh-ssh.json'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(root, { recursive: true, force: true })
    }
  })
})

class RouteEngineStub {
  list(): SshHostSummary[] { return [] }
  find(): SshHostSummary | undefined { return undefined }
  stopAllTunnels(): number { return 0 }
  async openShell(_alias: string, _size: { cols: number; rows: number }): Promise<ShellSession> {
    throw new Error('terminal must stay fenced')
  }
}

class TerminalShellStub implements ShellSession {
  onData?: (data: Buffer) => void
  onExit?: (code: number | null, error?: string) => void
  readonly inputs: string[] = []
  readonly sizes: Array<{ cols: number; rows: number }> = []
  closeCalls = 0

  send(data: string): void { this.inputs.push(data) }
  resize(cols: number, rows: number): void { this.sizes.push({ cols, rows }) }
  close(): void {
    if (this.closeCalls > 0) return
    this.closeCalls += 1
    this.onExit?.(null)
  }
  pause(): void {}
  resume(): void {}
}

class TerminalRouteEngineStub extends RouteEngineStub {
  readonly sessions: TerminalShellStub[] = []
  readonly openingSizes: Array<{ cols: number; rows: number }> = []

  override async openShell(_alias: string, size: { cols: number; rows: number }): Promise<ShellSession> {
    this.openingSizes.push(size)
    const session = new TerminalShellStub()
    this.sessions.push(session)
    return session
  }
}

async function serveSshRoutes(result: ReturnType<typeof makeRoutes>): Promise<{
  port: number
  stop(): Promise<void>
}> {
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = result.routes.find(candidate => candidate.path === pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  server.on('upgrade', (request, socket, head) => {
    void result.upgrade.handler(request, socket, head)
  })
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('SSH route server did not expose a TCP address')
  return {
    port: address.port,
    async stop() {
      await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
    },
  }
}

async function openTerminalWebSocket(port: number, engine: TerminalRouteEngineStub): Promise<{
  socket: TestWebSocket
  session: TerminalShellStub
}> {
  const before = engine.sessions.length
  const socket = new WebSocketClient(`ws://127.0.0.1:${String(port)}${SSH_API.terminal}?alias=pinned&cols=500&rows=200`)
  const opened = new Promise<void>((resolveOpen, rejectOpen) => {
    socket.once('open', resolveOpen)
    socket.once('error', (error) => { rejectOpen(error) })
  })
  const ready = new Promise<unknown>((resolveReady, rejectReady) => {
    socket.once('message', (data) => {
      try {
        resolveReady(JSON.parse(String(data)))
      } catch (error) {
        rejectReady(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
  await opened
  await expect(ready).resolves.toEqual({ type: 'ready', alias: 'pinned' })
  const session = engine.sessions[before]
  if (session === undefined) throw new Error('terminal route did not open a shell')
  return { socket, session }
}

function waitForWebSocketClose(socket: TestWebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolveClose) => {
    socket.once('close', (code, reason) => {
      resolveClose({ code, reason: reason.toString('utf8') })
    })
  })
}

function httpGet(port: number, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: SSH_API.hosts, headers: { host } }, (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      response.on('end', () => {
        resolveRequest({ status: response.statusCode ?? 0, body })
      })
    })
    request.on('error', rejectRequest)
    request.end()
  })
}

function httpJson(
  port: number,
  method: 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        host: `127.0.0.1:${port}`,
        ...(payload === undefined
          ? {}
          : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
      },
    }, (response) => {
      let responseBody = ''
      response.on('data', (chunk: Buffer) => { responseBody += chunk.toString('utf8') })
      response.on('end', () => {
        resolveRequest({ status: response.statusCode ?? 0, body: responseBody })
      })
    })
    request.on('error', rejectRequest)
    request.end(payload)
  })
}

function rawWebSocketHandshake(port: number, host: string, path = `${SSH_API.terminal}?alias=pinned`): Promise<string> {
  return new Promise((resolveHandshake, rejectHandshake) => {
    const socket = connectTcp({ host: '127.0.0.1', port }, () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ZGVlcHNlZWtlci10ZXN0',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })
    let response = ''
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8')
      if (response.includes('\r\n\r\n')) {
        socket.destroy()
        resolveHandshake(response)
      }
    })
    socket.on('error', rejectHandshake)
  })
}

describe('SSH loopback fence', () => {
  it('allows a loopback Host and rejects tunneled HTTP and WebSocket Hosts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-routes-'))
    const store = new HostStore(join(dir, 'hosts.json'))
    const { routes, upgrade } = makeRoutes({
      store,
      engine: new RouteEngineStub() as unknown as SshEngine,
      stagingDir: join(dir, 'staging'),
    })
    const server: HttpServer = createHttpServer((request, response) => {
      const route = routes.find(candidate => candidate.path === new URL(request.url ?? '/', 'http://x').pathname)
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    server.on('upgrade', (request, socket, head) => {
      void upgrade.handler(request, socket, head)
    })
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('HTTP test server did not expose a TCP address')
    try {
      expect((await httpGet(address.port, `127.0.0.1:${address.port}`)).status).toBe(200)
      expect((await httpGet(address.port, 'remote.example')).status).toBe(403)
      expect(await rawWebSocketHandshake(address.port, 'remote.example')).toMatch(/^HTTP\/1\.1 403 Forbidden/)
      expect(await rawWebSocketHandshake(
        address.port,
        `127.0.0.1:${address.port}`,
        `${SSH_API.terminal}?alias=pinned&cols=501&rows=24`,
      )).toMatch(/^HTTP\/1\.1 400 Bad Request/)
      expect(await rawWebSocketHandshake(
        address.port,
        `127.0.0.1:${address.port}`,
        `${SSH_API.terminal}?alias=pinned&cols=80oops&rows=24`,
      )).toMatch(/^HTTP\/1\.1 400 Bad Request/)
      expect(await rawWebSocketHandshake(
        address.port,
        `127.0.0.1:${address.port}`,
        `${SSH_API.terminal}?alias=pinned&cols=80&rows=0`,
      )).toMatch(/^HTTP\/1\.1 400 Bad Request/)
    } finally {
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose()
        })
      })
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates terminal WebSocket frame types, input bytes, and PTY dimensions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-websocket-'))
    const store = new HostStore(join(dir, 'hosts.json'))
    const engine = new TerminalRouteEngineStub()
    const server = await serveSshRoutes(makeRoutes({
      store,
      engine: engine as unknown as SshEngine,
      stagingDir: join(dir, 'staging'),
    }))
    const sockets: TestWebSocket[] = []
    try {
      const valid = await openTerminalWebSocket(server.port, engine)
      sockets.push(valid.socket)
      expect(engine.openingSizes[0]).toEqual({ cols: 500, rows: 200 })
      valid.socket.send(JSON.stringify({ type: 'input', data: 'printf ok\r' }))
      valid.socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
      await tick(20)
      expect(valid.session.inputs).toEqual(['printf ok\r'])
      expect(valid.session.sizes).toEqual([{ cols: 120, rows: 40 }])
      const validClosed = waitForWebSocketClose(valid.socket)
      valid.socket.close(1000)
      await validClosed
      await tick(20)
      expect(valid.session.closeCalls).toBe(1)

      const cases: Array<{
        payload: string | Buffer
        binary?: boolean
        code: number
      }> = [
        { payload: Buffer.from('{"type":"input","data":"x"}'), binary: true, code: 1003 },
        { payload: JSON.stringify({ type: 'unknown' }), code: 1008 },
        { payload: JSON.stringify({ type: 'input', data: 'x'.repeat(64 * 1024 + 1) }), code: 1009 },
        { payload: JSON.stringify({ type: 'resize', cols: 501, rows: 24 }), code: 1008 },
        { payload: JSON.stringify({ type: 'resize', cols: 80, rows: 0 }), code: 1008 },
      ]
      for (const testCase of cases) {
        const opened = await openTerminalWebSocket(server.port, engine)
        sockets.push(opened.socket)
        const closed = waitForWebSocketClose(opened.socket)
        opened.socket.send(testCase.payload, { binary: testCase.binary ?? false })
        await expect(closed).resolves.toEqual(expect.objectContaining({ code: testCase.code }))
        expect(opened.session.closeCalls).toBe(1)
      }
    } finally {
      for (const socket of sockets) {
        if (socket.readyState === WebSocketClient.OPEN || socket.readyState === WebSocketClient.CONNECTING) socket.terminate()
      }
      await server.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops the pooled connection when a real route changes or deletes a host', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-lifecycle-'))
    const firstServer = await startSshServer()
    const secondServer = await startSshServer()
    const store = new HostStore(join(dir, 'hosts.json'))
    createPinnedHost(store, firstServer.port)
    const engine = new SshEngine(store, { connectTimeoutMs: 2_000, defaultExecTimeoutMs: 2_000 })
    const { routes } = makeRoutes({ store, engine, stagingDir: join(dir, 'staging') })
    const routeServer = createHttpServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const route = routes.find(candidate => candidate.path === pathname)
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>((resolveListen) => {
      routeServer.listen(0, '127.0.0.1', resolveListen)
    })
    const routeAddress = routeServer.address()
    if (typeof routeAddress !== 'object' || routeAddress === null) {
      throw new Error('SSH route test server did not expose a TCP address')
    }

    try {
      expect((await engine.exec('pinned', 'before-update')).stdout).toContain('before-update')
      expect(firstServer.connections).toBe(1)
      const firstShell = await engine.openShell('pinned', { cols: 80, rows: 24 })
      const firstShellExit = waitForShellExit(firstShell)
      expect(firstServer.shellsOpened).toBe(1)

      const updated = await httpJson(
        routeAddress.port,
        'PATCH',
        `${SSH_API.hosts}?alias=pinned`,
        { port: secondServer.port },
      )
      expect(updated.status).toBe(200)
      await firstShellExit
      expect((await engine.exec('pinned', 'after-update')).stdout).toContain('after-update')
      expect(secondServer.connections).toBe(1)
      const secondShell = await engine.openShell('pinned', { cols: 80, rows: 24 })
      const secondShellExit = waitForShellExit(secondShell)
      expect(secondServer.shellsOpened).toBe(1)

      const deleted = await httpJson(routeAddress.port, 'DELETE', `${SSH_API.hosts}?alias=pinned`)
      expect(deleted.status).toBe(200)
      await secondShellExit
      await expect(engine.exec('pinned', 'after-delete')).rejects.toThrow("alias 'pinned' not found")
      expect(secondServer.connections).toBe(2)
    } finally {
      engine.dispose()
      await new Promise<void>((resolveClose) => {
        routeServer.close(() => { resolveClose() })
      })
      await Promise.all([firstServer.stop(), secondServer.stop()])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('closes active shells when the SSH engine is disposed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepseeker-ssh-dispose-'))
    const server = await startSshServer()
    const store = new HostStore(join(dir, 'hosts.json'))
    createPinnedHost(store, server.port)
    const engine = new SshEngine(store, { connectTimeoutMs: 2_000, defaultExecTimeoutMs: 2_000 })
    try {
      const shell = await engine.openShell('pinned', { cols: 80, rows: 24 })
      const exited = waitForShellExit(shell)
      expect(server.shellsOpened).toBe(1)
      engine.dispose()
      await exited
      expect(() => { engine.dispose() }).not.toThrow()
      await expect(engine.openShell('pinned', { cols: 80, rows: 24 })).rejects.toThrow('disposed')
    } finally {
      engine.dispose()
      await server.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function imageRequest(options: {
  host: string
  remoteAddress?: string
  origin?: string
  secFetchSite?: string
  method?: string
  url?: string
  onBodyRead?: () => void
  extraHeaders?: Record<string, string>
}): IncomingMessage {
  return {
    headers: {
      host: options.host,
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.secFetchSite === undefined ? {} : { 'sec-fetch-site': options.secFetchSite }),
      ...options.extraHeaders,
    },
    method: options.method ?? 'POST',
    url: options.url ?? '/describe-image/attach',
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      options.onBodyRead?.()
      yield Buffer.from('{}')
    },
  } as unknown as IncomingMessage
}

function responseRecorder(): {
  response: ServerResponse
  status(): number
  body(): string
} {
  let status = 0
  let body = ''
  const response = {
    writeHead(next: number) {
      status = next
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) body += chunk.toString()
    },
  } as unknown as ServerResponse
  return { response, status: () => status, body: () => body }
}

const PROXY_CLIENT_HEADERS = [
  'cf-connecting-ip',
  'x-forwarded-for',
  'forwarded',
  'x-real-ip',
] as const

describe('remote HTTP authorization', () => {
  it('never classifies a proxy-tagged loopback request as the desktop client', () => {
    expect(isLoopbackClient(imageRequest({ host: '127.0.0.1:3091' }))).toBe(true)
    for (const header of PROXY_CLIENT_HEADERS) {
      expect(isLoopbackClient(imageRequest({
        host: '127.0.0.1:3091',
        extraHeaders: { [header]: '203.0.113.9' },
      }))).toBe(false)
    }
  })

  it('requires pairing after proxy classification and still admits a paired public authority', () => {
    const service = {
      publicBaseUrl: 'https://deepseeker.example',
      config: { cookieName: 'dsh_pair' },
      touchDevice: (deviceId: string) => deviceId === 'paired-device',
    } as unknown as PairingService
    const authorize = makeHttpAuthorizer(service, [])

    expect(authorize(imageRequest({
      host: '127.0.0.1:3091',
      extraHeaders: { 'cf-connecting-ip': '203.0.113.9' },
    }))).toBe('deny')
    expect(authorize(imageRequest({
      host: 'deepseeker.example',
      origin: 'https://deepseeker.example',
      extraHeaders: {
        'cf-connecting-ip': '203.0.113.9',
        cookie: 'dsh_pair=paired-device',
      },
    }))).toBe('allow')
  })
})

describe('describe-image HTTP authorization', () => {
  it('distinguishes real loopback traffic from a tunnel and follows pairing revocation', () => {
    let paired = false
    let hookCalls = 0
    const context = {
      bail() {
        hookCalls += 1
        return paired ? 'allow' : undefined
      },
    } as unknown as Context

    const local = imageRequest({ host: '127.0.0.1:3091', origin: 'http://127.0.0.1:3091' })
    expect(authorizeAttachRequest(context, local)).toBe(true)
    expect(hookCalls).toBe(0)

    for (const header of PROXY_CLIENT_HEADERS) {
      expect(authorizeAttachRequest(context, imageRequest({
        host: '127.0.0.1:3091',
        origin: 'http://127.0.0.1:3091',
        extraHeaders: { [header]: '203.0.113.9' },
      }))).toBe(false)
    }
    expect(hookCalls).toBe(PROXY_CLIENT_HEADERS.length)

    paired = true
    expect(authorizeAttachRequest(context, imageRequest({
      host: '127.0.0.1:3091',
      extraHeaders: { 'cf-connecting-ip': '203.0.113.9' },
    }))).toBe(true)
    paired = false

    const forgedLoopbackHost = imageRequest({
      host: '127.0.0.1:3091',
      origin: 'http://127.0.0.1:3091',
      remoteAddress: '192.168.1.50',
    })
    expect(authorizeAttachRequest(context, forgedLoopbackHost)).toBe(false)

    const tunneled = imageRequest({ host: 'deepseeker.example', origin: 'https://deepseeker.example' })
    expect(authorizeAttachRequest(context, tunneled)).toBe(false)
    paired = true
    expect(authorizeAttachRequest(context, tunneled)).toBe(true)
    paired = false
    expect(authorizeAttachRequest(context, tunneled)).toBe(false)

    paired = true
    expect(authorizeAttachRequest(context, imageRequest({
      host: 'deepseeker.example',
      origin: 'https://evil.example',
    }))).toBe(false)
    expect(authorizeAttachRequest(context, imageRequest({
      host: 'deepseeker.example',
      secFetchSite: 'cross-site',
    }))).toBe(false)
  })

  it('answers 403 before reading an upload body or attachment', async () => {
    let route: { handler(request: IncomingMessage, response: ServerResponse): Promise<void> | void } | undefined
    let bodyReads = 0
    let attachmentReads = 0
    const context = {
      bail: () => undefined,
      get(name: string) {
        if (name === 'webServer') {
          return {
            register(next: typeof route) {
              route = next
              return () => undefined
            },
          }
        }
        if (name === 'attachments') attachmentReads += 1
        return undefined
      },
    } as unknown as Context
    registerAttachRoute(context)
    if (route === undefined) throw new Error('describe-image route was not registered')

    for (const request of [
      imageRequest({ host: 'deepseeker.example', onBodyRead: () => { bodyReads += 1 } }),
      ...PROXY_CLIENT_HEADERS.map(header => imageRequest({
        host: '127.0.0.1:3091',
        extraHeaders: { [header]: '203.0.113.9' },
        onBodyRead: () => { bodyReads += 1 },
      })),
      imageRequest({
        host: 'deepseeker.example',
        method: 'GET',
        url: '/describe-image/raw/sha256:missing',
        onBodyRead: () => { bodyReads += 1 },
      }),
    ]) {
      const recorder = responseRecorder()
      await route.handler(request, recorder.response)
      expect(recorder.status()).toBe(403)
      expect(recorder.body()).toContain('forbidden')
    }
    expect(bodyReads).toBe(0)
    expect(attachmentReads).toBe(0)
  })
})

describe('installed patch artifacts', () => {
  it('ships the security logic in the runtime bundles and clean patches', () => {
    const bundleRoot = fileURLToPath(new URL('..', import.meta.url))
    const sshRoot = dirname(fileURLToPath(import.meta.resolve('@linxin666/dsh-ssh/package.json')))
    const remoteRoot = dirname(fileURLToPath(import.meta.resolve('@linxin666/dsh-remote-web-ui/package.json')))
    const imageRoot = dirname(fileURLToPath(import.meta.resolve('@linxin666/dsh-tool-describe-image/package.json')))
    const sshRuntime = readFileSync(resolve(sshRoot, 'lib/index.js'), 'utf8')
    const remoteRuntime = readFileSync(resolve(remoteRoot, 'lib/index.js'), 'utf8')
    const imageRuntime = readFileSync(resolve(imageRoot, 'lib/index.js'), 'utf8')
    expect(sshRuntime).toContain('hostVerifier')
    expect(sshRuntime).toContain('HostKeyMismatchError')
    expect(sshRuntime).toContain('disconnect(alias)')
    expect(sshRuntime).toContain('engine.disconnect(alias)')
    expect(remoteRuntime).toContain('PROXY_CLIENT_HEADERS')
    expect(remoteRuntime).toContain('cf-connecting-ip')
    expect(imageRuntime).toContain('remote-web-ui/authorize-http')
    expect(imageRuntime).toContain('sec-fetch-site')
    expect(imageRuntime).toContain('PROXY_CLIENT_HEADERS')

    const repositoryRoot = resolve(bundleRoot, '../../..')
    for (const patchName of [
      '@linxin666__dsh-ssh@0.1.12.patch',
      '@linxin666__dsh-remote-web-ui@0.1.12.patch',
      '@linxin666__dsh-tool-describe-image@0.1.12.patch',
    ]) {
      const text = readFileSync(resolve(repositoryRoot, 'patches', patchName), 'utf8')
      expect(text).not.toMatch(/^old mode |^new mode /m)
      expect(text).not.toContain('/._')
    }
  })
})
