/** Stability regressions for DeepSeeker's patched mobile remote control. */

import { readFileSync } from 'node:fs'
import {
  TunnelManager,
  type TunnelHandle,
  type TunnelInfo,
} from '@linxin666/dsh-remote-web-ui/src/tunnel.ts'
import { describe, expect, it, vi } from 'vitest'

class ManualTimer {
  private nextId = 1
  private readonly jobs = new Map<number, { delay: number; run: () => void }>()

  setTimeout(run: () => void, delay: number): number {
    const id = this.nextId++
    this.jobs.set(id, { delay, run })
    return id
  }

  clearTimeout(value: unknown): void {
    if (typeof value === 'number') this.jobs.delete(value)
  }

  delays(): number[] {
    return [...this.jobs.values()].map(job => job.delay).sort((left, right) => left - right)
  }

  runNext(): void {
    const next = [...this.jobs.entries()].sort((left, right) => {
      return left[1].delay - right[1].delay || left[0] - right[0]
    })[0]
    if (next === undefined) throw new Error('manual timer has no pending job')
    this.jobs.delete(next[0])
    next[1].run()
  }
}

class FakeTunnel implements TunnelHandle {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  stopped = false

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const listeners = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: string, listener: (...args: unknown[]) => void): unknown {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  stop(): boolean {
    this.stopped = true
    return true
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

describe('mobile remote tunnel recovery', () => {
  it('restarts a dead quick tunnel and publishes the replacement URL', async () => {
    const timer = new ManualTimer()
    const handles: FakeTunnel[] = []
    const urls: string[] = []
    const phases: TunnelInfo[] = []
    const manager = new TunnelManager({
      ensureBinary: () => Promise.resolve(),
      factory: () => {
        const handle = new FakeTunnel()
        handles.push(handle)
        return handle
      },
      restartBaseMs: 250,
      restartMaxMs: 1_000,
      urlTimeoutMs: 5_000,
      timer,
    })
    manager.onUrl((url) => { urls.push(url) })
    manager.onPhase((info) => { phases.push(info) })

    manager.start('http://127.0.0.1:3091')
    await vi.waitFor(() => { expect(handles).toHaveLength(1) })
    handles[0]!.emit('url', 'https://first.trycloudflare.com')
    expect(manager.info).toEqual({ phase: 'running', url: 'https://first.trycloudflare.com' })

    handles[0]!.emit('exit')
    expect(handles[0]!.stopped).toBe(true)
    expect(manager.info).toEqual({ phase: 'failed', error: 'the tunnel process exited unexpectedly' })
    expect(timer.delays()).toEqual([250])

    timer.runNext()
    expect(manager.info).toEqual({ phase: 'starting' })
    await vi.waitFor(() => { expect(handles).toHaveLength(2) })
    handles[1]!.emit('url', 'https://second.trycloudflare.com')

    expect(manager.info).toEqual({ phase: 'running', url: 'https://second.trycloudflare.com' })
    expect(urls).toEqual([
      'https://first.trycloudflare.com',
      'https://second.trycloudflare.com',
    ])
    expect(phases.map(info => info.phase)).toEqual([
      'starting',
      'running',
      'failed',
      'starting',
      'running',
    ])
    manager.dispose()
  })

  it('does not spawn a stale tunnel after a quick stop and restart', async () => {
    let resolveFirst!: () => void
    const firstReadiness = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const timer = new ManualTimer()
    const handles: FakeTunnel[] = []
    const ensureBinary = vi.fn()
      .mockImplementationOnce(() => firstReadiness)
      .mockResolvedValue(undefined)
    const manager = new TunnelManager({
      ensureBinary,
      factory: () => {
        const handle = new FakeTunnel()
        handles.push(handle)
        return handle
      },
      timer,
    })

    manager.start('http://127.0.0.1:3091')
    manager.stop()
    manager.start('http://127.0.0.1:3091')
    await vi.waitFor(() => { expect(handles).toHaveLength(1) })

    resolveFirst()
    await firstReadiness
    await Promise.resolve()

    expect(ensureBinary).toHaveBeenCalledTimes(2)
    expect(handles).toHaveLength(1)
    manager.dispose()
  })

  it('ignores a stale binary failure after the replacement tunnel is running', async () => {
    let rejectFirst!: (reason: unknown) => void
    const firstReadiness = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const timer = new ManualTimer()
    const handles: FakeTunnel[] = []
    const ensureBinary = vi.fn()
      .mockImplementationOnce(() => firstReadiness)
      .mockResolvedValue(undefined)
    const manager = new TunnelManager({
      ensureBinary,
      factory: () => {
        const handle = new FakeTunnel()
        handles.push(handle)
        return handle
      },
      timer,
    })

    manager.start('http://127.0.0.1:3091')
    manager.stop()
    manager.start('http://127.0.0.1:3091')
    await vi.waitFor(() => { expect(handles).toHaveLength(1) })
    handles[0]!.emit('url', 'https://replacement.trycloudflare.com')

    rejectFirst(new Error('stale install failure'))
    await firstReadiness.catch(() => undefined)
    await Promise.resolve()

    expect(manager.info).toEqual({
      phase: 'running',
      url: 'https://replacement.trycloudflare.com',
    })
    expect(handles).toHaveLength(1)
    expect(handles[0]!.stopped).toBe(false)
    expect(timer.delays()).toEqual([])
    manager.dispose()
  })

  it('keeps a named tunnel URL stable across connector restarts', async () => {
    const timer = new ManualTimer()
    const handles: FakeTunnel[] = []
    const launches: Array<{ targetUrl: string; token: string }> = []
    const urls: string[] = []
    const manager = new TunnelManager({
      ensureBinary: () => Promise.resolve(),
      namedFactory: (targetUrl, token) => {
        launches.push({ targetUrl, token })
        const handle = new FakeTunnel()
        handles.push(handle)
        return handle
      },
      restartBaseMs: 250,
      restartMaxMs: 1_000,
      urlTimeoutMs: 5_000,
      timer,
    })
    manager.onUrl((url) => { urls.push(url) })

    manager.startNamed(
      'http://127.0.0.1:3091',
      'https://remote.example.com',
      'secret-tunnel-token',
    )
    await vi.waitFor(() => { expect(handles).toHaveLength(1) })
    expect(manager.info).toEqual({ phase: 'starting' })

    handles[0]!.emit('connected')
    expect(manager.info).toEqual({ phase: 'running', url: 'https://remote.example.com' })

    handles[0]!.emit('exit')
    expect(manager.info).toEqual({ phase: 'failed', error: 'the tunnel process exited unexpectedly' })
    expect(timer.delays()).toEqual([250])

    timer.runNext()
    await vi.waitFor(() => { expect(handles).toHaveLength(2) })
    handles[1]!.emit('connected')

    expect(launches).toEqual([
      { targetUrl: 'http://127.0.0.1:3091', token: 'secret-tunnel-token' },
      { targetUrl: 'http://127.0.0.1:3091', token: 'secret-tunnel-token' },
    ])
    expect(urls).toEqual(['https://remote.example.com', 'https://remote.example.com'])
    expect(manager.info).toEqual({ phase: 'running', url: 'https://remote.example.com' })
    manager.dispose()
  })

  it('stops the previous connector when the tunnel mode changes', async () => {
    const quick = new FakeTunnel()
    const named = new FakeTunnel()
    const manager = new TunnelManager({
      ensureBinary: () => Promise.resolve(),
      factory: () => quick,
      namedFactory: () => named,
    })

    manager.start('http://127.0.0.1:3091')
    await vi.waitFor(() => { expect(manager.info.phase).toBe('starting') })
    quick.emit('url', 'https://temporary.trycloudflare.com')

    manager.startNamed(
      'http://127.0.0.1:3091',
      'https://remote.example.com',
      'secret-tunnel-token',
    )
    await vi.waitFor(() => { expect(quick.stopped).toBe(true) })
    expect(manager.info).toEqual({ phase: 'starting' })

    quick.emit('exit')
    quick.emit('url', 'https://stale.trycloudflare.com')
    named.emit('connected')
    expect(manager.info).toEqual({ phase: 'running', url: 'https://remote.example.com' })
    manager.dispose()
  })

  it('passes the named token through the child environment rather than argv', () => {
    const source = readFileSync(new URL('../node_modules/@linxin666/dsh-remote-web-ui/src/tunnel.ts', import.meta.url), 'utf8')
    const factoryStart = source.indexOf('function defaultNamedFactory')
    const factoryEnd = source.indexOf('/** Node timers. */', factoryStart)
    const factory = source.slice(factoryStart, factoryEnd)

    expect(factoryStart).toBeGreaterThan(-1)
    expect(factoryEnd).toBeGreaterThan(factoryStart)
    expect(factory).toContain('process.env.TUNNEL_TOKEN = token')
    expect(factory).toContain("new Tunnel(['tunnel', 'run', '--url', targetUrl, '--no-autoupdate'])")
    expect(factory).not.toContain("'--token'")
  })
})

describe('mobile remote browser bundle', () => {
  it('mints QR links for the standalone mobile entry', () => {
    const host = readFileSync(new URL('../node_modules/@linxin666/dsh-remote-web-ui/lib/index.js', import.meta.url), 'utf8')

    expect(host).toMatch(/url: `\$\{base\}\/m\?pair=\$\{token\}/)
  })

  it('keeps the status stream while a panel waits for its first tunnel URL', () => {
    const client = readFileSync(new URL('../node_modules/@linxin666/dsh-remote-web-ui/lib/client.js', import.meta.url), 'utf8')
    const requestStart = client.indexOf('const requestMint = (address, trigger = "manual") =>')
    const requestEnd = client.indexOf('run.requestMint = requestMint;', requestStart)
    const requestBody = client.slice(requestStart, requestEnd)
    const waitingStart = requestBody.indexOf('if (next.kind !== "ready")')
    const waitingEnd = requestBody.indexOf('const rescanRequired =', waitingStart)
    const waitingBody = requestBody.slice(waitingStart, waitingEnd)
    const successStart = requestBody.indexOf('mint(address, controller.signal).then((outcome) =>')
    const successEnd = requestBody.indexOf('}).catch((error) =>', successStart)
    const successBody = requestBody.slice(successStart, successEnd)

    expect(requestStart).toBeGreaterThan(-1)
    expect(requestEnd).toBeGreaterThan(requestStart)
    expect(waitingStart).toBeGreaterThan(-1)
    expect(waitingEnd).toBeGreaterThan(waitingStart)
    expect(waitingBody).toContain('if (next.kind === "lan-required" || outcome.retryable) startStatusStream();')
    expect(waitingBody).toContain('if (outcome.retryable) scheduleRetry(address);')
    expect(successStart).toBeGreaterThan(-1)
    expect(successEnd).toBeGreaterThan(successStart)
    expect(successBody).toContain('startStatusStream();')
  })

  it('links the lightweight phone landing to the authenticated full workbench', () => {
    const mobile = readFileSync(new URL('../node_modules/@linxin666/dsh-remote-web-ui/lib/mobile.js', import.meta.url), 'utf8')
    const headerStart = mobile.indexOf('function WorkspaceHeader()')
    const headerEnd = mobile.indexOf('function WorkspaceView', headerStart)
    const header = mobile.slice(headerStart, headerEnd)

    expect(headerStart).toBeGreaterThan(-1)
    expect(headerEnd).toBeGreaterThan(headerStart)
    expect(header).toContain('className: "mobile-workbench-link"')
    expect(header).toContain('href: "/"')
    expect(header).toContain('children: "完整工作台"')
  })
})
