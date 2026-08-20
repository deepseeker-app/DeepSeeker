import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDesktopTerminalSession,
  desktopTerminalEnvironment,
  resolveDesktopShell,
  spawnDesktopTerminalSession,
  validateTerminalCwd,
  validateTerminalDimensions,
  WINDOWS_TASKKILL_TIMEOUT_MS,
  type DesktopPty,
} from '../src/desktop-terminal.ts'

class FakePty implements DesktopPty {
  readonly pid = 4102
  readonly writes: string[] = []
  readonly sizes: Array<[number, number]> = []
  dataDisposed = 0
  exitDisposed = 0
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(detail: { exitCode: number; signal?: number }) => void>()

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener); this.dataDisposed += 1 } }
  }

  onExit(listener: (detail: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener); this.exitDisposed += 1 } }
  }

  write(data: string): void { this.writes.push(data) }
  resize(columns: number, rows: number): void { this.sizes.push([columns, rows]) }
  kill(): void {}
  emitData(data: string): void { for (const listener of this.dataListeners) listener(data) }
  emitExit(exitCode = 0, signal?: number): void {
    for (const listener of this.exitListeners) listener({ exitCode, ...signal === undefined ? {} : { signal } })
  }
}

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseeker-terminal-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('desktop terminal shell and environment', () => {
  it('selects a verified POSIX login shell and ignores relative declarations', () => {
    expect(resolveDesktopShell({
      platform: 'darwin',
      env: { SHELL: '/custom/zsh' },
      canSpawn: path => path === '/custom/zsh',
    })).toEqual({ executable: '/custom/zsh', args: ['-l'], label: 'zsh' })

    expect(resolveDesktopShell({
      platform: 'darwin',
      env: { SHELL: 'relative-shell' },
      canSpawn: path => path === '/bin/zsh',
    }).executable).toBe('/bin/zsh')
  })

  it('prefers PowerShell 7 and falls back to a verified COMSPEC', () => {
    const powerShell = 'C:\\Tools\\PowerShell\\7\\pwsh.exe'
    expect(resolveDesktopShell({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Tools', SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      canSpawn: path => path === powerShell,
    })).toEqual({ executable: powerShell, args: ['-NoLogo'], label: 'PowerShell 7' })

    expect(resolveDesktopShell({
      platform: 'win32',
      env: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      canSpawn: path => path.endsWith('cmd.exe'),
    })).toEqual({ executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/Q'], label: 'Command Prompt' })
  })

  it('rejects bad cwd values and canonicalizes an existing directory', () => {
    const root = temporaryRoot()
    const file = join(root, 'file.txt')
    writeFileSync(file, 'x')

    expect(validateTerminalCwd(root)).toBe(realpathSync(root))
    expect(() => validateTerminalCwd('relative')).toThrow('绝对路径')
    expect(() => validateTerminalCwd(file)).toThrow('不是文件夹')
  })

  it('scrubs credentials and inherited Harness identity before trusted additions', () => {
    expect(desktopTerminalEnvironment({
      PATH: '/bin',
      DEEPSEEK_API_KEY: 'secret',
      npm_TOKEN: 'secret',
      DSH_HOME: '/old',
    }, { DSH_HOME: '/selected' })).toEqual({
      PATH: '/bin',
      DSH_HOME: '/selected',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    })
    expect(() => desktopTerminalEnvironment({}, { 'BAD=NAME': 'x' })).toThrow('invalid')
    expect(() => desktopTerminalEnvironment({}, { GOOD_NAME: 'x\0y' })).toThrow('invalid')
  })
})

describe('desktop terminal session', () => {
  const shell = { executable: '/bin/zsh', args: ['-l'], label: 'zsh' } as const

  it('validates IPC input and dimensions before touching node-pty', () => {
    const pty = new FakePty()
    const session = createDesktopTerminalSession({ pty, shell, terminateTree: vi.fn(async () => undefined) })

    session.write('printf hello\r')
    session.resize(120, 40)
    expect(pty.writes).toEqual(['printf hello\r'])
    expect(pty.sizes).toEqual([[120, 40]])
    expect(() => { session.write({}) }).toThrow('must be text')
    expect(() => { session.write('x'.repeat(64 * 1024 + 1)) }).toThrow('too large')
    expect(() => { session.resize(1, 40) }).toThrow('invalid')
    expect(() => { session.resize(120.5, 40) }).toThrow('invalid')
    expect(validateTerminalDimensions(500, 2)).toEqual({ columns: 500, rows: 2 })
  })

  it('contains renderer callback failures and joins a graceful exit', async () => {
    const pty = new FakePty()
    const log = vi.fn()
    const exits = vi.fn()
    const terminateTree = vi.fn(async (_pty: DesktopPty, signal: 'SIGTERM' | 'SIGKILL') => {
      if (signal === 'SIGTERM') pty.emitExit(0)
    })
    const session = createDesktopTerminalSession({
      pty,
      shell,
      terminateTree,
      onData: () => { throw new Error('renderer gone') },
      onExit: exits,
      log,
    })

    expect(() => { pty.emitData('hello') }).not.toThrow()
    expect(log).toHaveBeenCalledWith('desktop terminal output listener failed', expect.any(Error))
    const first = session.close()
    expect(session.close()).toBe(first)
    await first
    expect(terminateTree).toHaveBeenCalledWith(pty, 'SIGTERM')
    expect(exits).toHaveBeenCalledWith({ exitCode: 0 })
    expect(pty.dataDisposed).toBe(1)
    expect(pty.exitDisposed).toBe(1)
  })

  it('escalates a stuck close and waits for the forced exit', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const signals: string[] = []
    const session = createDesktopTerminalSession({
      pty,
      shell,
      closeGraceMs: 25,
      terminateTree: async (_pty, signal) => {
        signals.push(signal)
        if (signal === 'SIGKILL') pty.emitExit(137, 9)
      },
    })

    const closing = session.close()
    expect(signals).toEqual(['SIGTERM'])
    await vi.advanceTimersByTimeAsync(25)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    await closing
  })

  it('uses graceful taskkill on Windows before escalating with /F', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const taskkill = vi.fn(async (
      _executable: string,
      args: readonly string[],
      _options: { readonly timeout: number; readonly killSignal: NodeJS.Signals },
    ) => {
      if (args.includes('/F')) pty.emitExit(137, 9)
    })
    const session = createDesktopTerminalSession({
      pty,
      shell,
      platform: 'win32',
      closeGraceMs: 25,
      runWindowsTaskkill: taskkill,
    })

    const closing = session.close()
    expect(taskkill).toHaveBeenNthCalledWith(
      1,
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4102', '/T'],
      { timeout: WINDOWS_TASKKILL_TIMEOUT_MS, killSignal: 'SIGKILL' },
    )
    await vi.advanceTimersByTimeAsync(25)
    expect(taskkill).toHaveBeenNthCalledWith(
      2,
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4102', '/T', '/F'],
      { timeout: WINDOWS_TASKKILL_TIMEOUT_MS, killSignal: 'SIGKILL' },
    )
    await closing
  })

  it('uses a synchronous Windows tree kill only for process-exit fallback', () => {
    const pty = new FakePty()
    const taskkillSync = vi.fn()
    const session = createDesktopTerminalSession({
      pty,
      shell,
      platform: 'win32',
      runWindowsTaskkillSync: taskkillSync,
      terminateTree: vi.fn(async () => undefined),
    })

    session.forceStopSync()

    expect(taskkillSync).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4102', '/T', '/F'],
      { timeout: WINDOWS_TASKKILL_TIMEOUT_MS, killSignal: 'SIGKILL' },
    )
  })

  it('keeps the event loop responsive while taskkill is still running', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const graceful = Promise.withResolvers<undefined>()
    const taskkill = vi.fn((
      _executable: string,
      args: readonly string[],
      _options: { readonly timeout: number; readonly killSignal: NodeJS.Signals },
    ): Promise<void> => {
      if (!args.includes('/F')) return graceful.promise
      pty.emitExit(137, 9)
      return Promise.resolve()
    })
    const session = createDesktopTerminalSession({
      pty,
      shell,
      platform: 'win32',
      closeGraceMs: 25,
      runWindowsTaskkill: taskkill,
    })

    const closing = session.close()
    const eventLoopTurn = vi.fn()
    queueMicrotask(eventLoopTurn)
    await Promise.resolve()

    expect(eventLoopTurn).toHaveBeenCalledOnce()
    expect(taskkill).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(25)
    expect(taskkill).toHaveBeenCalledOnce()

    graceful.resolve(undefined)
    await vi.advanceTimersByTimeAsync(25)
    expect(taskkill).toHaveBeenCalledTimes(2)
    await closing
  })

  it('continues to the forced fallback when graceful termination fails', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const log = vi.fn()
    const terminateTree = vi.fn(async (_pty: DesktopPty, signal: 'SIGTERM' | 'SIGKILL') => {
      if (signal === 'SIGTERM') throw new Error('taskkill unavailable')
      pty.emitExit(137, 9)
    })
    const session = createDesktopTerminalSession({ pty, shell, closeGraceMs: 25, terminateTree, log })

    const closing = session.close()
    await vi.advanceTimersByTimeAsync(25)
    await closing

    expect(terminateTree.mock.calls.map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    expect(log).toHaveBeenCalledWith('desktop terminal graceful-stop failed', expect.any(Error))
  })

  it('retains a process that survives teardown so close can be retried after force-stop', async () => {
    vi.useFakeTimers()
    const pty = new FakePty()
    const signals: Array<'SIGTERM' | 'SIGKILL'> = []
    const terminateTree = vi.fn(async (_pty: DesktopPty, signal: 'SIGTERM' | 'SIGKILL') => {
      signals.push(signal)
    })
    const session = createDesktopTerminalSession({ pty, shell, closeGraceMs: 10, terminateTree })
    const closing = session.close()
    const rejected = expect(closing).rejects.toThrow('did not exit')

    await vi.advanceTimersByTimeAsync(20)
    await rejected
    session.forceStop()
    expect(signals).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL'])

    const retry = session.close()
    expect(signals).toEqual(['SIGTERM', 'SIGKILL', 'SIGKILL', 'SIGTERM'])
    pty.emitExit(137, 9)
    await retry
    expect(pty.dataDisposed).toBe(1)
    expect(pty.exitDisposed).toBe(1)
  })

  it('loads node-pty lazily with validated shell, cwd, environment, and dimensions', async () => {
    const root = temporaryRoot()
    const pty = new FakePty()
    let spawnedEnvironment: Record<string, string | undefined> | undefined
    const spawn = vi.fn((_file: string, _args: string[], options: { env?: Record<string, string | undefined> }) => {
      spawnedEnvironment = options.env
      return pty as never
    })
    const loadPty = vi.fn(async () => ({ spawn }))
    const session = await spawnDesktopTerminalSession({
      platform: 'darwin',
      cwd: realpathSync(root),
      env: { SHELL: '/bin/zsh', PATH: '/bin', API_TOKEN: 'secret' },
      explicitEnv: { DSH_HOME: '/scheme' },
      columns: 90,
      rows: 28,
      canSpawnShell: path => path === '/bin/zsh',
      loadPty,
      terminateTree: vi.fn(async () => undefined),
    })

    expect(loadPty).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith('/bin/zsh', ['-l'], expect.objectContaining({
      cwd: realpathSync(root),
      cols: 90,
      rows: 28,
    }))
    expect(spawnedEnvironment).toEqual(expect.objectContaining({
      PATH: '/bin',
      DSH_HOME: '/scheme',
      TERM: 'xterm-256color',
    }))
    expect(spawnedEnvironment).not.toHaveProperty('API_TOKEN')
    session.forceStop()
  })
})
