// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { waitForPluginBoot } from '../src/boot.tsx'

describe('plugin boot deadline', () => {
  it('resolves normally and clears its deadline', async () => {
    vi.useFakeTimers()
    const timeoutError = vi.fn(() => new Error('late'))

    await expect(waitForPluginBoot(Promise.resolve(), 25, timeoutError)).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(25)

    expect(timeoutError).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects a stuck activation with the diagnostic error', async () => {
    vi.useFakeTimers()
    const pending = new Promise<void>(() => {})
    const failure = new Error('plugin-a: pending (waiting for service: slots)')
    const result = waitForPluginBoot(pending, 25, () => failure)
    const rejected = expect(result).rejects.toBe(failure)

    await vi.advanceTimersByTimeAsync(25)

    await rejected
    vi.useRealTimers()
  })
})
