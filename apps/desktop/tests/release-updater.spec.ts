import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkForDeepSeekerRelease,
  compareReleaseVersions,
  downloadDeepSeekerRelease,
  RELEASE_CHECK_TIMEOUT_MS,
  UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS,
  type DeepSeekerReleaseUpdate,
} from '../src/release-updater.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseeker-update-'))
  roots.push(root)
  return root
}

function zipArtifact(): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(256, 0x5a),
  ])
}

function releaseResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/deepseeker-app/DeepSeeker/releases/tag/v0.2.0',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'DeepSeeker-mac-x64.zip',
        size: 20,
        digest: null,
        browser_download_url:
          'https://github.com/deepseeker-app/DeepSeeker/releases/download/v0.2.0/DeepSeeker-mac-x64.zip',
      },
      {
        name: 'DeepSeeker-mac-arm64.zip',
        size: 30,
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        browser_download_url:
          'https://github.com/deepseeker-app/DeepSeeker/releases/download/v0.2.0/DeepSeeker-mac-arm64.zip',
      },
      {
        name: 'DeepSeeker-windows-x64-setup.exe',
        size: 40,
        digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        browser_download_url:
          'https://github.com/deepseeker-app/DeepSeeker/releases/download/v0.2.0/DeepSeeker-windows-x64-setup.exe',
      },
    ],
    ...overrides,
  })
}

function responseWithUrl(body: Buffer, url = 'https://release-assets.githubusercontent.com/private/object'): Response {
  const response = new Response(Uint8Array.from(body), { status: 200 })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function abortError(signal: AbortSignal | null | undefined): Error {
  const reason: unknown = signal?.reason
  return reason instanceof Error ? reason : new Error('Operation aborted', { cause: reason })
}

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('GitHub Release discovery', () => {
  it('compares stable and prerelease SemVer without numeric overflow', () => {
    expect(compareReleaseVersions('v0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareReleaseVersions('0.2.0', '0.2.0-rc.5')).toBeGreaterThan(0)
    expect(compareReleaseVersions('999999999999999999.0.0', '2.0.0')).toBeGreaterThan(0)
    expect(compareReleaseVersions('not-a-version', '0.1.0')).toBeNull()
  })

  it('selects the matching stable macOS and Windows assets', async () => {
    const mac = await checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      request: async () => releaseResponse(),
    })
    expect(mac).toEqual(expect.objectContaining({
      version: '0.2.0',
      tagName: 'v0.2.0',
    }))
    expect(mac?.asset).toEqual(expect.objectContaining({ name: 'DeepSeeker-mac-arm64.zip', artifact: 'zip' }))

    const windows = await checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      request: async () => releaseResponse(),
    })
    expect(windows?.asset?.name).toBe('DeepSeeker-windows-x64-setup.exe')
  })

  it('separates no update from a failed or untrusted check', async () => {
    await expect(checkForDeepSeekerRelease({
      currentVersion: '0.2.0',
      platform: 'darwin',
      arch: 'arm64',
      request: async () => releaseResponse(),
    })).resolves.toBeNull()
    await expect(checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      request: async () => releaseResponse({ html_url: 'https://evil.example/v0.2.0' }),
    })).resolves.toBeUndefined()
    await expect(checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      request: async () => { throw new Error('offline') },
    })).resolves.toBeUndefined()
  })

  it('does not offer an automatic download when GitHub omits the asset digest', async () => {
    const release = await checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'x64',
      request: async () => releaseResponse(),
    })

    expect(release).toEqual(expect.objectContaining({ version: '0.2.0' }))
    expect(release?.asset).toBeUndefined()
  })

  it('settles a release check when the network never responds', async () => {
    vi.useFakeTimers()
    const request = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(abortError(init.signal))
        }, { once: true })
      })
    })
    const checking = checkForDeepSeekerRelease({
      currentVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      request,
    })

    await vi.advanceTimersByTimeAsync(RELEASE_CHECK_TIMEOUT_MS)

    await expect(checking).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledOnce()
  })
})

describe('GitHub Release download', () => {
  function updateFor(buffer: Buffer, digest = createHash('sha256').update(buffer).digest('hex')): DeepSeekerReleaseUpdate {
    return {
      version: '0.2.0',
      tagName: 'v0.2.0',
      htmlUrl: 'https://github.com/deepseeker-app/DeepSeeker/releases/tag/v0.2.0',
      asset: {
        name: 'DeepSeeker-mac-arm64.zip',
        url: 'https://github.com/deepseeker-app/DeepSeeker/releases/download/v0.2.0/DeepSeeker-mac-arm64.zip',
        size: buffer.length,
        artifact: 'zip',
        sha256: digest,
      },
    }
  }

  it('writes progress and publishes only a size-, digest- and signature-verified asset', async () => {
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const progress = vi.fn()
    const completed = await downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      request: async () => responseWithUrl(artifact),
      onProgress: progress,
    })

    expect(basename(completed)).toBe('DeepSeeker-mac-arm64.zip')
    expect(readFileSync(completed)).toEqual(artifact)
    expect(progress).toHaveBeenLastCalledWith(artifact.length, artifact.length)
    expect(readdirSync(join(userData, 'updates', '0.2.0')).filter(name => name.endsWith('.partial'))).toEqual([])
  })

  it('reuses a verified completed installer without starting another download', async () => {
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const directory = join(userData, 'updates', '0.2.0')
    const completed = join(directory, 'DeepSeeker-mac-arm64.zip')
    mkdirSync(directory, { recursive: true })
    writeFileSync(completed, artifact)
    const request = vi.fn()
    const progress = vi.fn()

    await expect(downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      request,
      onProgress: progress,
    })).resolves.toBe(completed)

    expect(request).not.toHaveBeenCalled()
    expect(progress).toHaveBeenCalledOnce()
    expect(progress).toHaveBeenCalledWith(artifact.length, artifact.length)
    expect(readFileSync(completed)).toEqual(artifact)
  })

  it('cancels completed-installer verification without starting a replacement download', async () => {
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const directory = join(userData, 'updates', '0.2.0')
    const completed = join(directory, 'DeepSeeker-mac-arm64.zip')
    mkdirSync(directory, { recursive: true })
    writeFileSync(completed, artifact)
    const request = vi.fn()
    const abort = new AbortController()
    abort.abort(new DOMException('quit', 'AbortError'))

    await expect(downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      request,
      signal: abort.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(request).not.toHaveBeenCalled()
    expect(readFileSync(completed)).toEqual(artifact)
  })

  it('keeps an old completed file until its verified replacement is ready', async () => {
    const userData = temporaryRoot()
    const oldArtifact = zipArtifact()
    const newArtifact = Buffer.from(oldArtifact)
    newArtifact[newArtifact.length - 1] = 0x59
    const directory = join(userData, 'updates', '0.2.0')
    const completed = join(directory, 'DeepSeeker-mac-arm64.zip')
    mkdirSync(directory, { recursive: true })
    writeFileSync(completed, oldArtifact)

    await expect(downloadDeepSeekerRelease({
      release: updateFor(newArtifact),
      userDataPath: userData,
      request: async () => { throw new Error('offline') },
    })).rejects.toMatchObject({ code: 'network' })
    expect(readFileSync(completed)).toEqual(oldArtifact)

    await expect(downloadDeepSeekerRelease({
      release: updateFor(newArtifact),
      userDataPath: userData,
      request: async () => responseWithUrl(Buffer.alloc(newArtifact.length)),
    })).rejects.toMatchObject({ code: 'digest' })
    expect(readFileSync(completed)).toEqual(oldArtifact)

    await expect(downloadDeepSeekerRelease({
      release: updateFor(newArtifact),
      userDataPath: userData,
      request: async () => responseWithUrl(newArtifact),
    })).resolves.toBe(completed)
    expect(readFileSync(completed)).toEqual(newArtifact)
    expect(readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([])
  })

  it('rejects digest mismatch, invalid archives and untrusted redirects without leftovers', async () => {
    const cases = [
      { buffer: zipArtifact(), digest: '0'.repeat(64), url: 'https://release-assets.githubusercontent.com/object' },
      { buffer: Buffer.alloc(zipArtifact().length), digest: undefined, url: 'https://release-assets.githubusercontent.com/object' },
      { buffer: zipArtifact(), digest: undefined, url: 'https://evil.example/payload' },
    ]
    for (const testCase of cases) {
      const userData = temporaryRoot()
      const release = updateFor(
        testCase.buffer,
        testCase.digest ?? createHash('sha256').update(testCase.buffer).digest('hex'),
      )
      await expect(downloadDeepSeekerRelease({
        release,
        userDataPath: userData,
        request: async () => responseWithUrl(testCase.buffer, testCase.url),
      })).rejects.toThrow()
      const directory = join(userData, 'updates', '0.2.0')
      if (existsSync(directory)) expect(readdirSync(directory)).toEqual([])
    }
  })

  it('closes an aborted response and removes its partial file before settling', async () => {
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const abort = new AbortController()
    const firstChunkWritten = Promise.withResolvers<undefined>()
    const downloading = downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      signal: abort.signal,
      request: async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from(artifact.subarray(0, 32)))
            init.signal?.addEventListener('abort', () => {
              controller.error(new DOMException('aborted', 'AbortError'))
            }, { once: true })
          },
        })
        const response = new Response(body, { status: 200 })
        Object.defineProperty(response, 'url', {
          value: 'https://release-assets.githubusercontent.com/private/object',
        })
        return response
      },
      onProgress: () => { firstChunkWritten.resolve(undefined) },
    })

    await firstChunkWritten.promise
    abort.abort()
    await expect(downloading).rejects.toThrow()
    expect(readdirSync(join(userData, 'updates', '0.2.0'))).toEqual([])
  })

  it('times out while waiting for an installer response', async () => {
    vi.useFakeTimers()
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const requestStarted = Promise.withResolvers<undefined>()
    const downloading = downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      request: (_url, init) => {
        requestStarted.resolve(undefined)
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(abortError(init.signal))
          }, { once: true })
        })
      },
    })

    await requestStarted.promise
    const timedOut = expect(downloading).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS)

    await timedOut
    expect(readdirSync(join(userData, 'updates', '0.2.0'))).toEqual([])
  })

  it('times out a stalled response body and removes its partial file', async () => {
    vi.useFakeTimers()
    const userData = temporaryRoot()
    const artifact = zipArtifact()
    const firstChunkWritten = Promise.withResolvers<undefined>()
    const downloading = downloadDeepSeekerRelease({
      release: updateFor(artifact),
      userDataPath: userData,
      request: async (_url, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Uint8Array.from(artifact.subarray(0, 32)))
            init.signal?.addEventListener('abort', () => {
              controller.error(abortError(init.signal))
            }, { once: true })
          },
        })
        const response = new Response(body, { status: 200 })
        Object.defineProperty(response, 'url', {
          value: 'https://release-assets.githubusercontent.com/private/object',
        })
        return response
      },
      onProgress: () => { firstChunkWritten.resolve(undefined) },
    })

    await firstChunkWritten.promise
    const timedOut = expect(downloading).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS)

    await timedOut
    expect(readdirSync(join(userData, 'updates', '0.2.0'))).toEqual([])
  })
})
