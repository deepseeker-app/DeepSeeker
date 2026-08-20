import { describe, expect, it, vi } from 'vitest'
import {
  waitForRendererReady,
  type RendererWebContents,
} from '../src/renderer-readiness.ts'

function renderer(executeJavaScript: RendererWebContents['executeJavaScript']): RendererWebContents {
  return {
    isDestroyed: () => false,
    executeJavaScript,
  }
}

describe('desktop renderer readiness', () => {
  it('accepts only the committed Web-shell marker', async () => {
    const values = [false, false, true]
    const executeJavaScript = vi.fn(async () => values.shift())
    const contents = renderer(executeJavaScript)

    await expect(waitForRendererReady(contents, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      probeTimeoutMs: 20,
    })).resolves.toBeUndefined()
    expect(executeJavaScript).toHaveBeenCalledTimes(3)
    expect(executeJavaScript).toHaveBeenCalledWith(
      "document.documentElement.getAttribute('data-dsh-app-ready') === 'true'",
      false,
    )
  })

  it('recovers from a transient evaluation failure', async () => {
    let attempts = 0
    const executeJavaScript = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('renderer reloading')
      return true
    })
    const contents = renderer(executeJavaScript)

    await expect(waitForRendererReady(contents, {
      timeoutMs: 100,
      pollIntervalMs: 1,
      probeTimeoutMs: 20,
    })).resolves.toBeUndefined()
  })

  it('bounds a renderer evaluation that never settles', async () => {
    const contents = renderer(vi.fn(() => new Promise(() => {})))

    await expect(waitForRendererReady(contents, {
      timeoutMs: 15,
      pollIntervalMs: 1,
      probeTimeoutMs: 3,
    })).rejects.toThrow('renderer readiness probe timed out')
  })

  it('rejects a renderer destroyed before readiness', async () => {
    const executeJavaScript = vi.fn(async () => true)
    const contents: RendererWebContents = {
      isDestroyed: () => true,
      executeJavaScript,
    }

    await expect(waitForRendererReady(contents, { timeoutMs: 20 }))
      .rejects.toThrow('renderer was destroyed')
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
})
