import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(desktopRoot, 'src/main.ts'), 'utf8')

describe('desktop native integration wiring', () => {
  it('isolates every Host generation through the selected Harness home', () => {
    expect(source).toContain('DSH_HOME: scheme.harnessHome')
    expect(source).toContain("profileName: 'web'")
  })

  it('validates before persisting and restarting a scheme switch', () => {
    const functionBody = source.slice(
      source.indexOf('async function selectConfigurationScheme'),
      source.indexOf('function queryLatestRelease'),
    )
    expect(functionBody.indexOf('await validateConfigurationScheme(target)')).toBeGreaterThan(-1)
    expect(functionBody.indexOf('requestConfigurationSchemeSwitch')).toBeGreaterThan(
      functionBody.indexOf('await validateConfigurationScheme(target)'),
    )
    expect(functionBody.indexOf('app.relaunch()')).toBeGreaterThan(
      functionBody.indexOf('requestConfigurationSchemeSwitch'),
    )
  })

  it('marks a scheme healthy only after the main renderer commits the assembled UI', () => {
    const windowBody = source.slice(source.indexOf('async function createMainWindow'), source.indexOf('function schemeMenu'))
    expect(windowBody.indexOf('await waitForRendererReady(window.webContents)')).toBeGreaterThan(
      windowBody.indexOf('await window.loadURL(rendererUrl.href)'),
    )
    expect(windowBody.indexOf('window.show()')).toBeGreaterThan(
      windowBody.indexOf('await waitForRendererReady(window.webContents)'),
    )
    const bootBody = source.slice(source.indexOf('async function boot()'), source.indexOf('app.setName(APP_NAME)'))
    expect(bootBody.indexOf('markConfigurationSchemeHealthy')).toBeGreaterThan(
      bootBody.indexOf('await startConfigurationWithFallback'),
    )
  })

  it('waits for a failed Host to stop before startup fallback can continue', () => {
    const functionBody = source.slice(source.indexOf('async function startSchemeHost'), source.indexOf('async function startSchemeGeneration'))
    expect(functionBody.indexOf('host = supervisor')).toBeLessThan(
      functionBody.indexOf('await supervisor.start()'),
    )
    expect(functionBody.indexOf('await supervisor.shutdown()')).toBeGreaterThan(
      functionBody.indexOf('await supervisor.start()'),
    )
    expect(functionBody.indexOf('throw cause')).toBeGreaterThan(
      functionBody.indexOf('await supervisor.shutdown()'),
    )
  })

  it('cleans a renderer-failed generation before fallback starts', () => {
    const functionBody = source.slice(source.indexOf('async function startSchemeGeneration'), source.indexOf('async function boot()'))
    expect(functionBody).toContain('await lifecycle.showWindow()')
    expect(functionBody).toContain('await started.supervisor.shutdown()')
    expect(functionBody.indexOf('throw cause')).toBeGreaterThan(
      functionBody.indexOf('await started.supervisor.shutdown()'),
    )
  })

  it('keeps the scheme manager independent when the main window is hidden', () => {
    const functionBody = source.slice(
      source.indexOf('async function showConfigurationSchemeManager'),
      source.indexOf('async function validateConfigurationScheme'),
    )
    expect(functionBody).toContain('!mainWindow.isDestroyed() && mainWindow.isVisible()')
    expect(functionBody).toContain('...(parent === undefined ? {} : { parent, modal: true })')
  })

  it('requires explicit confirmation before permanently deleting a scheme', () => {
    const functionBody = source.slice(
      source.indexOf('async function handleConfigurationSchemeAction'),
      source.indexOf('async function selectConfigurationScheme'),
    )
    expect(functionBody).toContain("buttons: ['删除', '取消']")
    expect(functionBody).toContain('defaultId: 1')
    expect(functionBody.indexOf('deleteConfigurationScheme')).toBeGreaterThan(
      functionBody.indexOf("buttons: ['删除', '取消']"),
    )
  })

  it('asks before download and shuts down owned processes before launching a Windows installer', () => {
    const manual = source.slice(source.indexOf('async function checkForUpdatesManually'), source.indexOf('function launchWindowsInstaller'))
    expect(manual.indexOf("buttons: ['下载', '稍后']")).toBeGreaterThan(-1)
    expect(manual.indexOf('downloadAndOpenUpdate(release)')).toBeGreaterThan(
      manual.indexOf("buttons: ['下载', '稍后']"),
    )
    const confirmation = source.slice(source.indexOf('function downloadAndOpenUpdate'), source.indexOf('function scheduleUpdateChecks'))
    expect(confirmation).toContain("buttons: ['退出并安装', '稍后']")
    const handoff = source.slice(source.indexOf('function quitAndLaunchWindowsInstaller'), source.indexOf('function downloadAndOpenUpdate'))
    expect(handoff.indexOf('await launchWindowsInstaller')).toBeGreaterThan(
      handoff.indexOf('await shutdownOwnedProcesses()'),
    )
  })

  it('aborts and joins both update operations before releasing application quit', () => {
    expect(source).toContain('let quitRequested = false')
    expect(source).toContain('let updateCheckAbortController: AbortController | undefined')
    expect(source).toContain('let updateDownloadAbortController: AbortController | undefined')
    const stop = source.slice(source.indexOf('function stopUpdateActivity'), source.indexOf('async function shutdownOwnedProcesses'))
    expect(stop).toContain('updateCheckAbortController?.abort()')
    expect(stop).toContain('updateDownloadAbortController?.abort()')

    const shutdown = source.slice(source.indexOf('async function shutdownOwnedProcesses'), source.indexOf('function releaseAppQuit'))
    expect(shutdown).toContain('const checkTask = updateCheckTask ?? Promise.resolve()')
    expect(shutdown).toContain('const downloadTask = updateDownloadTask ?? Promise.resolve()')
    expect(shutdown).toContain('const validationTasks = [...profileValidationTasks]')
    expect(shutdown).toContain('const openTerminalTask = terminalOpenTask ?? Promise.resolve()')
    expect(shutdown).toContain('for (const controller of profileValidationAbortControllers) controller.abort()')
    expect(shutdown).toContain('...validationTasks,')
    expect(shutdown).toContain('openTerminalTask,')
    expect(shutdown).toContain('checkTask,')
    expect(shutdown).toContain('downloadTask,')

    const quit = source.slice(source.indexOf('function requestAppQuit'), source.indexOf('async function startSchemeHost'))
    expect(quit.indexOf('quitRequested = true')).toBeLessThan(quit.indexOf('stopUpdateActivity()'))
    expect(source).toContain('if (quitRequested) return Promise.resolve(undefined)')
    expect(source).toContain('if (quitRequested) return Promise.resolve()')

    const handoff = source.slice(source.indexOf('function downloadAndOpenUpdate'), source.indexOf('function scheduleUpdateChecks'))
    expect(handoff.indexOf('updateDownloadTask = undefined')).toBeLessThan(
      handoff.indexOf('await quitAndLaunchWindowsInstaller(windowsInstallerPath)'),
    )
  })

  it('keeps terminal IPC scoped to its own sandboxed renderer and joins terminal shutdown', () => {
    expect(source).toContain('event.sender === window.webContents')
    expect(source).toContain('validateTerminalDimensions(columns, rows)')
    expect(source).toContain('await session?.close()')
    expect(source).toContain('session?.forceStop()')
    expect(source).toContain('process.on(\'exit\', () => { terminalSession?.forceStopSync() })')
  })

  it('treats renderer-startup cancellation as application quit, not a broken profile', () => {
    const bootFailure = source.slice(source.indexOf('app.whenReady().then(boot).catch'))
    expect(bootFailure).toContain('if (!quitRequested && bootQuitPromise === undefined)')
    expect(bootFailure.indexOf('markConfigurationSchemeFailed')).toBeGreaterThan(
      bootFailure.indexOf('if (!quitRequested && bootQuitPromise === undefined)'),
    )
  })

  it('retains failed terminal ownership and isolates late output by window generation', () => {
    expect(source).toContain('let terminalGeneration = 0')
    expect(source).toContain('terminalWindow !== window || terminalGeneration !== generation')
    expect(source).toContain('let sessionClosed = session === undefined')
    expect(source).toContain('if (sessionClosed && terminalSession === session) terminalSession = undefined')
    expect(source).toContain('windowSession?.forceStop()')

    const show = source.slice(source.indexOf('function showDesktopTerminal'), source.indexOf('function schemeDocumentUrl'))
    expect(show.match(/if \(applicationIsQuitting\(\)\) return/gu)).toHaveLength(3)
    expect(show.indexOf('await shutdownDesktopTerminal()')).toBeLessThan(show.indexOf('await createTerminalWindow()'))
  })

  it('keeps all application windows sandboxed with no Node integration', () => {
    expect(source.match(/contextIsolation: true/gu)).toHaveLength(3)
    expect(source.match(/nodeIntegration: false/gu)).toHaveLength(3)
    expect(source.match(/sandbox: true/gu)).toHaveLength(3)
  })
})
