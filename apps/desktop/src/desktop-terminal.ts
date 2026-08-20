/** Local single-PTY runtime for the optional DeepSeeker desktop terminal. */

import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, posix, win32 } from 'node:path'
import type { IDisposable, IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'

const MAX_INPUT_BYTES = 64 * 1024
const MIN_TERMINAL_DIMENSION = 2
const MAX_TERMINAL_DIMENSION = 500
const DEFAULT_CLOSE_GRACE_MS = 1_500
/** Maximum time one asynchronous Windows process-tree helper may run. */
export const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/iu

/** Executable and fixed arguments for the interactive host shell. */
export interface DesktopShell {
  readonly executable: string
  readonly args: readonly string[]
  readonly label: string
}

/** The node-pty operations owned by one desktop terminal session. */
export interface DesktopPty {
  readonly pid: number
  readonly onData: (listener: (data: string) => void) => IDisposable
  readonly onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => IDisposable
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
}

/** Renderer-safe exit facts emitted by the terminal session. */
interface DesktopTerminalExit {
  readonly exitCode: number
  readonly signal?: number
}

/** Live terminal operations exposed only to the Electron main process. */
export interface DesktopTerminalSession {
  readonly pid: number
  readonly shell: DesktopShell
  write(data: unknown): void
  resize(columns: unknown, rows: unknown): void
  close(): Promise<void>
  forceStop(): void
  forceStopSync(): void
}

interface ShellResolutionOptions {
  readonly platform?: NodeJS.Platform
  readonly env?: NodeJS.ProcessEnv
  readonly canSpawn?: (path: string) => boolean
}

interface SessionOptions {
  readonly pty: DesktopPty
  readonly shell: DesktopShell
  readonly platform?: NodeJS.Platform
  readonly closeGraceMs?: number
  readonly terminateTree?: (pty: DesktopPty, signal: 'SIGTERM' | 'SIGKILL') => Promise<void>
  readonly runWindowsTaskkill?: (
    executable: string,
    args: readonly string[],
    options: { readonly timeout: number; readonly killSignal: NodeJS.Signals },
  ) => Promise<void>
  readonly runWindowsTaskkillSync?: (
    executable: string,
    args: readonly string[],
    options: { readonly timeout: number; readonly killSignal: NodeJS.Signals },
  ) => void
  readonly onData?: (data: string) => void
  readonly onExit?: (detail: DesktopTerminalExit) => void
  readonly log?: (message: string, cause: unknown) => void
}

interface SpawnOptions extends Omit<SessionOptions, 'pty' | 'shell'> {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly explicitEnv?: Readonly<Record<string, string>>
  readonly columns?: number
  readonly rows?: number
  readonly loadPty?: () => Promise<{ spawn: (file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions) => IPty }>
  readonly canSpawnShell?: (path: string) => boolean
}

function environmentValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  const exact = env[name]
  if (exact !== undefined || platform !== 'win32') return exact
  const normalized = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1]
}

function executableFile(path: string, platform = process.platform): boolean {
  try {
    const metadata = lstatSync(path)
    if (!metadata.isFile() && !metadata.isSymbolicLink()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function windowsShellCandidates(env: NodeJS.ProcessEnv): string[] {
  const programFiles = environmentValue(env, 'ProgramFiles', 'win32') ?? 'C:\\Program Files'
  const systemRoot = environmentValue(env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
  const candidates = [win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe')]
  const path = environmentValue(env, 'PATH', 'win32') ?? ''
  for (const entry of path.split(';').slice(0, 128)) {
    const directory = entry.trim().replace(/^"|"$/gu, '')
    if (directory !== '') candidates.push(win32.join(directory, 'pwsh.exe'))
  }
  candidates.push(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  const comspec = environmentValue(env, 'COMSPEC', 'win32')
  if (comspec !== undefined && win32.isAbsolute(comspec)) candidates.push(comspec)
  return [...new Set(candidates)]
}

/**
 * Select one existing interactive shell without passing renderer-controlled arguments.
 * @param options - Platform, environment, and executable probe.
 * @returns The first usable PowerShell/cmd or POSIX login shell.
 */
export function resolveDesktopShell(options: ShellResolutionOptions = {}): DesktopShell {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const canSpawn = options.canSpawn ?? (path => executableFile(path, platform))
  if (platform === 'win32') {
    for (const candidate of windowsShellCandidates(env)) {
      if (!canSpawn(candidate)) continue
      const name = win32.basename(candidate).toLowerCase()
      return name === 'cmd.exe'
        ? { executable: candidate, args: ['/Q'], label: 'Command Prompt' }
        : { executable: candidate, args: ['-NoLogo'], label: name === 'pwsh.exe' ? 'PowerShell 7' : 'Windows PowerShell' }
    }
    throw new Error('没有找到可用的 PowerShell 或命令提示符')
  }

  const declared = environmentValue(env, 'SHELL', platform)
  const fallbacks = platform === 'darwin' ? ['/bin/zsh', '/bin/bash', '/bin/sh'] : ['/bin/bash', '/bin/sh']
  const candidates = [declared, ...fallbacks].filter((candidate): candidate is string =>
    candidate !== undefined && candidate.length > 0 && posix.isAbsolute(candidate) && !candidate.includes('\0'))
  for (const candidate of [...new Set(candidates)]) {
    if (!canSpawn(candidate)) continue
    return { executable: candidate, args: ['-l'], label: posix.basename(candidate) }
  }
  throw new Error('没有找到可用的本机 Shell')
}

/**
 * Resolve and validate the terminal working directory before node-pty sees it.
 * @param cwd - Main-process-owned starting directory.
 * @returns The canonical existing directory.
 */
export function validateTerminalCwd(cwd: string): string {
  if (cwd.length === 0 || cwd.includes('\0') || !isAbsolute(cwd)) {
    throw new Error('桌面终端工作目录必须是绝对路径')
  }
  const canonical = realpathSync(cwd)
  if (!lstatSync(canonical).isDirectory()) throw new Error('桌面终端工作目录不是文件夹')
  return canonical
}

/**
 * Build a child environment that omits credentials and inherited Harness identity.
 * @param parent - Ambient main-process environment.
 * @param explicit - Trusted main-process additions such as the active `DSH_HOME`.
 * @returns A fresh environment for the interactive shell.
 */
export function desktopTerminalEnvironment(
  parent: NodeJS.ProcessEnv,
  explicit: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined || SENSITIVE_ENV_PATTERN.test(key) || key.toUpperCase().startsWith('DSH_')) continue
    environment[key] = value
  }
  for (const [key, value] of Object.entries(explicit)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || value.includes('\0')) {
      throw new Error(`invalid desktop terminal environment entry: ${key}`)
    }
    environment[key] = value
  }
  environment.TERM = 'xterm-256color'
  environment.COLORTERM = 'truecolor'
  return environment
}

async function defaultTerminateTree(
  pty: DesktopPty,
  signal: 'SIGTERM' | 'SIGKILL',
  platform: NodeJS.Platform = process.platform,
  runWindowsTaskkill: NonNullable<SessionOptions['runWindowsTaskkill']> = async (executable, args, options) => {
    const child = spawn(executable, [...args], {
      stdio: 'ignore',
      windowsHide: true,
      ...options,
    })
    await once(child, 'close')
  },
): Promise<void> {
  if (platform === 'win32') {
    const systemRoot = environmentValue(process.env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
    await runWindowsTaskkill(win32.join(systemRoot, 'System32', 'taskkill.exe'), [
      '/PID',
      String(pty.pid),
      '/T',
      ...(signal === 'SIGKILL' ? ['/F'] : []),
    ], {
      timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    return
  }
  try {
    process.kill(-pty.pid, signal)
  } catch {
    try {
      pty.kill(signal)
    } catch {
      // Exit races are equivalent to successful teardown.
    }
  }
}

function defaultTerminateTreeSync(
  pty: DesktopPty,
  platform: NodeJS.Platform = process.platform,
  runWindowsTaskkillSync: NonNullable<SessionOptions['runWindowsTaskkillSync']> = (executable, args, options) => {
    spawnSync(executable, [...args], {
      stdio: 'ignore',
      windowsHide: true,
      ...options,
    })
  },
): void {
  if (platform === 'win32') {
    const systemRoot = environmentValue(process.env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
    runWindowsTaskkillSync(win32.join(systemRoot, 'System32', 'taskkill.exe'), [
      '/PID',
      String(pty.pid),
      '/T',
      '/F',
    ], {
      timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    return
  }
  try {
    process.kill(-pty.pid, 'SIGKILL')
  } catch {
    try {
      pty.kill('SIGKILL')
    } catch {
      // Process exit races are already complete.
    }
  }
}

function validDimension(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= MIN_TERMINAL_DIMENSION && Number(value) <= MAX_TERMINAL_DIMENSION
}

/**
 * Validate untrusted renderer dimensions before storing them or resizing a PTY.
 * @param columns - Requested terminal columns.
 * @param rows - Requested terminal rows.
 * @returns Validated integer dimensions.
 */
export function validateTerminalDimensions(columns: unknown, rows: unknown): { columns: number; rows: number } {
  if (!validDimension(columns) || !validDimension(rows)) throw new Error('desktop terminal dimensions are invalid')
  return { columns, rows }
}

function waitForExit(done: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false) }, timeoutMs)
    void done.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/**
 * Own one already-spawned PTY, including bounded input, resize, and joined teardown.
 * @param options - PTY, shell identity, lifecycle callbacks, and process-tree operations.
 * @returns The main-process terminal handle.
 */
export function createDesktopTerminalSession(options: SessionOptions): DesktopTerminalSession {
  const platform = options.platform ?? process.platform
  const graceMs = options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS
  if (!Number.isFinite(graceMs) || graceMs <= 0) throw new Error('desktop terminal close grace must be positive')
  const terminateTree = options.terminateTree ?? ((pty, signal) =>
    defaultTerminateTree(pty, signal, platform, options.runWindowsTaskkill))
  const completion = Promise.withResolvers<void>()
  let exited = false
  let closeTask: Promise<void> | undefined
  const report = (message: string, cause: unknown): void => {
    try {
      options.log?.(message, cause)
    } catch {
      // Diagnostics must not break terminal lifecycle.
    }
  }
  const dataDisposable = options.pty.onData((data) => {
    try {
      options.onData?.(data)
    } catch (cause) {
      report('desktop terminal output listener failed', cause)
    }
  })
  const exitDisposable = options.pty.onExit((detail) => {
    if (exited) return
    exited = true
    completion.resolve()
    try {
      options.onExit?.({ exitCode: detail.exitCode, ...detail.signal === undefined ? {} : { signal: detail.signal } })
    } catch (cause) {
      report('desktop terminal exit listener failed', cause)
    }
  })

  const disposeListeners = (): void => {
    dataDisposable.dispose()
    exitDisposable.dispose()
  }
  const requestTermination = async (signal: 'SIGTERM' | 'SIGKILL'): Promise<void> => {
    try {
      await terminateTree(options.pty, signal)
    } catch (cause) {
      report(`desktop terminal ${signal === 'SIGKILL' ? 'force-stop' : 'graceful-stop'} failed`, cause)
    }
  }
  const forceStop = (): void => {
    if (exited) return
    void requestTermination('SIGKILL')
  }
  const forceStopSync = (): void => {
    if (exited) return
    try {
      defaultTerminateTreeSync(options.pty, platform, options.runWindowsTaskkillSync)
    } catch (cause) {
      report('desktop terminal synchronous force-stop failed', cause)
    }
  }
  const close = (): Promise<void> => {
    if (closeTask !== undefined) return closeTask
    closeTask = (async () => {
      if (!exited) {
        await requestTermination('SIGTERM')
        if (!await waitForExit(completion.promise, graceMs)) {
          await requestTermination('SIGKILL')
          if (!await waitForExit(completion.promise, graceMs)) {
            throw new Error(`desktop terminal process ${String(options.pty.pid)} did not exit`)
          }
        }
      }
      disposeListeners()
    })()
    void closeTask.catch(() => { closeTask = undefined })
    return closeTask
  }

  return {
    pid: options.pty.pid,
    shell: options.shell,
    write(data) {
      if (typeof data !== 'string') throw new Error('desktop terminal input must be text')
      if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) throw new Error('desktop terminal input is too large')
      if (exited) throw new Error('desktop terminal process has exited')
      options.pty.write(data)
    },
    resize(columns, rows) {
      const size = validateTerminalDimensions(columns, rows)
      if (exited) return
      options.pty.resize(size.columns, size.rows)
    },
    close,
    forceStop,
    forceStopSync,
  }
}

/**
 * Resolve the shell and allocate one PTY only when the user opens the terminal window.
 * @param options - Main-process-owned directory, environment, dimensions, and callbacks.
 * @returns A live terminal session.
 */
export async function spawnDesktopTerminalSession(options: SpawnOptions): Promise<DesktopTerminalSession> {
  const platform = options.platform ?? process.platform
  const cwd = validateTerminalCwd(options.cwd)
  const shell = resolveDesktopShell({
    platform,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.canSpawnShell === undefined ? {} : { canSpawn: options.canSpawnShell }),
  })
  const size = validateTerminalDimensions(options.columns ?? 100, options.rows ?? 30)
  const nodePty = await (options.loadPty ?? (async () => import('node-pty')))()
  const pty = nodePty.spawn(shell.executable, [...shell.args], {
    name: 'xterm-256color',
    cwd,
    cols: size.columns,
    rows: size.rows,
    env: desktopTerminalEnvironment(options.env ?? process.env, options.explicitEnv),
  })
  return createDesktopTerminalSession({ ...options, platform, pty, shell })
}
