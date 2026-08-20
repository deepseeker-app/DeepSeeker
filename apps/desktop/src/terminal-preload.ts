/** Sandboxed xterm renderer for the script-free desktop terminal document. */

import { ipcRenderer } from 'electron'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  TERMINAL_ERROR_CHANNEL,
  TERMINAL_EXIT_CHANNEL,
  TERMINAL_INPUT_CHANNEL,
  TERMINAL_OUTPUT_CHANNEL,
  TERMINAL_READY_CHANNEL,
  TERMINAL_RESIZE_CHANNEL,
} from './terminal-protocol.ts'

window.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector<HTMLElement>('#terminal')
  const status = document.querySelector<HTMLElement>('#terminal-status')
  if (container === null || status === null) return

  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'bar',
    disableStdin: true,
    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5_000,
    theme: {
      background: '#101114',
      foreground: '#f1f3f5',
      cursor: '#ffb020',
      cursorAccent: '#101114',
      selectionBackground: '#3b4252',
    },
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(container)

  let resizeFrame: number | undefined
  const fitAndReport = (): void => {
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      fit.fit()
      ipcRenderer.send(TERMINAL_RESIZE_CHANNEL, terminal.cols, terminal.rows)
    })
  }
  const observer = new ResizeObserver(fitAndReport)
  observer.observe(container)
  fitAndReport()
  terminal.focus()

  terminal.onData((data) => { ipcRenderer.send(TERMINAL_INPUT_CHANNEL, data) })
  ipcRenderer.on(TERMINAL_READY_CHANNEL, (_event, detail: unknown) => {
    terminal.options.disableStdin = false
    const shell = typeof detail === 'object' && detail !== null && 'shell' in detail
      ? String(detail.shell)
      : '本机 Shell'
    status.textContent = shell
    terminal.focus()
  })
  ipcRenderer.on(TERMINAL_OUTPUT_CHANNEL, (_event, data: unknown) => {
    if (typeof data === 'string') terminal.write(data)
  })
  ipcRenderer.on(TERMINAL_EXIT_CHANNEL, (_event, detail: unknown) => {
    terminal.options.disableStdin = true
    const exitCode = typeof detail === 'object' && detail !== null && 'exitCode' in detail
      ? String(detail.exitCode)
      : '?'
    status.textContent = `已退出 (${exitCode})`
    terminal.write(`\r\n\x1b[90m[进程已退出，状态码 ${exitCode}]\x1b[0m\r\n`)
  })
  ipcRenderer.on(TERMINAL_ERROR_CHANNEL, (_event, message: unknown) => {
    const text = typeof message === 'string' ? message : '终端发生错误'
    status.textContent = '异常'
    terminal.write(`\r\n\x1b[31m[${text}]\x1b[0m\r\n`)
  })

  window.addEventListener('beforeunload', () => {
    observer.disconnect()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    terminal.dispose()
  }, { once: true })
})
