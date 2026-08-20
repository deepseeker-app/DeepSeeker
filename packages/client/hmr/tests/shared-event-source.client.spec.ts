// @vitest-environment jsdom
/** Multi-tab ownership coverage for the browser HMR event stream. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { subscribeSharedEventSource } from '../src/client/shared-event-source.ts'

type MessageListener = (event: MessageEvent) => void

class FakeBroadcastChannel {
  static readonly rooms = new Map<string, Set<FakeBroadcastChannel>>()
  private readonly listeners = new Set<MessageListener>()

  constructor(readonly name: string) {
    const room = FakeBroadcastChannel.rooms.get(name) ?? new Set<FakeBroadcastChannel>()
    room.add(this)
    FakeBroadcastChannel.rooms.set(name, room)
  }

  addEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'message', listener: MessageListener): void {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.rooms.get(this.name) ?? []) {
      if (peer === this) continue
      for (const listener of peer.listeners) queueMicrotask(() => { listener({ data } as MessageEvent) })
    }
  }

  close(): void {
    FakeBroadcastChannel.rooms.get(this.name)?.delete(this)
  }
}

class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  emit(data: string, type = 'message'): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent<string>)
  }
}

interface LockJob {
  active: boolean
  callback(): Promise<void> | void
  reject(error: unknown): void
  resolve(): void
  signal: AbortSignal | undefined
}

class FakeLockManager {
  private active = false
  private readonly jobs: LockJob[] = []

  request(
    _name: string,
    options: LockOptions,
    callback: () => Promise<void> | void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const job: LockJob = { active: false, callback, reject, resolve, signal: options.signal }
      const abort = (): void => {
        if (job.active) return
        const index = this.jobs.indexOf(job)
        if (index >= 0) this.jobs.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      this.jobs.push(job)
      this.runNext()
    })
  }

  private runNext(): void {
    if (this.active) return
    const job = this.jobs.shift()
    if (job === undefined) return
    if (job.signal?.aborted === true) {
      job.reject(new DOMException('Aborted', 'AbortError'))
      this.runNext()
      return
    }
    this.active = true
    job.active = true
    void Promise.resolve(job.callback()).then(
      () => { job.resolve() },
      (error: unknown) => { job.reject(error) },
    ).finally(() => {
      this.active = false
      this.runNext()
    })
  }
}

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')

afterEach(() => {
  FakeBroadcastChannel.rooms.clear()
  FakeEventSource.instances.length = 0
  vi.unstubAllGlobals()
  if (originalLocks === undefined) Reflect.deleteProperty(navigator, 'locks')
  else Object.defineProperty(navigator, 'locks', originalLocks)
})

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('shared browser event source', () => {
  it('opens one stream, relays frames to both tabs, and hands ownership over', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: new FakeLockManager() })
    const first: string[] = []
    const second: string[] = []
    const onError = vi.fn()

    const disposeFirst = subscribeSharedEventSource({
      url: '/plugins/events',
      key: 'plugins',
      onMessage: (data) => { first.push(data) },
      onCoordinationError: onError,
    })
    const disposeSecond = subscribeSharedEventSource({
      url: '/plugins/events',
      key: 'plugins',
      onMessage: (data) => { second.push(data) },
      onCoordinationError: onError,
    })
    await flush()

    expect(FakeEventSource.instances).toHaveLength(1)
    FakeEventSource.instances[0]!.emit('first-frame')
    await flush()
    expect(first).toEqual(['first-frame'])
    expect(second).toEqual(['first-frame'])
    ;[...FakeBroadcastChannel.rooms.get('dsh:shared-event-source:plugins:message')!][0]!
      .postMessage({ ignored: true })
    await flush()
    expect(second).toEqual(['first-frame'])

    disposeFirst()
    await flush()
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(2)

    FakeEventSource.instances[1]!.emit('second-frame')
    await flush()
    expect(first).toEqual(['first-frame'])
    expect(second).toEqual(['first-frame', 'second-frame'])
    expect(onError).not.toHaveBeenCalled()

    disposeSecond()
    disposeSecond()
    await flush()
    expect(FakeEventSource.instances[1]!.closed).toBe(true)
  })

  it('uses a named SSE event without opening one stream per tab', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: new FakeLockManager() })
    const first: string[] = []
    const second: string[] = []
    const options = {
      url: '/git/events?path=%2Frepo',
      key: 'git:/repo',
      eventName: 'change',
      onCoordinationError: vi.fn(),
    }

    const disposeFirst = subscribeSharedEventSource({ ...options, onMessage: (data) => { first.push(data) } })
    const disposeSecond = subscribeSharedEventSource({ ...options, onMessage: (data) => { second.push(data) } })
    await flush()

    expect(FakeEventSource.instances).toHaveLength(1)
    FakeEventSource.instances[0]!.emit('ignored')
    FakeEventSource.instances[0]!.emit('changed', 'change')
    await flush()
    expect(first).toEqual(['changed'])
    expect(second).toEqual(['changed'])

    disposeFirst()
    disposeSecond()
    await flush()
  })

  it.each([undefined, FakeBroadcastChannel])(
    'falls back to one local stream when cross-tab primitives are unavailable',
    (broadcastChannel) => {
      vi.stubGlobal('BroadcastChannel', broadcastChannel)
      vi.stubGlobal('EventSource', FakeEventSource)
      Reflect.deleteProperty(navigator, 'locks')
      const messages: string[] = []

      const dispose = subscribeSharedEventSource({
        url: '/plugins/events',
        key: 'plugins',
        onMessage: (data) => { messages.push(data) },
        onCoordinationError: vi.fn(),
      })
      expect(FakeEventSource.instances).toHaveLength(1)
      FakeEventSource.instances[0]!.emit('local-frame')
      expect(messages).toEqual(['local-frame'])

      dispose()
      expect(FakeEventSource.instances[0]!.closed).toBe(true)
    })

  it('falls back to a local stream when lock coordination fails', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    vi.stubGlobal('EventSource', FakeEventSource)
    const failure = new Error('locks unavailable')
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: () => Promise.reject(failure) },
    })
    const onError = vi.fn()
    const messages: string[] = []

    const dispose = subscribeSharedEventSource({
      url: '/plugins/events',
      key: 'plugins',
      onMessage: (data) => { messages.push(data) },
      onCoordinationError: onError,
    })
    await flush()

    expect(onError).toHaveBeenCalledWith(failure)
    expect(FakeEventSource.instances).toHaveLength(1)
    FakeEventSource.instances[0]!.emit('fallback-frame')
    expect(messages).toEqual(['fallback-frame'])

    dispose()
    expect(FakeEventSource.instances[0]!.closed).toBe(true)
  })
})
