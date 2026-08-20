import { describe, expect, it, vi } from 'vitest'
import {
  ConfigurationStartupCleanupError,
  startConfigurationWithFallback,
} from '../src/configuration-startup.ts'
import type { ConfigurationScheme } from '../src/configuration-schemes.ts'

const candidate: ConfigurationScheme = {
  id: 'candidate',
  label: '工作',
  harnessHome: '/tmp/candidate',
  builtIn: false,
}
const fallback: ConfigurationScheme = {
  id: 'default',
  label: '默认',
  harnessHome: '/tmp/default',
  builtIn: true,
}

describe('desktop configuration startup', () => {
  it('keeps a candidate whose Host and renderer both start', async () => {
    const start = vi.fn(async () => undefined)
    const rollback = vi.fn(() => fallback)

    await expect(startConfigurationWithFallback({
      initial: candidate,
      lastKnownGoodId: fallback.id,
      start,
      rollback,
    })).resolves.toEqual({ scheme: candidate })
    expect(start).toHaveBeenCalledOnce()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('starts last-known-good after a candidate renderer fails', async () => {
    const start = vi.fn(async (scheme: ConfigurationScheme) => {
      if (scheme.id === candidate.id) throw new Error('renderer did not become ready')
    })
    const rollback = vi.fn(() => fallback)

    await expect(startConfigurationWithFallback({
      initial: candidate,
      lastKnownGoodId: fallback.id,
      start,
      rollback,
    })).resolves.toEqual({ scheme: fallback, recoveredFrom: candidate.label })
    expect(start.mock.calls.map(([scheme]) => scheme.id)).toEqual(['candidate', 'default'])
    expect(rollback).toHaveBeenCalledWith(candidate)
  })

  it('does not retry a failing last-known-good scheme', async () => {
    const failure = new Error('default renderer failed')
    const start = vi.fn(async () => { throw failure })
    const rollback = vi.fn(() => fallback)

    await expect(startConfigurationWithFallback({
      initial: fallback,
      lastKnownGoodId: fallback.id,
      start,
      rollback,
    })).rejects.toBe(failure)
    expect(start).toHaveBeenCalledOnce()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('does not start another Host when failed-generation cleanup fails', async () => {
    const failure = new ConfigurationStartupCleanupError(
      new Error('renderer failed'),
      new Error('Host shutdown failed'),
    )
    const start = vi.fn(async () => { throw failure })
    const rollback = vi.fn(() => fallback)

    await expect(startConfigurationWithFallback({
      initial: candidate,
      lastKnownGoodId: fallback.id,
      start,
      rollback,
    })).rejects.toBe(failure)
    expect(start).toHaveBeenCalledOnce()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('does not start a fallback Host after application shutdown cancellation', async () => {
    const failure = new Error('startup cancelled')
    const start = vi.fn(async () => { throw failure })
    const rollback = vi.fn(() => fallback)

    await expect(startConfigurationWithFallback({
      initial: candidate,
      lastKnownGoodId: fallback.id,
      start,
      cancelled: () => true,
      rollback,
    })).rejects.toBe(failure)
    expect(start).toHaveBeenCalledOnce()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('reports both the candidate and fallback failures', async () => {
    const start = vi.fn(async (scheme: ConfigurationScheme) => {
      throw new Error(`${scheme.id} failed`)
    })

    await expect(startConfigurationWithFallback({
      initial: candidate,
      lastKnownGoodId: fallback.id,
      start,
      rollback: () => fallback,
    })).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'candidate failed' }), expect.objectContaining({ message: 'default failed' })],
    })
  })
})
