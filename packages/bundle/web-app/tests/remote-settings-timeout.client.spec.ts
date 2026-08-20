/** Deadline regression for the patched mobile-remote settings card. */

import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CardForm,
  FIELD_WRITE_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
  textField,
} from '../node_modules/@linxin666/dsh-remote-web-ui/src/client/settings-form.ts'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

interface RemoteSettingsSnapshot {
  tunnelTokenConfigured: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  tunnelToken: { text: string }
}

interface RemoteSettingsFace {
  hooks: {
    remoteSettingsCard: {
      getSnapshot(): RemoteSettingsSnapshot
    }
  }
  edit(field: string, value: string): void
  save(): void
}

type RemoteSettingsCardControllerConstructor = new (
  scope: unknown,
  connection: unknown,
) => {
  inject(): RemoteSettingsFace
}

let RemoteSettingsCardController: RemoteSettingsCardControllerConstructor

beforeAll(async () => {
  const modulePath = [
    '../node_modules/@linxin666/dsh-remote-web-ui/src/client',
    'RemoteSettingsCard.tsx',
  ].join('/')
  const module = await vi.importActual(modulePath) as {
    RemoteSettingsCardController: RemoteSettingsCardControllerConstructor
  }
  RemoteSettingsCardController = module.RemoteSettingsCardController
})

afterEach(() => {
  vi.useRealTimers()
})

describe('mobile remote settings deadlines', () => {
  it('leaves saving state and keeps the draft when a field write never settles', async () => {
    vi.useFakeTimers()
    const host = stubSettingsScope<Record<string, unknown>>()
    host.publish({
      status: 'ready',
      writable: true,
      value: { publicBaseUrl: 'https://old.example' },
      base: { publicBaseUrl: 'https://old.example' },
      user: {},
    })
    let writeSignal: AbortSignal | undefined
    host.scope.set = (_field, _value, signal) => {
      writeSignal = signal
      return new Promise<void>(() => {})
    }
    const form = new CardForm(host.scope, [textField('publicBaseUrl')])
    form.actions().edit('publicBaseUrl', 'https://new.example')

    const saving = form.save()
    const rejected = expect(saving).rejects.toThrow('settings field write timed out')
    expect(form.shell()).toMatchObject({ dirty: true, saving: true, failed: false })

    await vi.advanceTimersByTimeAsync(FIELD_WRITE_TIMEOUT_MS)
    await rejected

    expect(FIELD_WRITE_TIMEOUT_MS).toBe(4_000)
    expect(SAVE_TIMEOUT_MS).toBe(10_000)
    expect(writeSignal?.aborted).toBe(true)
    expect(form.shell()).toMatchObject({ dirty: true, saving: false, failed: true })
    expect(form.field('publicBaseUrl').text).toBe('https://new.example')
  })

  it('keeps edits typed while an earlier save is still in flight', async () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const base = { publicBaseUrl: 'https://old.example' }
    host.publish({ status: 'ready', writable: true, value: base, base, user: {} })

    let releaseWrite: (() => void) | undefined
    const set = vi.fn(async (_field: string, value: unknown) => {
      await new Promise<void>((resolve) => { releaseWrite = resolve })
      const user = { publicBaseUrl: value }
      host.publish({ status: 'ready', writable: true, value: user, base, user })
    })
    host.scope.set = set
    const form = new CardForm(host.scope, [textField('publicBaseUrl')])
    const actions = form.actions()
    actions.edit('publicBaseUrl', 'https://submitted.example')

    const saving = form.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalledOnce() })
    actions.edit('publicBaseUrl', 'https://typed-during-save.example')
    releaseWrite?.()
    await saving

    expect(set).toHaveBeenCalledWith(
      'publicBaseUrl',
      'https://submitted.example',
      expect.any(AbortSignal),
    )
    expect(form.shell()).toMatchObject({ dirty: true, saving: false, failed: false })
    expect(form.field('publicBaseUrl').text).toBe('https://typed-during-save.example')
  })

  it('writes a named Tunnel token without ever seeding the secret field from a response', async () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    host.publish({
      status: 'ready',
      writable: true,
      value: { tunnelMode: 'named' },
      base: { tunnelMode: 'lan' },
      user: { tunnelMode: 'named' },
    })
    let configured = false
    const describe = vi.fn(() => Promise.resolve({
      rpcId: 'describe',
      result: {
        ok: true as const,
        value: {
          credentials: {
            DEEPSEEK_CLOUDFLARE_TUNNEL_TOKEN: { configured, writable: true },
          },
        },
      },
    }))
    const set = vi.fn(() => {
      configured = true
      return Promise.resolve({ rpcId: 'set', result: { ok: true as const, value: {} } })
    })
    const controller = new RemoteSettingsCardController(host.scope, {
      credentials: { describe, set, unset: vi.fn() },
    })
    const face = controller.inject()

    await vi.waitFor(() => {
      expect(face.hooks.remoteSettingsCard.getSnapshot().tunnelTokenConfigured).toBe(false)
      expect(describe).toHaveBeenCalledOnce()
    })
    expect(face.hooks.remoteSettingsCard.getSnapshot().tunnelToken.text).toBe('')

    face.edit('tunnelToken', 'super-secret-token')
    face.save()

    await vi.waitFor(() => {
      expect(set).toHaveBeenCalledOnce()
      expect(face.hooks.remoteSettingsCard.getSnapshot()).toMatchObject({
        tunnelTokenConfigured: true,
        dirty: false,
        saving: false,
        failed: false,
      })
    })
    expect(set).toHaveBeenCalledWith(
      { ref: 'DEEPSEEK_CLOUDFLARE_TUNNEL_TOKEN', value: 'super-secret-token' },
      expect.any(AbortSignal),
    )
    expect(face.hooks.remoteSettingsCard.getSnapshot().tunnelToken.text).toBe('')
  })

  it('keeps a rejected Tunnel token draft so the user can retry', async () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    host.publish({
      status: 'ready',
      writable: true,
      value: { tunnelMode: 'named' },
      base: { tunnelMode: 'lan' },
      user: { tunnelMode: 'named' },
    })
    const controller = new RemoteSettingsCardController(host.scope, {
      credentials: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'describe',
          result: {
            ok: true as const,
            value: {
              credentials: {
                DEEPSEEK_CLOUDFLARE_TUNNEL_TOKEN: { configured: false, writable: true },
              },
            },
          },
        })),
        set: vi.fn(() => Promise.resolve({
          rpcId: 'set',
          result: {
            ok: false as const,
            error: { code: 'credential-rejected', message: 'read-only credential', details: {} },
          },
        })),
        unset: vi.fn(),
      },
    })
    const face = controller.inject()

    face.edit('tunnelToken', 'retry-this-token')
    face.save()

    await vi.waitFor(() => {
      expect(face.hooks.remoteSettingsCard.getSnapshot()).toMatchObject({
        dirty: true,
        saving: false,
        failed: true,
      })
    })
    expect(face.hooks.remoteSettingsCard.getSnapshot().tunnelToken.text).toBe('retry-this-token')
  })
})
