/** Paired mobile bridge contracts for cwd/Skill/context and answerable requests. */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { makeMobileApiRoutes } from '@linxin666/dsh-remote-web-ui/src/mobile-api.ts'
import { foldEvents, type WireEvent } from '@linxin666/dsh-remote-web-ui/src/mobile/messages.ts'
import { MuxClient, type EventSourceLike } from '@linxin666/dsh-remote-web-ui/src/mobile/mux.ts'
import { PairingService } from '@linxin666/dsh-remote-web-ui/src/pairing.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => { resolve() })
  })))
})

function pairedService(): { service: PairingService; cookie: string } {
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  }, {
    now: () => 1_000,
    randomToken: () => 'mobile-core-token',
  })
  service.setPublicBaseUrl('https://phone.example')
  const accepted = service.accept(service.issue().token)
  if (!accepted.ok) throw new Error('test pairing failed')
  return { service, cookie: `dsh_pair=${accepted.deviceId}` }
}

async function serveMobileApi(service: PairingService, apiProxy: ApiProxy): Promise<AddressInfo> {
  const route = makeMobileApiRoutes({ service, apiProxy })
    .find(candidate => candidate.kind === 'prefix' && candidate.path === '/m/api')
  if (route === undefined) throw new Error('mobile api route missing')
  const server = createServer((req, res) => { void route.handler(req, res) })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  return server.address() as AddressInfo
}

async function postJson(address: AddressInfo, path: string, body: unknown, cookie?: string): Promise<{
  status: number
  body: unknown
}> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: response.statusCode ?? 0, body: text === '' ? undefined : JSON.parse(text) })
      })
    })
    request.on('error', reject)
    request.end(JSON.stringify(body))
  })
}

function clientRequest(rpcId: string, method: string, payload: unknown): unknown {
  return { type: 'client-request', rpcId, method, payload }
}

describe('paired mobile bridge', () => {
  it('keeps cwd and AGENTS resolution Host-owned while forwarding Skill and prompt session identity exactly', async () => {
    const { service, cookie } = pairedService()
    const create = vi.fn((request: RpcRequest<{ cwd?: string }>) => Promise.resolve({
      rpcId: request.rpcId,
      result: { ok: true as const, value: { sessionId: 'session-in-cwd' } },
    }))
    const listSkills = vi.fn((request: RpcRequest<{ sessionId: string }>) => Promise.resolve({
      rpcId: request.rpcId,
      result: { ok: true as const, value: { skills: [{ name: 'gewu', description: '深入检查', modelInvocable: true }] } },
    }))
    const prompt = vi.fn((request: RpcRequest<unknown>) => Promise.resolve({
      rpcId: request.rpcId,
      result: { ok: true as const, value: { accepted: true } },
    }))
    const apiProxy = {
      sessions: { create, prompt },
      skills: { list: listSkills },
    } as unknown as ApiProxy
    const address = await serveMobileApi(service, apiProxy)

    const created = await postJson(address, '/m/api/session.create', clientRequest(
      'create-rpc', 'session.create', { cwd: '/repo/app' },
    ), cookie)
    const catalog = await postJson(address, '/m/api/skill.list', clientRequest(
      'skill-rpc', 'skill.list', { sessionId: 'session-in-cwd' },
    ), cookie)
    const sent = await postJson(address, '/m/api/session.prompt', clientRequest(
      'prompt-rpc', 'session.prompt', {
        sessionId: 'session-in-cwd',
        mode: 'queue',
        content: [{ type: 'text', text: '/gewu 检查这个项目' }],
      },
    ), cookie)

    expect(created.status).toBe(200)
    expect(catalog.status).toBe(200)
    expect(sent.status).toBe(200)
    expect(create.mock.calls[0]?.[0].payload).toEqual({ cwd: '/repo/app' })
    expect(listSkills.mock.calls[0]?.[0].payload).toEqual({ sessionId: 'session-in-cwd' })
    expect(prompt.mock.calls[0]?.[0].payload).toEqual({
      sessionId: 'session-in-cwd',
      mode: 'queue',
      content: [{ type: 'text', text: '/gewu 检查这个项目' }],
    })
  })

  it('accepts a paired protocol response but keeps local-only settings outside the allowlist', async () => {
    const { service, cookie } = pairedService()
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const apiProxy = { respond } as unknown as ApiProxy
    const address = await serveMobileApi(service, apiProxy)
    const response = {
      type: 'client-response',
      rpcId: 'approval-rpc',
      result: {
        ok: true,
        value: {
          sessionId: 'session-in-cwd',
          approvalId: 'approval-1',
          outcome: 'rejected',
        },
      },
    }

    const unpaired = await postJson(address, '/m/api/respond', response)
    const paired = await postJson(address, '/m/api/respond', response, cookie)
    const settings = await postJson(address, '/m/api/settings.read', clientRequest(
      'settings-rpc', 'settings.read', { ns: 'model.deepseek' },
    ), cookie)

    expect(unpaired.status).toBe(403)
    expect(paired).toEqual({ status: 200, body: { accepted: true } })
    expect(respond).toHaveBeenCalledWith(response)
    expect(settings.status).toBe(403)
  })
})

describe('mobile internal-context boundary', () => {
  it('preserves answerable mux rpcIds while hiding AGENTS context from user chat rows', () => {
    let source: EventSourceLike | undefined
    const client = new MuxClient('/events', {
      sourceFactory: () => {
        source = { onmessage: null, onerror: null, close: vi.fn() }
        return source
      },
      stallThresholdMs: 60_000,
    })
    const listener = vi.fn<(frame: MuxFrame, rpcId?: string) => void>()
    client.onFrame(listener)
    client.start()
    source?.onmessage?.({ data: JSON.stringify({
      type: 'server-request',
      rpcId: 'question-rpc',
      method: 'events.mux',
      payload: {
        type: 'question/requested',
        sessionId: 'session-in-cwd',
        questions: [{ id: 'confirm', question: '继续吗？' }],
      },
    }) })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'question/requested' }), 'question-rpc')
    client.stop()

    const events: WireEvent[] = [
      {
        type: 'user/message', seq: 1, time: 1,
        data: {
          id: 'agents-context',
          content: [{ type: 'text', text: 'Instructions from: AGENTS.md\nsecret internal rules' }],
          source: { kind: 'agent-instructions' },
        },
      },
      {
        type: 'user/message', seq: 2, time: 2,
        data: {
          id: 'real-user',
          content: [{ type: 'text', text: '手机发来的真实问题' }],
          source: { kind: 'user' },
        },
      },
    ]
    expect(foldEvents(events).map(message => message.text)).toEqual(['手机发来的真实问题'])
  })
})
