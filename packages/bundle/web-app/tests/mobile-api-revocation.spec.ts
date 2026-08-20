/** Active mobile streams must die at the same commit that revokes pairing. */

import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { makeMobileApiRoutes, MOBILE_API_PATHS } from '@linxin666/dsh-remote-web-ui/src/mobile-api.ts'
import { PairingService } from '@linxin666/dsh-remote-web-ui/src/pairing.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })))
})

describe('mobile mux revocation', () => {
  it('publishes every paired-device authorization change independently of snapshots', () => {
    let tokenSerial = 0
    const service = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 1,
      cookieName: 'dsh_pair',
    }, {
      now: () => 1_000,
      randomToken: () => `auth-${String(++tokenSerial)}`,
    })
    service.setPublicBaseUrl('https://phone.example')
    const changed = vi.fn()
    service.onAuthorizationChanged(changed)

    const first = service.accept(service.issue().token)
    const second = service.accept(service.issue().token)
    if (!first.ok || !second.ok) throw new Error('test pairing failed')

    expect(changed).toHaveBeenCalledTimes(2)
    expect(service.hasDevice(first.deviceId)).toBe(false)
    expect(service.hasDevice(second.deviceId)).toBe(true)

    service.setConfig({ ...service.config })
    expect(changed).toHaveBeenCalledTimes(2)
    service.setConfig({ ...service.config, cookieName: 'replacement_cookie' })
    expect(changed).toHaveBeenCalledTimes(3)
    service.stop()
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('declares and emits the shared Cordis authorization event', () => {
    const source = readFileSync(new URL(
      '../node_modules/@linxin666/dsh-remote-web-ui/src/index.ts',
      import.meta.url,
    ), 'utf8')
    expect(source).toContain("'remote-web-ui/authorization-changed'(): void")
    expect(source).toContain("ctx.emit('remote-web-ui/authorization-changed')")
  })

  it('aborts and ends an existing SSE as soon as pairing is revoked', async () => {
    let tokenSerial = 0
    const service = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      cookieName: 'dsh_pair',
    }, {
      now: () => 1_000,
      randomToken: () => `secret-${String(++tokenSerial)}`,
    })
    service.setPublicBaseUrl('https://phone.example')
    const issued = service.issue()
    const accepted = service.accept(issued.token)
    if (!accepted.ok) throw new Error('test pairing failed')

    let muxAborted = false
    const mux = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
      yield { type: 'server-request', rpcId: 'event-1', method: 'session.updated', payload: {} }
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          muxAborted = true
          resolve()
          return
        }
        signal.addEventListener('abort', () => {
          muxAborted = true
          resolve()
        }, { once: true })
      })
    })
    const apiProxy = {
      events: {
        mux,
      },
    } as unknown as ApiProxy
    const events = makeMobileApiRoutes({ service, apiProxy })
      .find(route => route.kind === 'exact' && route.path === MOBILE_API_PATHS.events)
    if (events === undefined) throw new Error('mobile events route missing')

    const server = createServer((req, res) => { void events.handler(req, res) })
    servers.push(server)
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo

    const responsePromise = new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: MOBILE_API_PATHS.events,
        headers: { cookie: `dsh_pair=${accepted.deviceId}` },
      }, resolve)
      req.on('error', reject)
      req.end()
    })
    const response = await responsePromise
    expect(response.statusCode).toBe(200)
    await once(response, 'data')

    service.stop()

    await once(response, 'end')
    expect(muxAborted).toBe(true)
    expect(mux).toHaveBeenCalledOnce()
  })

  it('closes the evicted device stream even when the snapshot shape stays stable', async () => {
    let tokenSerial = 0
    const service = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 1,
      cookieName: 'dsh_pair',
    }, {
      now: () => 1_000,
      randomToken: () => `eviction-${String(++tokenSerial)}`,
    })
    service.setPublicBaseUrl('https://phone.example')
    const first = service.accept(service.issue().token)
    if (!first.ok) throw new Error('test pairing failed')

    let muxAborted = false
    const mux = vi.fn(async function* (_request: unknown, signal: AbortSignal) {
      yield { type: 'server-request', rpcId: 'event-1', method: 'session.updated', payload: {} }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          muxAborted = true
          resolve()
        }, { once: true })
      })
    })
    const apiProxy = {
      events: {
        mux,
      },
    } as unknown as ApiProxy
    const events = makeMobileApiRoutes({ service, apiProxy })
      .find(route => route.kind === 'exact' && route.path === MOBILE_API_PATHS.events)
    if (events === undefined) throw new Error('mobile events route missing')

    const server = createServer((req, res) => { void events.handler(req, res) })
    servers.push(server)
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: MOBILE_API_PATHS.events,
        headers: { cookie: `dsh_pair=${first.deviceId}` },
      }, resolve)
      req.on('error', reject)
      req.end()
    })
    await once(response, 'data')

    const replacement = service.accept(service.issue().token)
    if (!replacement.ok) throw new Error('replacement pairing failed')

    await once(response, 'end')
    expect(muxAborted).toBe(true)
    expect(service.hasDevice(first.deviceId)).toBe(false)
    expect(service.hasDevice(replacement.deviceId)).toBe(true)
  })

  it('ends the HTTP response when the upstream mux finishes normally', async () => {
    let tokenSerial = 0
    const service = new PairingService({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      cookieName: 'dsh_pair',
    }, {
      now: () => 1_000,
      randomToken: () => `normal-${String(++tokenSerial)}`,
    })
    service.setPublicBaseUrl('https://phone.example')
    const issued = service.issue()
    const accepted = service.accept(issued.token)
    if (!accepted.ok) throw new Error('test pairing failed')

    const mux = vi.fn(async function* () {
      yield { type: 'server-request', rpcId: 'event-1', method: 'session.updated', payload: {} }
    })
    const apiProxy = {
      events: {
        mux,
      },
    } as unknown as ApiProxy
    const events = makeMobileApiRoutes({ service, apiProxy })
      .find(route => route.kind === 'exact' && route.path === MOBILE_API_PATHS.events)
    if (events === undefined) throw new Error('mobile events route missing')

    const server = createServer((req, res) => { void events.handler(req, res) })
    servers.push(server)
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address() as AddressInfo

    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: address.port,
        path: MOBILE_API_PATHS.events,
        headers: { cookie: `dsh_pair=${accepted.deviceId}` },
      }, resolve)
      req.on('error', reject)
      req.end()
    })
    expect(response.statusCode).toBe(200)
    response.resume()
    await once(response, 'end')
    expect(response.complete).toBe(true)
    expect(mux).toHaveBeenCalledOnce()
  })
})
