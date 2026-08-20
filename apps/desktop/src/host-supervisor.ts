/** Supervise the loopback Web Host used by the first desktop application. */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { once } from 'node:events'
import { win32 } from 'node:path'
import type { Readable } from 'node:stream'

const READINESS_PREFIX = 'dsh web: '
const DEFAULT_READINESS_TIMEOUT_MS = 90_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_PROFILE_VALIDATION_SHUTDOWN_TIMEOUT_MS = 5_000
const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000
const MAX_STARTUP_OUTPUT_CHARS = 32_768

function describeFailure(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  if (cause === undefined) return 'unknown failure'
  if (cause === null) return 'null'
  if (typeof cause === 'number' || typeof cause === 'boolean' || typeof cause === 'bigint') return String(cause)
  return 'unknown failure'
}

/** Incremental parser for the Web Host's canonical readiness line. */
export interface ReadinessParser {
  /**
   * Consume one stdout chunk.
   * @param chunk - Text emitted by the Host.
   * @returns The loopback URL once a complete readiness line is observed.
   */
  push(chunk: string): string | undefined
  /**
   * Finish the stream and require a readiness line.
   * @returns The parsed loopback URL.
   */
  finalize(): string
}

/** Assert and normalize one readiness line. */
function parseReadinessLine(line: string): string | undefined {
  if (!line.startsWith(READINESS_PREFIX)) return undefined
  const token = line.slice(READINESS_PREFIX.length).split(/\s/u, 1)[0]
  if (token === undefined) throw new Error(`desktop Host readiness line has no URL: ${line}`)

  let url: URL
  try {
    url = new URL(token)
  } catch {
    throw new Error(`desktop Host readiness URL is invalid: ${token}`)
  }
  const port = Number(url.port)
  if (url.protocol !== 'http:'
    || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535) {
    throw new Error(`desktop Host readiness URL must be loopback HTTP with an explicit port: ${token}`)
  }
  return url.origin
}

/**
 * Create a line parser whose result is stable after readiness.
 * @returns A fresh incremental parser.
 */
export function createReadinessParser(): ReadinessParser {
  let pending = ''
  let readyUrl: string | undefined

  const accept = (line: string): string | undefined => {
    const parsed = parseReadinessLine(line.replace(/\r$/u, ''))
    if (parsed === undefined) return undefined
    if (readyUrl !== undefined && parsed !== readyUrl) {
      throw new Error(`desktop Host emitted conflicting readiness URLs: ${readyUrl} and ${parsed}`)
    }
    readyUrl = parsed
    return readyUrl
  }

  return {
    push(chunk) {
      pending += chunk
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline === -1) return readyUrl
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        const parsed = accept(line)
        if (parsed !== undefined) return parsed
      }
    },
    finalize() {
      if (pending !== '') accept(pending)
      if (readyUrl === undefined) throw new Error('desktop Host exited before emitting its readiness URL')
      return readyUrl
    },
  }
}

/** Child process operations the supervisor owns. */
export interface HostChild {
  readonly pid?: number
  readonly stdout: { onData(listener: (chunk: string) => void): () => void }
  readonly stderr: { onData(listener: (chunk: string) => void): () => void }
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void
  onError(listener: (error: Error) => void): () => void
  kill(signal: 'SIGTERM' | 'SIGKILL'): void
  terminateTree?(signal: 'SIGTERM' | 'SIGKILL'): Promise<void>
}

/** Configuration and platform operations for one Host supervisor. */
export interface HostSupervisorOptions {
  /** Spawn one Host process. */
  readonly spawnHost: () => HostChild
  /** Maximum startup time before the Host is terminated. */
  readonly readinessTimeoutMs?: number
  /** Grace after SIGTERM before SIGKILL. */
  readonly shutdownTimeoutMs?: number
  /** Receives bounded Host output for desktop diagnostics. */
  readonly log?: (line: string) => void
  /** Called when a ready Host exits outside an application-owned shutdown. */
  readonly onUnexpectedExit?: (detail: { code: number | null; signal: NodeJS.Signals | null }) => void
}

/** Handle for the desktop-owned Host process. */
export interface HostSupervisor {
  /** Start once, or join the in-flight start. */
  start(): Promise<string>
  /** Gracefully stop once, escalating after the configured timeout. */
  shutdown(): Promise<void>
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

/**
 * Create a single-owner Host supervisor.
 * @param options - Child-process operations and bounded lifecycle timings.
 * @returns A supervisor that coalesces concurrent start and shutdown calls.
 */
export function createHostSupervisor(options: HostSupervisorOptions): HostSupervisor {
  const readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  let child: HostChild | undefined
  let startPromise: Promise<string> | undefined
  let shutdownPromise: Promise<void> | undefined
  let exited: Promise<void> | undefined
  let exitResult: Deferred<void> | undefined
  let ready = false
  let shuttingDown = false
  let output = ''

  const terminate = async (spawned: HostChild, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> => {
    if (spawned.terminateTree !== undefined) {
      await spawned.terminateTree(signal)
      return
    }
    spawned.kill(signal)
  }

  const appendOutput = (chunk: string): void => {
    output = `${output}${chunk}`.slice(-MAX_STARTUP_OUTPUT_CHARS)
    options.log?.(chunk)
  }

  const start = (): Promise<string> => {
    if (startPromise !== undefined) return startPromise
    if (shutdownPromise !== undefined) return Promise.reject(new Error('desktop Host cannot start after shutdown'))

    startPromise = new Promise<string>((resolve, reject) => {
      const parser = createReadinessParser()
      const spawned = options.spawnHost()
      child = spawned
      exitResult = deferred<void>()
      exited = exitResult.promise
      let settled = false
      const startupCleanups: Array<() => void> = []

      const cleanupStartup = (): void => {
        clearTimeout(timer)
        for (const dispose of startupCleanups.splice(0)) dispose()
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        cleanupStartup()
        const diagnostic = output === '' ? '' : `\nHost output:\n${output}`
        reject(new Error(`${error instanceof Error ? error.message : String(error)}${diagnostic}`))
      }
      const acceptChunk = (chunk: string): void => {
        appendOutput(chunk)
        try {
          const url = parser.push(chunk)
          if (url === undefined || settled) return
          settled = true
          ready = true
          cleanupStartup()
          resolve(url)
        } catch (error) {
          fail(error)
          void terminate(spawned, 'SIGTERM').catch((cause: unknown) => {
            appendOutput(`desktop Host termination failed: ${describeFailure(cause)}\n`)
          })
        }
      }

      const timer = setTimeout(() => {
        fail(new Error(`desktop Host readiness timed out after ${String(readinessTimeoutMs)}ms`))
        void terminate(spawned, 'SIGTERM').catch((cause: unknown) => {
          appendOutput(`desktop Host termination failed: ${describeFailure(cause)}\n`)
        })
      }, readinessTimeoutMs)
      startupCleanups.push(spawned.stdout.onData(acceptChunk))
      startupCleanups.push(spawned.stderr.onData(appendOutput))
      spawned.onError((error) => {
        fail(new Error(`desktop Host failed to spawn: ${error.message}`))
        exitResult?.resolve()
      })
      spawned.onExit((code, signal) => {
        exitResult?.resolve()
        if (ready) {
          if (!shuttingDown) options.onUnexpectedExit?.({ code, signal })
          return
        }
        fail(new Error(`desktop Host exited before readiness (code ${String(code)}, signal ${String(signal)})`))
      })
    })
    return startPromise
  }

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise
    shutdownPromise = (async () => {
      const spawned = child
      if (spawned === undefined) return
      shuttingDown = true
      const closed = exited ?? Promise.resolve()
      let gracefulFailure: unknown
      try {
        await terminate(spawned, 'SIGTERM')
      } catch (cause) {
        gracefulFailure = cause
      }
      const stopped = gracefulFailure === undefined && await waitForChildExit(closed, shutdownTimeoutMs)
      if (stopped) return
      let forceFailure: unknown
      try {
        await terminate(spawned, 'SIGKILL')
      } catch (cause) {
        forceFailure = cause
      }
      if (forceFailure === undefined && await waitForChildExit(closed, shutdownTimeoutMs)) return
      const failures = [gracefulFailure, forceFailure].filter(cause => cause !== undefined)
      const timeout = new Error(`desktop Host did not exit within ${String(shutdownTimeoutMs)}ms after SIGKILL`)
      if (failures.length === 0) throw timeout
      throw new AggregateError([...failures, timeout], timeout.message)
    })()
    return shutdownPromise
  }

  return { start, shutdown }
}

/** Options for the real `dsh web` child. */
export interface SpawnDshWebOptions {
  /** Node-compatible executable selected by the desktop app. */
  readonly nodeExecutable: string
  /** Built dsh CLI entry. */
  readonly cliEntry: string
  /** Working directory inherited by user-created sessions and tools. */
  readonly cwd: string
  /** Frozen environment for the Host process. */
  readonly env: NodeJS.ProcessEnv
  /** Harness profile to boot inside the selected configuration scheme. */
  readonly profileName?: string
  /** Run the Electron executable as its bundled Node runtime. */
  readonly electronRunAsNode?: boolean
}

function streamAdapter(stream: NodeJS.ReadableStream): HostChild['stdout'] {
  return {
    onData(listener) {
      const accept = (chunk: string | Buffer): void => { listener(chunk.toString()) }
      stream.on('data', accept)
      return () => { stream.off('data', accept) }
    },
  }
}

/**
 * Spawn the production Web Host on an OS-assigned loopback port.
 * @param options - Node runtime, built CLI and process environment.
 * @returns The child handle consumed by {@link createHostSupervisor}.
 */
export function spawnDshWeb(options: SpawnDshWebOptions): HostChild {
  const env = options.electronRunAsNode
    ? { ...options.env, ELECTRON_RUN_AS_NODE: '1' }
    : options.env
  const process = spawn(options.nodeExecutable, [
    '--expose-internals',
    options.cliEntry,
    '--profile',
    options.profileName ?? 'web',
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return nodeChildAdapter(process)
}

/** Inputs for a bounded profile composition check before desktop selection. */
export interface ValidateDshProfileOptions extends SpawnDshWebOptions {
  /** Maximum time allowed for `--dump-config` to complete. */
  readonly timeoutMs?: number
  /** Grace after SIGTERM before the validation child receives SIGKILL. */
  readonly shutdownTimeoutMs?: number
  /** Application shutdown cancellation. The returned promise joins child exit before rejecting. */
  readonly signal?: AbortSignal
  /** Optional profile-check child supplied by tests. */
  readonly spawnValidation?: () => HostChild
}

async function waitForChildExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => { resolve(false) }, timeoutMs)
    }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  return outcome
}

/**
 * Validate a profile in a separate process without stopping the running Host.
 * @param options - The same executable, CLI, working directory and environment used for a real Host.
 */
export function validateDshProfile(options: ValidateDshProfileOptions): Promise<void> {
  if (options.signal?.aborted === true) return Promise.reject(new Error('配置方案检查已取消。'))
  const env = options.electronRunAsNode
    ? { ...options.env, ELECTRON_RUN_AS_NODE: '1' }
    : options.env
  const timeoutMs = options.timeoutMs ?? 30_000
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_PROFILE_VALIDATION_SHUTDOWN_TIMEOUT_MS
  return new Promise<void>((resolve, reject) => {
    let child: HostChild
    try {
      child = options.spawnValidation?.() ?? nodeChildAdapter(spawn(options.nodeExecutable, [
        '--expose-internals',
        options.cliEntry,
        '--profile',
        options.profileName ?? 'web',
        '--dump-config',
      ], {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }))
    } catch (cause) {
      reject(cause instanceof Error ? cause : new Error('配置方案检查无法启动。', { cause }))
      return
    }
    let output = ''
    let settled = false
    let stopping = false
    const exitResult = Promise.withResolvers<void>()
    const cleanups: Array<() => void> = []
    const append = (chunk: string): void => {
      output = `${output}${chunk}`.slice(-MAX_STARTUP_OUTPUT_CHARS)
    }
    const finish = (cause?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const cleanup of cleanups.splice(0)) cleanup()
      if (cause === undefined) {
        resolve()
        return
      }
      const detail = output.trim() === '' ? '' : `\n${output.trim()}`
      reject(new Error(`${describeFailure(cause)}${detail}`))
    }
    const fail = (cause: Error): void => {
      if (stopping) return
      finish(new Error(`配置方案检查无法启动：${cause.message}`))
    }
    const exited = (code: number | null, signal: NodeJS.Signals | null): void => {
      exitResult.resolve()
      if (stopping) return
      if (code === 0) finish()
      else finish(new Error(`配置方案检查失败（code ${String(code)}, signal ${String(signal)}）。`))
    }
    const stop = (stopCause: Error): void => {
      if (settled || stopping) return
      stopping = true
      void (async () => {
        let termCause: unknown
        try {
          child.kill('SIGTERM')
        } catch (cause) {
          termCause = cause
        }
        const stopped = termCause === undefined
          ? await waitForChildExit(exitResult.promise, shutdownTimeoutMs)
          : false
        let killCause: unknown
        let forcedExitCause: unknown
        if (!stopped) {
          try {
            child.kill('SIGKILL')
          } catch (cause) {
            killCause = cause
          }
          const forcedStopped = await waitForChildExit(exitResult.promise, shutdownTimeoutMs)
          if (!forcedStopped) {
            forcedExitCause = new Error(`配置方案检查在强制停止后 ${String(shutdownTimeoutMs)}ms 内仍未退出。`)
          }
        }
        const failures = [termCause, killCause, forcedExitCause].filter(cause => cause !== undefined)
        finish(failures.length === 0
          ? stopCause
          : new AggregateError(
            [stopCause, ...failures],
            `${stopCause.message} ${failures.map(cause => describeFailure(cause)).join(' ')}`,
          ))
      })()
    }
    const timer = setTimeout(() => {
      stop(new Error(`配置方案检查超过 ${String(timeoutMs)}ms。`))
    }, timeoutMs)
    const abort = (): void => { stop(new Error('配置方案检查已取消。')) }
    cleanups.push(child.stdout.onData(append))
    cleanups.push(child.stderr.onData(append))
    cleanups.push(child.onError(fail))
    cleanups.push(child.onExit(exited))
    if (options.signal !== undefined) {
      options.signal.addEventListener('abort', abort, { once: true })
      cleanups.push(() => { options.signal?.removeEventListener('abort', abort) })
    }
  })
}

/** Adapt Node's event overloads to the supervisor's explicit ownership API. */
function nodeChildAdapter(child: ChildProcessByStdio<null, Readable, Readable>): HostChild {
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    stdout: streamAdapter(child.stdout),
    stderr: streamAdapter(child.stderr),
    onExit(listener) {
      child.on('exit', listener)
      return () => { child.off('exit', listener) }
    },
    onError(listener) {
      child.on('error', listener)
      return () => { child.off('error', listener) }
    },
    kill(signal) {
      child.kill(signal)
    },
    async terminateTree(signal) {
      if (process.platform !== 'win32' || child.pid === undefined) {
        child.kill(signal)
        return
      }
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const taskkill = spawn(win32.join(systemRoot, 'System32', 'taskkill.exe'), [
        '/PID',
        String(child.pid),
        '/T',
        ...(signal === 'SIGKILL' ? ['/F'] : []),
      ], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      })
      await once(taskkill, 'close')
    },
  }
}
