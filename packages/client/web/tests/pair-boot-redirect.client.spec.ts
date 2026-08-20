// @vitest-environment jsdom
/** Legacy root pair links redirect before the desktop plugin graph boots. */

import { describe, expect, it, vi } from 'vitest'
import { AppWebEntry, legacyMobilePairRedirect } from '../src/boot.tsx'

describe('pair bootstrap redirect', () => {
  it('preserves the token, workspace, and hash while targeting /m', () => {
    expect(legacyMobilePairRedirect('https://remote.example/?pair=secret&workspace=w%2F1#chat')).toBe(
      '/m?pair=secret&workspace=w%2F1#chat',
    )
    expect(legacyMobilePairRedirect('https://remote.example/m?pair=secret')).toBeUndefined()
    expect(legacyMobilePairRedirect('https://remote.example/')).toBeUndefined()
  })

  it('redirects before parsing the manifest or opening plugin transports', async () => {
    const replace = vi.fn()
    const mount = document.createElement('div')
    const entry = new AppWebEntry(mount, {
      location: { href: 'https://remote.example/?pair=secret&workspace=w', replace },
    })

    await entry.run()

    expect(replace).toHaveBeenCalledOnce()
    expect(replace).toHaveBeenCalledWith('/m?pair=secret&workspace=w')
    expect(mount.childElementCount).toBe(0)
  })
})
