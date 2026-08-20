/** Electron application shell for the loopback DeepSeek Harness Web Host. */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  session,
  shell,
  Tray,
  type Event,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import {
  beginConfigurationSchemeStartup,
  createConfigurationScheme,
  deleteConfigurationScheme,
  discardNewConfigurationScheme,
  listConfigurationSchemes,
  markConfigurationSchemeFailed,
  markConfigurationSchemeHealthy,
  readConfigurationSchemeState,
  renameConfigurationScheme,
  requestConfigurationSchemeSwitch,
  type ConfigurationScheme,
} from './configuration-schemes.ts'
import { desktopApplicationMenuTemplate } from './application-menu.ts'
import {
  ConfigurationStartupCleanupError,
  startConfigurationWithFallback,
} from './configuration-startup.ts'
import {
  configurationSchemeDocument,
  parseConfigurationSchemeAction,
  type ConfigurationSchemeAction,
} from './configuration-scheme-view.ts'
import {
  spawnDesktopTerminalSession,
  validateTerminalDimensions,
  type DesktopTerminalSession,
} from './desktop-terminal.ts'
import {
  createHostSupervisor,
  spawnDshWeb,
  validateDshProfile,
  type HostSupervisor,
} from './host-supervisor.ts'
import {
  checkForDeepSeekerRelease,
  downloadDeepSeekerRelease,
  type DeepSeekerReleaseUpdate,
} from './release-updater.ts'
import { waitForRendererReady } from './renderer-readiness.ts'
import {
  TERMINAL_ERROR_CHANNEL,
  TERMINAL_EXIT_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_OUTPUT_CHANNEL,
  TERMINAL_READY_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
} from './terminal-protocol.ts'
import { terminalDocument } from './terminal-view.ts'
import { createDesktopLifecycle, type DesktopLifecycle } from './window-lifecycle.ts'

const APP_NAME = 'DeepSeeker'
const WINDOW_WIDTH = 1440
const WINDOW_HEIGHT = 920
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(DESKTOP_DIR, '../..')
const mainRequire = createRequire(import.meta.url)
const UPDATE_INITIAL_DELAY_MS = 60_000
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading'

let mainWindow: BrowserWindow | undefined
let schemeWindow: BrowserWindow | undefined
let terminalWindow: BrowserWindow | undefined
let tray: Tray | undefined
let host: HostSupervisor | undefined
let terminalSession: DesktopTerminalSession | undefined
let lifecycle: DesktopLifecycle | undefined
let hostOrigin: string | undefined
let currentScheme: ConfigurationScheme | undefined
let bootQuitPromise: Promise<void> | undefined
let quitReleased = false
let quitRequested = false
let schemeActionTask: Promise<void> = Promise.resolve()
const profileValidationTasks = new Set<Promise<void>>()
const profileValidationAbortControllers = new Set<AbortController>()
let schemeSwitching = false
let terminalOpenTask: Promise<void> | undefined
let terminalCloseTask: Promise<void> | undefined
let terminalIpcRegistered = false
let terminalWindowCloseAllowed = false
let terminalColumns = 100
let terminalRows = 30
let terminalStylesCache: string | undefined
let terminalGeneration = 0
let updatePhase: UpdatePhase = 'idle'
let availableRelease: DeepSeekerReleaseUpdate | undefined
let updatePercent: number | undefined
let updateCheckTask: Promise<DeepSeekerReleaseUpdate | null | undefined> | undefined
let updateDownloadTask: Promise<void> | undefined
let updateCheckAbortController: AbortController | undefined
let updateDownloadAbortController: AbortController | undefined
let installerHandoffTask: Promise<void> | undefined
let updateInitialTimer: ReturnType<typeof setTimeout> | undefined
let updateIntervalTimer: ReturnType<typeof setInterval> | undefined
let lastNotifiedVersion: string | undefined

function applicationIsQuitting(): boolean {
  return quitRequested
}

/** Resolve artifacts from the checkout in development and resourcesPath when packaged. */
function hostPaths(): { nodeExecutable: string; cliEntry: string; cwd: string; electronRunAsNode: boolean } {
  if (!app.isPackaged) {
    return {
      nodeExecutable: process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node',
      cliEntry: join(REPOSITORY_ROOT, 'apps/cli/lib/bin.js'),
      cwd: process.cwd(),
      electronRunAsNode: false,
    }
  }
  return {
    nodeExecutable: process.execPath,
    cliEntry: join(process.resourcesPath, 'host/node_modules/@deepseek-ai/dsh/lib/bin.js'),
    cwd: app.getPath('home'),
    electronRunAsNode: true,
  }
}

function assertHostArtifacts(paths: ReturnType<typeof hostPaths>): void {
  if (paths.nodeExecutable.includes('/') && !existsSync(paths.nodeExecutable)) {
    throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`)
  }
}

function schemeEnvironment(scheme: ConfigurationScheme): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_DESKTOP: '1',
    DSH_HOME: scheme.harnessHome,
  }
}

/** Load the app-local tray template, with an empty fallback for incomplete staging. */
function trayImage(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-resources/trayTemplate.png')]
    : [join(DESKTOP_DIR, 'resources/trayTemplate.png')]
  const path = candidates.find(candidate => existsSync(candidate))
  const image = path === undefined ? nativeImage.createEmpty() : nativeImage.createFromPath(path)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

function isExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function hasOrigin(raw: string, expected: string): boolean {
  try {
    return new URL(raw).origin === expected
  } catch {
    return false
  }
}

/** Install navigation and permission policy before the first renderer loads. */
function hardenSession(): void {
  const desktopSession = session.defaultSession
  desktopSession.setPermissionCheckHandler(() => false)
  desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
}

async function createMainWindow(): Promise<BrowserWindow> {
  const origin = hostOrigin
  if (origin === undefined) throw new Error('desktop Host is not ready')
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    frame: process.platform === 'win32',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : {
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#7f858f',
        height: 44,
      },
    }),
    ...(process.platform === 'darwin' ? {
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
    } : {}),
    ...(process.platform === 'win32' ? {
      backgroundMaterial: 'acrylic' as const,
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    } : {
      transparent: true,
      backgroundColor: '#00000000',
    }),
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = window
  window.on('close', (event) => { lifecycle?.onWindowClose(event) })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (hasOrigin(url, origin)) return
    event.preventDefault()
    if (isExternalUrl(url)) void shell.openExternal(url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const rendererUrl = new URL(origin)
  rendererUrl.searchParams.set('dsh-desktop-platform', process.platform)
  try {
    await window.loadURL(rendererUrl.href)
    await waitForRendererReady(window.webContents)
  } catch (cause) {
    if (!window.isDestroyed()) window.destroy()
    if (mainWindow === window) mainWindow = undefined
    throw cause
  }
  if (!lifecycle?.isQuitting) window.show()
  return window
}

function schemeMenu(): MenuItemConstructorOptions {
  const active = currentScheme
  const schemes = listConfigurationSchemes(app.getPath('userData'))
  const submenu: MenuItemConstructorOptions[] = schemes.map(scheme => ({
    label: scheme.label,
    type: 'radio',
    checked: scheme.id === active?.id,
    enabled: !schemeSwitching,
    click: () => { void selectConfigurationScheme(scheme.id) },
  }))
  submenu.push(
    { type: 'separator' },
    { label: '管理配置方案...', click: openConfigurationSchemes },
  )
  return {
    label: `配置方案：${active?.label ?? '默认'}`,
    submenu,
  }
}

function openConfigurationSchemes(): void {
  void showConfigurationSchemeManager()
}

function openDesktopTerminal(): void {
  void showDesktopTerminal().catch(async (cause: unknown) => {
    await showSchemeError('桌面终端启动失败', cause)
  })
}

function checkForUpdates(): void {
  void checkForUpdatesManually()
}

function installApplicationMenu(): void {
  const template = desktopApplicationMenuTemplate(process.platform, {
    openConfigurationSchemes,
    openDesktopTerminal,
    checkForUpdates,
  })
  if (template === undefined) return
  Menu.setApplicationMenu(Menu.buildFromTemplate([...template]))
}

function updateMenuLabel(): string {
  if (updatePhase === 'checking') return '正在检查更新...'
  if (updatePhase === 'downloading') {
    return updatePercent === undefined ? '正在下载更新...' : `正在下载更新 ${String(updatePercent)}%`
  }
  if (availableRelease !== undefined) return `发现新版本 ${availableRelease.tagName}`
  return '检查更新...'
}

function rebuildTrayMenu(): void {
  if (tray === undefined) return
  const template: MenuItemConstructorOptions[] = [
    { label: '打开主窗口', click: () => { void lifecycle?.showWindow() } },
    { type: 'separator' },
    schemeMenu(),
    {
      label: '高级功能',
      submenu: [
        {
          label: '桌面终端...',
          click: openDesktopTerminal,
        },
      ],
    },
    {
      label: updateMenuLabel(),
      enabled: updatePhase !== 'checking' && updatePhase !== 'downloading',
      click: checkForUpdates,
    },
    { type: 'separator' },
    { label: '退出', click: () => { void requestAppQuit() } },
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip(APP_NAME)
  rebuildTrayMenu()
  tray.on('click', () => { void lifecycle?.showWindow() })
}

function terminalPreloadPath(): string {
  const path = join(DESKTOP_DIR, 'lib/terminal-preload.cjs')
  if (!existsSync(path)) throw new Error(`desktop terminal preload is missing: ${path}; run pnpm run build first`)
  return path
}

function terminalStyles(): string {
  terminalStylesCache ??= readFileSync(mainRequire.resolve('@xterm/xterm/css/xterm.css'), 'utf8')
  return terminalStylesCache
}

function terminalSenderOwns(event: IpcMainEvent): boolean {
  const window = terminalWindow
  return window !== undefined && !window.isDestroyed() && event.sender === window.webContents
}

function sendTerminal(channel: string, value: unknown): void {
  const window = terminalWindow
  if (window === undefined || window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, value)
}

function sendTerminalFor(window: BrowserWindow, generation: number, channel: string, value: unknown): void {
  if (terminalWindow !== window || terminalGeneration !== generation) return
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  window.webContents.send(channel, value)
}

function reportTerminalProtocolError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause)
  console.error('desktop terminal request failed:', cause)
  sendTerminal(TERMINAL_ERROR_CHANNEL, message)
}

function registerTerminalIpc(): void {
  if (terminalIpcRegistered) return
  terminalIpcRegistered = true
  ipcMain.on(TERMINAL_INPUT_CHANNEL, (event, data: unknown) => {
    if (!terminalSenderOwns(event)) return
    try {
      terminalSession?.write(data)
    } catch (cause) {
      reportTerminalProtocolError(cause)
    }
  })
  ipcMain.on(TERMINAL_RESIZE_CHANNEL, (event, columns: unknown, rows: unknown) => {
    if (!terminalSenderOwns(event)) return
    try {
      const size = validateTerminalDimensions(columns, rows)
      terminalColumns = size.columns
      terminalRows = size.rows
      terminalSession?.resize(size.columns, size.rows)
    } catch (cause) {
      reportTerminalProtocolError(cause)
    }
  })
}

async function shutdownDesktopTerminal(): Promise<void> {
  if (terminalCloseTask !== undefined) return terminalCloseTask
  const window = terminalWindow
  const session = terminalSession
  terminalCloseTask = (async () => {
    let sessionClosed = session === undefined
    try {
      await session?.close()
      sessionClosed = true
    } catch (cause) {
      console.error('desktop terminal shutdown failed:', cause)
      session?.forceStop()
      throw cause
    } finally {
      if (sessionClosed && terminalSession === session) terminalSession = undefined
      terminalWindowCloseAllowed = true
      if (window !== undefined && !window.isDestroyed()) window.destroy()
      terminalWindowCloseAllowed = false
      if (terminalWindow === window) terminalWindow = undefined
    }
  })()
  void terminalCloseTask.finally(() => {
    terminalCloseTask = undefined
  }).catch(() => {})
  return terminalCloseTask
}

async function createTerminalWindow(): Promise<void> {
  terminalColumns = 100
  terminalRows = 30
  const generation = ++terminalGeneration
  const title = `本机终端 · ${currentScheme?.label ?? '默认'}`
  const window = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 640,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#101114',
    title,
    webPreferences: {
      preload: terminalPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  let windowSession: DesktopTerminalSession | undefined
  terminalWindow = window
  window.on('close', (event) => {
    if (terminalWindowCloseAllowed) return
    event.preventDefault()
    void shutdownDesktopTerminal().catch(() => {})
  })
  window.on('closed', () => {
    if (terminalWindow === window) terminalWindow = undefined
    windowSession?.forceStop()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('data:text/html')) return
    event.preventDefault()
  })
  const html = terminalDocument(title, terminalStyles())
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  if (window.isDestroyed()) return
  window.show()

  try {
    const paths = hostPaths()
    const session = await spawnDesktopTerminalSession({
      cwd: paths.cwd,
      env: process.env,
      explicitEnv: {
        DSH_DESKTOP: '1',
        ...(currentScheme === undefined ? {} : { DSH_HOME: currentScheme.harnessHome }),
      },
      columns: terminalColumns,
      rows: terminalRows,
      onData: (data) => { sendTerminalFor(window, generation, TERMINAL_OUTPUT_CHANNEL, data) },
      onExit: (detail) => { sendTerminalFor(window, generation, TERMINAL_EXIT_CHANNEL, detail) },
      log: (message, cause) => { console.error(`${message}:`, cause) },
    })
    windowSession = session
    terminalSession = session
    if (window.isDestroyed() || terminalWindow !== window) {
      await session.close()
      if (terminalSession === session) terminalSession = undefined
      return
    }
    session.resize(terminalColumns, terminalRows)
    sendTerminalFor(window, generation, TERMINAL_READY_CHANNEL, { shell: session.shell.label, pid: session.pid })
  } catch (cause) {
    console.error('desktop terminal startup failed:', cause)
    sendTerminalFor(window, generation, TERMINAL_ERROR_CHANNEL, cause instanceof Error ? cause.message : String(cause))
  }
}

function showDesktopTerminal(): Promise<void> {
  if (applicationIsQuitting()) return Promise.resolve()
  if (terminalCloseTask === undefined) {
    const existing = terminalWindow
    if (existing !== undefined && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return Promise.resolve()
    }
  }
  terminalOpenTask ??= (async () => {
    const closing = terminalCloseTask
    if (closing !== undefined) await closing
    if (applicationIsQuitting()) return
    if (terminalSession !== undefined) await shutdownDesktopTerminal()
    if (applicationIsQuitting()) return
    try {
      await createTerminalWindow()
    } catch (cause) {
      await shutdownDesktopTerminal().catch(() => {})
      throw cause
    }
  })().finally(() => { terminalOpenTask = undefined })
  return terminalOpenTask
}

function schemeDocumentUrl(): string {
  const schemes = listConfigurationSchemes(app.getPath('userData'))
  const html = configurationSchemeDocument(schemes, currentScheme?.id ?? 'default')
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

async function refreshSchemeWindow(): Promise<void> {
  const window = schemeWindow
  if (window === undefined || window.isDestroyed()) return
  await window.loadURL(schemeDocumentUrl())
  rebuildTrayMenu()
}

async function showConfigurationSchemeManager(): Promise<void> {
  const existing = schemeWindow
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  const parent = mainWindow !== undefined && !mainWindow.isDestroyed() && mainWindow.isVisible()
    ? mainWindow
    : undefined
  const window = new BrowserWindow({
    width: 620,
    height: 520,
    minWidth: 520,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: '配置方案',
    ...(parent === undefined ? {} : { parent, modal: true }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  schemeWindow = window
  window.on('closed', () => {
    if (schemeWindow === window) schemeWindow = undefined
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('data:text/html')) return
    event.preventDefault()
    const action = parseConfigurationSchemeAction(url)
    if (action === null) return
    schemeActionTask = schemeActionTask.then(
      () => handleConfigurationSchemeAction(action),
      () => handleConfigurationSchemeAction(action),
    )
  })
  await window.loadURL(schemeDocumentUrl())
  window.show()
}

async function validateConfigurationScheme(scheme: ConfigurationScheme): Promise<void> {
  if (quitRequested) throw new Error('DeepSeeker 正在退出，无法检查配置方案。')
  const paths = hostPaths()
  assertHostArtifacts(paths)
  const controller = new AbortController()
  profileValidationAbortControllers.add(controller)
  const task = validateDshProfile({
    ...paths,
    profileName: 'web',
    env: schemeEnvironment(scheme),
    signal: controller.signal,
  })
  profileValidationTasks.add(task)
  try {
    await task
  } finally {
    profileValidationTasks.delete(task)
    profileValidationAbortControllers.delete(controller)
  }
}

async function showSchemeError(message: string, cause: unknown): Promise<void> {
  await dialog.showMessageBox({
    type: 'error',
    title: message,
    message,
    detail: cause instanceof Error ? cause.message : String(cause),
    buttons: ['知道了'],
    defaultId: 0,
    noLink: true,
  })
}

async function handleConfigurationSchemeAction(action: ConfigurationSchemeAction): Promise<void> {
  if (action.type === 'close') {
    schemeWindow?.close()
    return
  }
  if (action.type === 'select') {
    await selectConfigurationScheme(action.id)
    return
  }
  if (action.type === 'rename') {
    try {
      renameConfigurationScheme(app.getPath('userData'), action.id, action.label)
      await refreshSchemeWindow()
    } catch (cause) {
      await showSchemeError('改名失败', cause)
    }
    return
  }
  if (action.type === 'delete') {
    const target = listConfigurationSchemes(app.getPath('userData'))
      .find(scheme => scheme.id === action.id)
    if (target === undefined) {
      await showSchemeError('删除失败', new Error('配置方案不存在。'))
      return
    }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '删除配置方案',
      message: `删除“${target.label}”？`,
      detail: '这会删除这套方案的模型设置、密钥、插件和会话，无法恢复。',
      buttons: ['删除', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmation.response !== 0) return
    try {
      deleteConfigurationScheme(app.getPath('userData'), target.id)
      await refreshSchemeWindow()
    } catch (cause) {
      await showSchemeError('删除失败', cause)
    }
    return
  }

  let created: ConfigurationScheme | undefined
  try {
    created = createConfigurationScheme(app.getPath('userData'), action.label)
    await validateConfigurationScheme(created)
    await refreshSchemeWindow()
  } catch (cause) {
    if (created !== undefined) {
      try {
        discardNewConfigurationScheme(app.getPath('userData'), created.id)
      } catch (cleanupCause) {
        console.error('failed to clean up a rejected configuration scheme:', cleanupCause)
      }
    }
    await showSchemeError('新建配置方案失败', cause)
  }
}

async function selectConfigurationScheme(id: string): Promise<void> {
  if (schemeSwitching || id === currentScheme?.id) return
  const target = listConfigurationSchemes(app.getPath('userData')).find(scheme => scheme.id === id)
  if (target === undefined) {
    await showSchemeError('切换失败', new Error('配置方案不存在。'))
    return
  }
  const confirmation = await dialog.showMessageBox({
    type: 'question',
    title: '切换配置方案',
    message: `切换到“${target.label}”？`,
    detail: 'DeepSeeker 会先检查这套配置。检查通过后，应用会重启一次。',
    buttons: ['检查并切换', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (confirmation.response !== 0) return

  schemeSwitching = true
  rebuildTrayMenu()
  try {
    await validateConfigurationScheme(target)
    requestConfigurationSchemeSwitch(app.getPath('userData'), target.id)
    app.relaunch()
    await requestAppQuit()
  } catch (cause) {
    schemeSwitching = false
    rebuildTrayMenu()
    await showSchemeError('这套配置暂时不能使用', cause)
  }
}

function queryLatestRelease(): Promise<DeepSeekerReleaseUpdate | null | undefined> {
  if (quitRequested) return Promise.resolve(undefined)
  if (updateCheckTask !== undefined) return updateCheckTask
  updatePhase = 'checking'
  rebuildTrayMenu()
  const controller = new AbortController()
  updateCheckAbortController = controller
  updateCheckTask = checkForDeepSeekerRelease({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    request: (url, init) => net.fetch(url, init),
    signal: controller.signal,
  }).then((result) => {
    availableRelease = result ?? undefined
    updatePhase = availableRelease === undefined ? 'idle' : 'available'
    return result
  }).finally(() => {
    updateCheckTask = undefined
    if (updateCheckAbortController === controller) updateCheckAbortController = undefined
    rebuildTrayMenu()
  })
  return updateCheckTask
}

async function checkForUpdatesAutomatically(): Promise<void> {
  const release = await queryLatestRelease()
  if (release === null || release === undefined || release.version === lastNotifiedVersion) return
  lastNotifiedVersion = release.version
  if (Notification.isSupported()) {
    new Notification({
      title: `${APP_NAME} 有新版本`,
      body: `${release.tagName} 已发布，可以从托盘下载。`,
    }).show()
  }
}

async function checkForUpdatesManually(): Promise<void> {
  const release = await queryLatestRelease()
  if (release === undefined) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '检查更新失败',
      message: '暂时连不上 GitHub Release。',
      detail: '当前版本不会受影响，稍后再试即可。',
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    })
    return
  }
  if (release === null) {
    await dialog.showMessageBox({
      type: 'info',
      title: '已经是最新版本',
      message: `${APP_NAME} ${app.getVersion()} 已经是最新版本。`,
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    })
    return
  }
  if (release.asset === undefined) {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `${APP_NAME} ${release.tagName} 已发布。`,
      detail: '这个版本没有适合当前电脑的安装包，可以打开发布页查看。',
      buttons: ['打开发布页', '稍后'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (result.response === 0) await shell.openExternal(release.htmlUrl)
    return
  }
  const megabytes = (release.asset.size / 1_048_576).toFixed(1)
  const result = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `${APP_NAME} ${release.tagName} 已发布。`,
    detail: `安装包 ${megabytes} MB。确认后才会从 GitHub 下载并打开。`,
    buttons: ['下载', '稍后'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (result.response === 0) await downloadAndOpenUpdate(release)
}

function launchWindowsInstaller(installerPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    })
    const fail = (cause: Error): void => { reject(cause) }
    child.once('error', fail)
    child.once('spawn', () => {
      child.off('error', fail)
      child.unref()
      resolve()
    })
  })
}

function quitAndLaunchWindowsInstaller(installerPath: string): Promise<void> {
  if (installerHandoffTask !== undefined) return installerHandoffTask
  quitRequested = true
  stopUpdateActivity()
  installerHandoffTask = (async () => {
    try {
      await shutdownOwnedProcesses()
      await launchWindowsInstaller(installerPath)
    } catch (cause) {
      await showSchemeError('安装程序无法启动', cause)
    } finally {
      releaseAppQuit()
    }
  })()
  return installerHandoffTask
}

function downloadAndOpenUpdate(release: DeepSeekerReleaseUpdate): Promise<void> {
  if (quitRequested) return Promise.resolve()
  if (updateDownloadTask !== undefined) return updateDownloadTask
  const controller = new AbortController()
  updateDownloadAbortController = controller
  updatePhase = 'downloading'
  updatePercent = 0
  rebuildTrayMenu()
  let windowsInstallerPath: string | undefined
  const operation = downloadDeepSeekerRelease({
    release,
    userDataPath: app.getPath('userData'),
    request: (url, init) => net.fetch(url, init),
    signal: controller.signal,
    onProgress: (received, total) => {
      const percent = Math.min(100, Math.floor(received / total * 100))
      if (percent === updatePercent) return
      updatePercent = percent
      rebuildTrayMenu()
    },
  }).then(async (artifactPath) => {
    if (process.platform === 'darwin') {
      const error = await shell.openPath(artifactPath)
      if (error !== '') throw new Error(error)
      await dialog.showMessageBox({
        type: 'info',
        title: '安装包已打开',
        message: `${APP_NAME} ${release.tagName} 已下载。`,
        detail: release.asset?.artifact === 'zip'
          ? '解压后，把 DeepSeeker 拖进“应用程序”并替换旧版本。'
          : '在打开的磁盘映像里，把 DeepSeeker 拖进“应用程序”。',
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      })
      return
    }
    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: '运行安装程序',
      message: `${APP_NAME} ${release.tagName} 已下载。`,
      detail: '现在退出 DeepSeeker 并运行安装程序？',
      buttons: ['退出并安装', '稍后'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmation.response !== 0) return
    windowsInstallerPath = artifactPath
  }).catch(async (cause: unknown) => {
    if (!controller.signal.aborted) await showSchemeError('更新失败', cause)
  }).finally(() => {
    if (updateDownloadAbortController === controller) updateDownloadAbortController = undefined
    updateDownloadTask = undefined
    updatePercent = undefined
    updatePhase = availableRelease === undefined ? 'idle' : 'available'
    rebuildTrayMenu()
  })
  updateDownloadTask = operation
  return operation.then(async () => {
    if (windowsInstallerPath !== undefined) await quitAndLaunchWindowsInstaller(windowsInstallerPath)
  })
}

function scheduleUpdateChecks(): void {
  if (!app.isPackaged || (process.platform !== 'darwin' && process.platform !== 'win32')) return
  updateInitialTimer = setTimeout(() => {
    void checkForUpdatesAutomatically()
    updateIntervalTimer = setInterval(() => { void checkForUpdatesAutomatically() }, UPDATE_INTERVAL_MS)
  }, UPDATE_INITIAL_DELAY_MS)
}

function stopUpdateActivity(): void {
  if (updateInitialTimer !== undefined) clearTimeout(updateInitialTimer)
  if (updateIntervalTimer !== undefined) clearInterval(updateIntervalTimer)
  updateInitialTimer = undefined
  updateIntervalTimer = undefined
  updateCheckAbortController?.abort()
  updateDownloadAbortController?.abort()
}

async function shutdownOwnedProcesses(): Promise<void> {
  const checkTask = updateCheckTask ?? Promise.resolve()
  const downloadTask = updateDownloadTask ?? Promise.resolve()
  const validationTasks = [...profileValidationTasks]
  const openTerminalTask = terminalOpenTask ?? Promise.resolve()
  for (const controller of profileValidationAbortControllers) controller.abort()
  const outcomes = await Promise.allSettled([
    host?.shutdown() ?? Promise.resolve(),
    shutdownDesktopTerminal(),
    openTerminalTask,
    ...validationTasks,
    checkTask,
    downloadTask,
  ])
  const failures: unknown[] = []
  for (const outcome of outcomes) {
    if (outcome.status !== 'rejected') continue
    const failure: unknown = outcome.reason
    failures.push(failure)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'desktop process shutdown failed')
}

function releaseAppQuit(): void {
  quitReleased = true
  stopUpdateActivity()
  terminalSession?.forceStopSync()
  terminalSession = undefined
  terminalWindowCloseAllowed = true
  terminalWindow?.destroy()
  terminalWindow = undefined
  schemeWindow?.destroy()
  schemeWindow = undefined
  tray?.destroy()
  tray = undefined
  app.quit()
}

/** Join explicit quit requests even while the Host or window is still starting. */
function requestAppQuit(): Promise<void> {
  quitRequested = true
  stopUpdateActivity()
  if (installerHandoffTask !== undefined) return installerHandoffTask
  if (lifecycle !== undefined) return lifecycle.requestQuit()
  bootQuitPromise ??= shutdownOwnedProcesses().catch((error: unknown) => {
    console.error('desktop shutdown failed:', error)
  }).then(() => {
    releaseAppQuit()
  })
  return bootQuitPromise
}

async function startSchemeHost(scheme: ConfigurationScheme): Promise<{ origin: string; supervisor: HostSupervisor }> {
  const paths = hostPaths()
  assertHostArtifacts(paths)
  const supervisor = createHostSupervisor({
    spawnHost: () => spawnDshWeb({
      ...paths,
      profileName: 'web',
      env: schemeEnvironment(scheme),
    }),
    log: chunk => process.stderr.write(chunk),
    onUnexpectedExit: ({ code, signal }) => {
      console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
      void requestAppQuit()
    },
  })
  host = supervisor
  try {
    const origin = await supervisor.start()
    if (quitRequested) {
      await supervisor.shutdown()
      if (host === supervisor) host = undefined
      throw new Error('desktop startup cancelled because application quit was requested')
    }
    return { origin, supervisor }
  } catch (cause) {
    try {
      await supervisor.shutdown()
    } catch (cleanupCause) {
      if (host === supervisor) host = undefined
      throw new ConfigurationStartupCleanupError(cause, cleanupCause)
    }
    if (host === supervisor) host = undefined
    throw cause
  }
}

async function startSchemeGeneration(scheme: ConfigurationScheme): Promise<void> {
  const started = await startSchemeHost(scheme)
  host = started.supervisor
  hostOrigin = started.origin
  currentScheme = scheme
  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow: createMainWindow,
    disposeHost: shutdownOwnedProcesses,
    quit: releaseAppQuit,
    reportError: (error) => { console.error('desktop shutdown failed:', error) },
  })
  try {
    await lifecycle.showWindow()
  } catch (cause) {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.destroy()
    try {
      await started.supervisor.shutdown()
    } catch (cleanupCause) {
      throw new ConfigurationStartupCleanupError(cause, cleanupCause)
    }
    if (host === started.supervisor) host = undefined
    hostOrigin = undefined
    currentScheme = undefined
    lifecycle = undefined
    throw cause
  }
}

async function boot(): Promise<void> {
  if (bootQuitPromise !== undefined) return
  const userDataPath = app.getPath('userData')
  const startup = beginConfigurationSchemeStartup(userDataPath)
  let recoveredFrom: string | undefined = startup.rolledBackFrom
  hardenSession()
  registerTerminalIpc()
  const result = await startConfigurationWithFallback({
    initial: startup.scheme,
    lastKnownGoodId: startup.state.lastKnownGood,
    start: startSchemeGeneration,
    cancelled: () => quitRequested,
    rollback: (failed) => {
      const fallbackState = markConfigurationSchemeFailed(userDataPath, failed.id)
      const fallback = listConfigurationSchemes(userDataPath)
        .find(candidate => candidate.id === fallbackState.active)
      if (fallback === undefined) throw new Error('last-known-good configuration scheme is missing')
      return fallback
    },
  })
  const scheme = result.scheme
  if (quitRequested) return
  recoveredFrom = result.recoveredFrom ?? recoveredFrom
  createTray()
  installApplicationMenu()
  markConfigurationSchemeHealthy(userDataPath, scheme.id)
  scheduleUpdateChecks()
  if (recoveredFrom !== undefined || startup.recoveredState) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '已恢复可用配置',
      message: `DeepSeeker 已使用“${scheme.label}”启动。`,
      detail: recoveredFrom === undefined ? '损坏的配置方案状态已重置。' : `“${recoveredFrom}”启动失败，没有覆盖当前可用配置。`,
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    })
  }
}

app.setName(APP_NAME)
process.on('exit', () => { terminalSession?.forceStopSync() })
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { void lifecycle?.showWindow() })
  app.on('activate', () => { void lifecycle?.showWindow() })
  app.on('window-all-closed', () => {
    // Tray and Host own application lifetime on every platform.
  })
  app.on('before-quit', (event: Event) => {
    if (quitReleased) return
    event.preventDefault()
    void requestAppQuit()
  })
  app.whenReady().then(boot).catch(async (error: unknown) => {
    console.error('desktop startup failed:', error)
    if (!quitRequested && bootQuitPromise === undefined) {
      try {
        const state = readConfigurationSchemeState(app.getPath('userData'))
        if (state.active !== state.lastKnownGood) {
          markConfigurationSchemeFailed(app.getPath('userData'), state.active)
        }
      } catch (stateError) {
        console.error('desktop configuration rollback failed:', stateError)
      }
      await dialog.showMessageBox({
        type: 'error',
        title: `${APP_NAME} failed to start`,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    await requestAppQuit()
  })
}
