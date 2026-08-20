/** Native application-menu structure shared by the desktop main process and tests. */

import type { MenuItemConstructorOptions } from 'electron'

/** Operations exposed from the macOS Tools menu. */
export interface DesktopToolMenuHandlers {
  readonly openConfigurationSchemes: () => void
  readonly openDesktopTerminal: () => void
  readonly checkForUpdates: () => void
}

/** Build the macOS-only application menu without changing other platforms. */
export function desktopApplicationMenuTemplate(
  platform: NodeJS.Platform,
  handlers: DesktopToolMenuHandlers,
): readonly MenuItemConstructorOptions[] | undefined {
  if (platform !== 'darwin') return undefined
  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      label: '工具',
      submenu: [
        { label: '配置方案...', click: handlers.openConfigurationSchemes },
        { label: '桌面终端...', click: handlers.openDesktopTerminal },
        { type: 'separator' },
        { label: '检查更新...', click: handlers.checkForUpdates },
      ],
    },
    { role: 'windowMenu' },
  ]
}
