/** @vitest-environment jsdom */

import {
  HostTaskStore,
  InMemoryTaskStore,
  type TaskStoreUpdate,
} from '@linxin666/dsh-client-ui-task-board/src/core/store.ts'
import type { TaskRecord } from '@linxin666/dsh-client-ui-task-board/src/core/tasks.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

function task(id: string, title = id): TaskRecord {
  return {
    id,
    title,
    description: '',
    prompt: title,
    status: 'todo',
    createdAt: 1,
    updatedAt: 1,
    executions: [],
  }
}

function snapshotResponse(status: number, revision: number, tasks: TaskRecord[]): Response {
  return new Response(JSON.stringify({ ok: true, value: { revision, tasks } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function eventSourceStub(): Pick<EventSource, 'close' | 'onmessage' | 'onerror'> {
  return { close: vi.fn(), onmessage: null, onerror: null }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HostTaskStore browser transport', () => {
  it('invokes the native fetch face with window as this', async () => {
    const fetchStub = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis)
      return Promise.resolve(snapshotResponse(200, 1, []))
    })
    vi.stubGlobal('fetch', fetchStub)
    const store = new HostTaskStore({
      eventSource: eventSourceStub,
      migrationStore: new InMemoryTaskStore(),
    })

    store.load()
    await vi.waitFor(() => { expect(fetchStub).toHaveBeenCalledTimes(1) })

    store.dispose()
  })

  it('keeps a stale local edit after 409 and retries it from the new revision on the next save', async () => {
    const local = [task('local', 'Keep this edit')]
    const remote = [task('remote', 'Remote version')]
    const calls: Array<{ method: string; body?: { expectedRevision: number; tasks: TaskRecord[] } }> = []
    let writes = 0
    const fetchStub = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({
        method,
        ...(typeof init?.body === 'string'
          ? { body: JSON.parse(init.body) as { expectedRevision: number; tasks: TaskRecord[] } }
          : {}),
      })
      if (method === 'GET') return snapshotResponse(200, 1, [])
      writes += 1
      return writes === 1
        ? snapshotResponse(409, 2, remote)
        : snapshotResponse(200, 3, local)
    }) as unknown as typeof fetch
    const updates: TaskStoreUpdate[] = []
    const store = new HostTaskStore({
      fetchFn: fetchStub,
      eventSource: eventSourceStub,
      migrationStore: new InMemoryTaskStore(),
    })
    store.subscribe((update) => { updates.push(update) })

    store.load()
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    store.save(local)
    await vi.waitFor(() => {
      expect(updates.at(-1)?.reason).toBe('conflict')
    })

    expect(store.load()).toEqual(local)
    expect(updates.at(-1)).toEqual({ reason: 'conflict', tasks: local })
    expect(calls[1]?.body).toEqual({ expectedRevision: 1, tasks: local })
    await Promise.resolve()
    expect(calls).toHaveLength(2)

    store.save(local)
    await vi.waitFor(() => { expect(calls).toHaveLength(3) })

    expect(calls[2]?.body).toEqual({ expectedRevision: 2, tasks: local })
    expect(store.load()).toEqual(local)
    store.dispose()
  })
})
