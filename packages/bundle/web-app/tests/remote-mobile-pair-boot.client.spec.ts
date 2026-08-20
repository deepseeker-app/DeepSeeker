// @vitest-environment jsdom
/** Standalone mobile entry establishes pairing before mounting data flows. */

import { describe, expect, it, vi } from 'vitest'
import {
  bootMobilePair,
  type MobilePairPage,
} from '../node_modules/@linxin666/dsh-remote-web-ui/src/mobile/pair-boot.ts'

function page(href: string): MobilePairPage & { replaced: string[] } {
  const replaced: string[] = []
  return {
    href,
    replaced,
    replaceState(url) { replaced.push(url) },
  }
}

describe('mobile pair bootstrap', () => {
  it('accepts the one-time token before declaring the mobile app ready', async () => {
    const surface = page('https://remote.example/m?pair=secret&workspace=w#chat')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true }), { status: 200 }))

    await expect(bootMobilePair(surface, fetcher)).resolves.toEqual({ kind: 'ready' })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/pair/accept', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ token: 'secret' }),
    }))
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/pair/status', { credentials: 'same-origin' })
    expect(surface.replaced).toEqual(['/m?workspace=w#chat'])
  })

  it('does not mount when the accept response cannot establish a usable cookie', async () => {
    const surface = page('https://remote.example/m?pair=secret')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: false }), { status: 200 }))

    await expect(bootMobilePair(surface, fetcher)).resolves.toEqual({ kind: 'failed', reason: 'status' })
    expect(surface.replaced).toEqual(['/m'])
  })

  it('does not start the workbench when a token is refused', async () => {
    const surface = page('https://remote.example/m?pair=used')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 409 }))

    await expect(bootMobilePair(surface, fetcher)).resolves.toEqual({ kind: 'failed', reason: 'accept' })
    expect(surface.replaced).toEqual(['/m'])
  })

  it.each([
    [true, { kind: 'ready' }],
    [false, { kind: 'unpaired' }],
  ] as const)('checks the existing cookie before mounting a bare /m page', async (paired, expected) => {
    const surface = page('https://remote.example/m')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, paired }), { status: 200 }))

    await expect(bootMobilePair(surface, fetcher)).resolves.toEqual(expected)
    expect(fetcher).toHaveBeenCalledWith('/api/pair/status', { credentials: 'same-origin' })
  })
})
