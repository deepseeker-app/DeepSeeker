/** GitHub Releases discovery and verified installer downloads for DeepSeeker. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'

const RELEASE_API_URL = 'https://api.github.com/repos/deepseeker-app/DeepSeeker/releases/latest'
const MAX_RELEASE_RESPONSE_BYTES = 512 * 1024
const MAX_UPDATE_DOWNLOAD_BYTES = 1024 * 1024 * 1024
/** Maximum wall time for one GitHub Release metadata check. */
export const RELEASE_CHECK_TIMEOUT_MS = 15_000
/** Maximum time an installer download may make no network progress. */
export const UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000

const RELEASE_DOWNLOAD_PREFIX = '/deepseeker-app/DeepSeeker/releases/download/'
const RELEASE_PAGE_PREFIX = '/deepseeker-app/DeepSeeker/releases/tag/'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const DMG_TRAILER_BYTES = 512
const DMG_MAGIC = Buffer.from('koly', 'ascii')
const PE_OFFSET_POSITION = 0x3c
const PE_MAGIC = Buffer.from([0x50, 0x45, 0x00, 0x00])
const SEMVER_PATTERN = new RegExp(
  String.raw`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)`
    + String.raw`(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?`
    + String.raw`(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`,
  'u',
)

type DesktopReleasePlatform = 'darwin' | 'win32'
type DesktopReleaseArtifact = 'dmg' | 'exe' | 'zip'
type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** One installer-like asset selected from a public GitHub Release. */
interface DeepSeekerReleaseAsset {
  readonly name: string
  readonly url: string
  readonly size: number
  readonly artifact: DesktopReleaseArtifact
  readonly sha256: string
}

/** Latest stable release compared with the installed desktop version. */
export interface DeepSeekerReleaseUpdate {
  readonly version: string
  readonly tagName: string
  readonly htmlUrl: string
  readonly asset?: DeepSeekerReleaseAsset
}

export interface CheckDeepSeekerReleaseOptions {
  readonly currentVersion: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly request?: UpdateRequest
  readonly signal?: AbortSignal
}

export interface DownloadDeepSeekerReleaseOptions {
  readonly release: DeepSeekerReleaseUpdate
  readonly userDataPath: string
  readonly request: UpdateRequest
  readonly signal?: AbortSignal
  readonly onProgress?: (receivedBytes: number, totalBytes: number) => void
}

interface ParsedSemVer {
  readonly major: string
  readonly minor: string
  readonly patch: string
  readonly prerelease: readonly string[]
}

interface AbortWatchdog {
  readonly signal: AbortSignal
  arm(): void
  disarm(): void
  dispose(): void
  timedOut(): boolean
}

/** Strict failure boundary used by the native update coordinator. */
class ReleaseUpdateError extends Error {
  constructor(readonly code: string, message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ReleaseUpdateError'
  }
}

function createAbortWatchdog(parent: AbortSignal | undefined, timeoutMs: number): AbortWatchdog {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let timeoutReached = false
  const relayAbort = (): void => { controller.abort(parent?.reason) }
  if (parent?.aborted === true) relayAbort()
  else parent?.addEventListener('abort', relayAbort, { once: true })

  const disarm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  return {
    signal: controller.signal,
    arm: () => {
      disarm()
      if (controller.signal.aborted) return
      timer = setTimeout(() => {
        timeoutReached = true
        controller.abort(new DOMException('Timed out', 'TimeoutError'))
      }, timeoutMs)
    },
    disarm,
    dispose: () => {
      disarm()
      parent?.removeEventListener('abort', relayAbort)
    },
    timedOut: () => timeoutReached,
  }
}

function errorFromUnknown(cause: unknown, message: string): Error {
  return cause instanceof Error ? cause : new Error(message, { cause })
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return errorFromUnknown(reason, 'Operation aborted')
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    const onAbort = (): void => {
      finish(() => { rejectPromise(abortReason(signal)) })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => { finish(() => { resolvePromise(value) }) },
      (cause: unknown) => { finish(() => { rejectPromise(errorFromUnknown(cause, 'Operation failed')) }) },
    )
  })
}

function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null
  const major = match[1]
  const minor = match[2]
  const patch = match[3]
  if (major === undefined || minor === undefined || patch === undefined) return null
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(part => /^\d+$/u.test(part) && part.length > 1 && part.startsWith('0'))) return null
  return { major, minor, patch, prerelease }
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

/** Compare strict SemVer values, accepting an optional lowercase v prefix. */
export function compareReleaseVersions(left: string, right: string): number | null {
  const a = parseSemVer(left)
  const b = parseSemVer(right)
  if (a === null || b === null) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(a[key], b[key])
    if (comparison !== 0) return comparison
  }
  if (a.prerelease.length === 0) return b.prerelease.length === 0 ? 0 : 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^\d+$/u.test(leftPart)
    const rightNumeric = /^\d+$/u.test(rightPart)
    if (leftNumeric && rightNumeric) return compareNumeric(leftPart, rightPart)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function githubReleasePage(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(RELEASE_PAGE_PREFIX)
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function githubAssetUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith(RELEASE_DOWNLOAD_PREFIX)
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function safeAssetName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw === '' || raw.length > 180 || /[\0\r\n]/u.test(raw)) return undefined
  return basename(raw) === raw ? raw : undefined
}

function digestSha256(raw: unknown): string | undefined | null {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'string') return null
  const match = /^sha256:([0-9a-f]{64})$/u.exec(raw)
  return match?.[1] ?? null
}

function releaseArtifact(name: string, platform: DesktopReleasePlatform): DesktopReleaseArtifact | undefined {
  const extension = extname(name).toLowerCase()
  if (platform === 'darwin') return extension === '.dmg' ? 'dmg' : extension === '.zip' ? 'zip' : undefined
  return extension === '.exe' ? 'exe' : undefined
}

function assetScore(name: string, platform: DesktopReleasePlatform, arch: string): number {
  const lower = name.toLowerCase()
  const platformMatch = platform === 'darwin'
    ? lower.includes('mac') || lower.includes('darwin')
    : lower.includes('win')
  if (!platformMatch) return -1
  const arm = /(?:arm64|aarch64|apple[-_ ]?silicon)/u.test(lower)
  const intel = /(?:x64|x86_64|amd64|intel)/u.test(lower)
  if (arch === 'arm64' && intel && !arm) return -1
  if (arch === 'x64' && arm && !intel) return -1
  let score = 10
  if (arch === 'arm64' ? arm : arch === 'x64' ? intel : false) score += 10
  if (lower.endsWith('.dmg') || lower.endsWith('.exe')) score += 2
  return score
}

function selectReleaseAsset(
  rawAssets: unknown,
  platform: DesktopReleasePlatform,
  arch: string,
): DeepSeekerReleaseAsset | undefined {
  if (!Array.isArray(rawAssets) || rawAssets.length > 200) return undefined
  const candidates: Array<{ readonly asset: DeepSeekerReleaseAsset; readonly score: number }> = []
  for (const raw of rawAssets) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const source = raw as Record<string, unknown>
    const name = safeAssetName(source.name)
    const url = githubAssetUrl(source.browser_download_url)
    const size = source.size
    const digest = digestSha256(source.digest)
    if (name === undefined || url === undefined || typeof size !== 'number' || !Number.isSafeInteger(size)
      || size <= 0 || size > MAX_UPDATE_DOWNLOAD_BYTES || digest === null || digest === undefined) continue
    const artifact = releaseArtifact(name, platform)
    if (artifact === undefined) continue
    const score = assetScore(name, platform, arch)
    if (score < 0) continue
    candidates.push({
      score,
      asset: { name, url, size, artifact, sha256: digest },
    })
  }
  candidates.sort((left, right) => right.score - left.score || left.asset.name.localeCompare(right.asset.name))
  return candidates[0]?.asset
}

async function readLimitedBody(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length')
  if (declared !== null && /^\d+$/u.test(declared) && BigInt(declared) > BigInt(maximum)) {
    throw new Error('response is too large')
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let body = ''
  try {
    for (;;) {
      const chunk = await waitForAbort(reader.read(), signal)
      if (chunk.done) return body + decoder.decode()
      size += chunk.value.byteLength
      if (size > maximum) throw new Error('response is too large')
      body += decoder.decode(chunk.value, { stream: true })
    }
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
  }
}

/** Return a newer stable GitHub Release, or null for no update and any safe failure. */
export async function checkForDeepSeekerRelease(
  options: CheckDeepSeekerReleaseOptions,
): Promise<DeepSeekerReleaseUpdate | null | undefined> {
  if (parseSemVer(options.currentVersion) === null) return undefined
  if (options.platform !== 'darwin' && options.platform !== 'win32') return null
  const request = options.request ?? globalThis.fetch
  const watchdog = createAbortWatchdog(options.signal, RELEASE_CHECK_TIMEOUT_MS)
  watchdog.arm()
  let response: Response
  try {
    response = await waitForAbort(request(RELEASE_API_URL, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: watchdog.signal,
    }), watchdog.signal)
  } catch {
    watchdog.dispose()
    return undefined
  }
  try {
    if (response.status !== 200) return undefined
    const value: unknown = JSON.parse(await readLimitedBody(response, MAX_RELEASE_RESPONSE_BYTES, watchdog.signal))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const release = value as Record<string, unknown>
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return undefined
    const parsed = parseSemVer(release.tag_name)
    const currentComparison = compareReleaseVersions(release.tag_name, options.currentVersion)
    const htmlUrl = githubReleasePage(release.html_url)
    if (parsed === null || parsed.prerelease.length > 0 || currentComparison === null || currentComparison <= 0
      || htmlUrl === undefined) return currentComparison !== null && currentComparison <= 0 ? null : undefined
    const version = release.tag_name.startsWith('v') ? release.tag_name.slice(1) : release.tag_name
    const platform = options.platform
    const asset = selectReleaseAsset(release.assets, platform, options.arch)
    return {
      version,
      tagName: release.tag_name,
      htmlUrl,
      ...(asset === undefined ? {} : { asset }),
    }
  } catch {
    return undefined
  } finally {
    watchdog.dispose()
  }
}

function validRedirect(raw: string): boolean {
  if (raw === '') return true
  try {
    const url = new URL(raw)
    return url.protocol === 'https:'
      && (url.hostname === 'github.com' || url.hostname.endsWith('.githubusercontent.com'))
  } catch {
    return false
  }
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ReleaseUpdateError('unsafe-path', '更新目录不安全。')
  await chmod(path, PRIVATE_DIRECTORY_MODE)
}

async function unlinkIfPresent(filename: string): Promise<void> {
  try {
    await unlink(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

async function sha256File(filename: string, signal?: AbortSignal): Promise<string> {
  if (signalIsAborted(signal)) abortFailure(signal)
  const digest = createHash('sha256')
  const stream = createReadStream(filename, {
    highWaterMark: 64 * 1024,
    ...(signal === undefined ? {} : { signal }),
  })
  try {
    for await (const chunk of stream) {
      if (signalIsAborted(signal)) abortFailure(signal)
      digest.update(chunk as Buffer)
    }
  } catch (cause) {
    if (signalIsAborted(signal)) abortFailure(signal, cause)
    throw cause
  }
  return digest.digest('hex')
}

function abortFailure(signal: AbortSignal | undefined, cause?: unknown): never {
  if (signal?.aborted === true) throw new ReleaseUpdateError('aborted', '更新下载已取消。', { cause })
  throw cause
}

async function validateDownloadedArtifact(
  filename: string,
  asset: DeepSeekerReleaseAsset,
  signal?: AbortSignal,
): Promise<void> {
  if (signalIsAborted(signal)) abortFailure(signal)
  const handle = await open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (signalIsAborted(signal)) abortFailure(signal)
    if (!stat.isFile() || stat.size !== asset.size) throw new ReleaseUpdateError('size', '下载文件大小与 GitHub Release 不一致。')
    if (asset.artifact === 'dmg') {
      if (stat.size < DMG_TRAILER_BYTES) throw new ReleaseUpdateError('artifact', '下载文件不是有效的 DMG。')
      const magic = Buffer.alloc(DMG_MAGIC.length)
      await handle.read(magic, 0, magic.length, stat.size - DMG_TRAILER_BYTES)
      if (!magic.equals(DMG_MAGIC)) throw new ReleaseUpdateError('artifact', '下载文件不是有效的 DMG。')
      return
    }
    const header = Buffer.alloc(64)
    const read = await handle.read(header, 0, header.length, 0)
    if (asset.artifact === 'zip') {
      if (read.bytesRead < 4 || !header.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        throw new ReleaseUpdateError('artifact', '下载文件不是有效的 ZIP。')
      }
      return
    }
    if (read.bytesRead < 64 || header[0] !== 0x4d || header[1] !== 0x5a) {
      throw new ReleaseUpdateError('artifact', '下载文件不是有效的 Windows 安装程序。')
    }
    const peOffset = header.readUInt32LE(PE_OFFSET_POSITION)
    if (peOffset > stat.size - PE_MAGIC.length) throw new ReleaseUpdateError('artifact', 'Windows 安装程序头无效。')
    const magic = Buffer.alloc(PE_MAGIC.length)
    await handle.read(magic, 0, magic.length, peOffset)
    if (!magic.equals(PE_MAGIC)) throw new ReleaseUpdateError('artifact', 'Windows 安装程序头无效。')
  } finally {
    await handle.close()
  }
}

async function reusableCompletedArtifact(
  filename: string,
  asset: DeepSeekerReleaseAsset,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await validateDownloadedArtifact(filename, asset, signal)
    return await sha256File(filename, signal) === asset.sha256
  } catch (cause) {
    if (signalIsAborted(signal)) abortFailure(signal, cause)
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT' || cause instanceof ReleaseUpdateError) return false
    throw cause
  }
}

/** Reuse a verified completed asset or download, verify, and atomically publish its replacement. */
export async function downloadDeepSeekerRelease(
  options: DownloadDeepSeekerReleaseOptions,
): Promise<string> {
  const asset = options.release.asset
  if (asset === undefined) throw new ReleaseUpdateError('no-asset', '这个版本没有适合当前电脑的安装包。')
  if (!isAbsolute(options.userDataPath)) throw new ReleaseUpdateError('unsafe-path', '更新目录必须是绝对路径。')
  const userDataPath = resolve(options.userDataPath)
  const userDataStat = await lstat(userDataPath)
  if (!userDataStat.isDirectory() || userDataStat.isSymbolicLink()) {
    throw new ReleaseUpdateError('unsafe-path', '更新目录不安全。')
  }
  const directory = join(userDataPath, 'updates', options.release.version)
  await privateDirectory(join(userDataPath, 'updates'))
  await privateDirectory(directory)
  const completed = join(directory, asset.name)
  const temporary = join(directory, `.${asset.name}.${process.pid}.${randomUUID()}.partial`)
  const watchdog = createAbortWatchdog(options.signal, UPDATE_DOWNLOAD_IDLE_TIMEOUT_MS)
  let deferredCleanup = false
  let fileOperationDetached = false

  try {
    let reusable = false
    watchdog.arm()
    try {
      reusable = await reusableCompletedArtifact(completed, asset, watchdog.signal)
    } catch (cause) {
      if (watchdog.timedOut()) {
        throw new ReleaseUpdateError('timeout', '安装包校验耗时过长。', { cause })
      }
      if (options.signal?.aborted === true) abortFailure(options.signal, cause)
      throw cause
    } finally {
      watchdog.disarm()
    }
    if (reusable) {
      options.onProgress?.(asset.size, asset.size)
      return completed
    }

    let response: Response
    watchdog.arm()
    try {
      response = await waitForAbort(options.request(asset.url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow',
        signal: watchdog.signal,
      }), watchdog.signal)
    } catch (cause) {
      if (watchdog.timedOut()) throw new ReleaseUpdateError('timeout', '安装包下载长时间没有收到数据。', { cause })
      if (options.signal?.aborted === true || (cause as { name?: unknown } | null)?.name === 'AbortError') {
        abortFailure(options.signal, cause)
      }
      throw new ReleaseUpdateError('network', '安装包下载失败。', { cause })
    } finally {
      watchdog.disarm()
    }
    if (response.status !== 200 || response.body === null || !validRedirect(response.url)) {
      throw new ReleaseUpdateError('response', 'GitHub 没有返回有效的安装包。')
    }

    const handle = await open(temporary, 'wx', PRIVATE_FILE_MODE)
    const reader = response.body.getReader()
    const digest = createHash('sha256')
    let received = 0
    try {
      for (;;) {
        if (options.signal?.aborted === true) abortFailure(options.signal)
        watchdog.arm()
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await waitForAbort(reader.read(), watchdog.signal)
        } finally {
          watchdog.disarm()
        }
        if (chunk.done) break
        if (received + chunk.value.byteLength > asset.size || received + chunk.value.byteLength > MAX_UPDATE_DOWNLOAD_BYTES) {
          throw new ReleaseUpdateError('size', '下载文件超过 GitHub Release 标记的大小。')
        }
        let offset = 0
        while (offset < chunk.value.byteLength) {
          watchdog.arm()
          let result: { readonly bytesWritten: number }
          try {
            result = await waitForAbort(
              handle.write(chunk.value, offset, chunk.value.byteLength - offset, null),
              watchdog.signal,
            )
          } catch (cause) {
            if (watchdog.signal.aborted) fileOperationDetached = true
            throw cause
          } finally {
            watchdog.disarm()
          }
          if (result.bytesWritten === 0) throw new ReleaseUpdateError('write', '更新文件写入没有进展。')
          offset += result.bytesWritten
        }
        digest.update(chunk.value)
        received += chunk.value.byteLength
        options.onProgress?.(received, asset.size)
      }
      watchdog.arm()
      try {
        await waitForAbort(handle.sync(), watchdog.signal)
      } catch (cause) {
        if (watchdog.signal.aborted) fileOperationDetached = true
        throw cause
      } finally {
        watchdog.disarm()
      }
    } catch (cause) {
      await reader.cancel(cause).catch(() => undefined)
      if (watchdog.timedOut()) {
        throw new ReleaseUpdateError('timeout', '安装包下载长时间没有收到数据。', { cause })
      }
      throw cause
    } finally {
      reader.releaseLock()
      const closeTask = handle.close()
      if (fileOperationDetached) {
        deferredCleanup = true
        void closeTask.then(
          () => unlinkIfPresent(temporary),
          () => undefined,
        ).catch(() => undefined)
      } else {
        await closeTask
      }
    }

    if (received !== asset.size) throw new ReleaseUpdateError('size', '下载文件大小与 GitHub Release 不一致。')
    const actualDigest = digest.digest('hex')
    if (actualDigest !== asset.sha256) {
      throw new ReleaseUpdateError('digest', '下载文件的 SHA-256 与 GitHub Release 不一致。')
    }
    await validateDownloadedArtifact(temporary, asset)
    await rename(temporary, completed)
    return completed
  } finally {
    watchdog.dispose()
    if (!deferredCleanup) await unlinkIfPresent(temporary)
  }
}
