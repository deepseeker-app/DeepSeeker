/** Host restarts must preserve paired phones without persisting bearer cookies. */

import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FilePairingPersistence,
  pairingPersistencePath,
  type PairingPersistence,
  type PersistedDeviceSession,
} from '@linxin666/dsh-remote-web-ui/src/pairing-persistence.ts'
import {
  PairingService,
  type PairingClock,
  type PairingConfig,
} from '@linxin666/dsh-remote-web-ui/src/pairing.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const config: PairingConfig = {
  tokenTtlMs: 60_000,
  offlineAfterMs: 5_000,
  maxDevices: 4,
  cookieName: 'dsh_pair',
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseeker-pairing-'))
  roots.push(root)
  return root
}

function clock(values: readonly string[], now = 1_000): PairingClock {
  let index = 0
  return {
    now: () => now,
    randomToken: () => values[index++] ?? `entropy-${String(index)}`,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('paired-device persistence', () => {
  it('keeps a paired phone authorized across Host restarts without storing its cookie', () => {
    const root = temporaryRoot()
    const filename = pairingPersistencePath({ DSH_HOME: root }, temporaryRoot())
    const persistence = new FilePairingPersistence(filename)
    const first = new PairingService(config, clock(['one-time-pair-token', 'phone-cookie']), persistence)
    first.setPublicBaseUrl('https://remote.example')
    const accepted = first.accept(first.issue().token)

    expect(accepted).toEqual({ ok: true, deviceId: 'phone-cookie' })
    expect(first.hasDevice('phone-cookie')).toBe(true)
    expect(existsSync(filename)).toBe(true)
    expect(readFileSync(filename, 'utf8')).not.toContain('phone-cookie')
    if (process.platform !== 'win32') {
      expect(statSync(filename).mode & 0o777).toBe(0o600)
      expect(statSync(join(root, 'remote-web-ui')).mode & 0o777).toBe(0o700)
    }

    const restarted = new PairingService(config, clock([], 10_000), new FilePairingPersistence(filename))
    restarted.setPublicBaseUrl('https://remote.example')
    expect(restarted.hasDevice('phone-cookie')).toBe(true)
    expect(restarted.snapshot()).toMatchObject({ phase: 'disconnected', deviceCount: 1, onlineCount: 0 })
    expect(restarted.touchDevice('phone-cookie')).toBe(true)
    expect(restarted.snapshot()).toMatchObject({ phase: 'connected', deviceCount: 1, onlineCount: 1 })
  })

  it('persists explicit revocation so a stopped phone stays revoked after restart', () => {
    const root = temporaryRoot()
    const filename = pairingPersistencePath({ DSH_HOME: root })
    const persistence = new FilePairingPersistence(filename)
    const service = new PairingService(config, clock(['pair-token', 'phone-cookie']), persistence)
    service.setPublicBaseUrl('https://remote.example')
    const accepted = service.accept(service.issue().token)
    if (!accepted.ok) throw new Error('test pairing failed')

    service.stop()

    expect(service.hasDevice(accepted.deviceId)).toBe(false)
    const restarted = new PairingService(config, clock([]), new FilePairingPersistence(filename))
    expect(restarted.hasDevice(accepted.deviceId)).toBe(false)
    expect(restarted.snapshot().deviceCount).toBe(0)
  })

  it('keeps durable authorization when one process generation is disposed', () => {
    const root = temporaryRoot()
    const filename = pairingPersistencePath({ DSH_HOME: root })
    const persistence = new FilePairingPersistence(filename)
    const service = new PairingService(config, clock(['pair-token', 'phone-cookie']), persistence)
    service.setPublicBaseUrl('https://remote.example')
    const accepted = service.accept(service.issue().token)
    if (!accepted.ok) throw new Error('test pairing failed')

    service.dispose()

    expect(service.hasDevice(accepted.deviceId)).toBe(false)
    const restarted = new PairingService(config, clock([]), new FilePairingPersistence(filename))
    expect(restarted.hasDevice(accepted.deviceId)).toBe(true)
  })

  it('rolls back an accept when the durable authorization set cannot commit', () => {
    let fail = true
    let committed: readonly PersistedDeviceSession[] = []
    const persistence: PairingPersistence = {
      load: () => committed,
      replace: (devices) => {
        if (fail) throw new Error('disk full')
        committed = devices
      },
    }
    const service = new PairingService(config, clock(['pair-token', 'first-cookie', 'second-cookie']), persistence)
    service.setPublicBaseUrl('https://remote.example')
    const issued = service.issue()

    expect(() => service.accept(issued.token)).toThrow('disk full')
    expect(service.hasDevice('first-cookie')).toBe(false)
    expect(service.snapshot().deviceCount).toBe(0)

    fail = false
    expect(service.accept(issued.token)).toEqual({ ok: true, deviceId: 'second-cookie' })
    expect(service.hasDevice('second-cookie')).toBe(true)
    expect(committed).toHaveLength(1)
  })

  it('fails closed when the persisted file is not a bounded regular JSON file', () => {
    const root = temporaryRoot()
    const filename = pairingPersistencePath({ DSH_HOME: root })
    const persistence = new FilePairingPersistence(filename)
    persistence.replace([])
    rmSync(filename)
    const outside = temporaryRoot()
    symlinkSync(outside, filename)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const service = new PairingService(config, clock([]), persistence)

    expect(lstatSync(filename).isSymbolicLink()).toBe(true)
    expect(service.snapshot().deviceCount).toBe(0)
    expect(error).toHaveBeenCalledOnce()
  })
})
