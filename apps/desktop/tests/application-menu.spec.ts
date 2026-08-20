import { describe, expect, it, vi } from 'vitest'
import { desktopApplicationMenuTemplate } from '../src/application-menu.ts'

describe('desktop application menu', () => {
  it('exposes the existing desktop operations from a macOS Tools menu', () => {
    const handlers = {
      openConfigurationSchemes: vi.fn(),
      openDesktopTerminal: vi.fn(),
      checkForUpdates: vi.fn(),
    }
    const template = desktopApplicationMenuTemplate('darwin', handlers)
    expect(template?.map(item => item.role ?? item.label)).toEqual([
      'appMenu',
      'fileMenu',
      'editMenu',
      'viewMenu',
      '工具',
      'windowMenu',
    ])

    const tools = template?.find(item => item.label === '工具')
    expect(tools?.submenu).toEqual([
      { label: '配置方案...', click: handlers.openConfigurationSchemes },
      { label: '桌面终端...', click: handlers.openDesktopTerminal },
      { type: 'separator' },
      { label: '检查更新...', click: handlers.checkForUpdates },
    ])
  })

  it.each<NodeJS.Platform>(['win32', 'linux'])('does not replace the native %s menu', (platform) => {
    expect(desktopApplicationMenuTemplate(platform, {
      openConfigurationSchemes: vi.fn(),
      openDesktopTerminal: vi.fn(),
      checkForUpdates: vi.fn(),
    })).toBeUndefined()
  })
})
