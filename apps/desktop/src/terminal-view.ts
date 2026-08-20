/** Static, script-free document for the sandboxed desktop terminal window. */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Render the terminal document. All behavior lives in the isolated preload.
 * @param title - Window heading, including the active configuration scheme.
 * @param xtermStyles - Trusted stylesheet read from the installed xterm package.
 * @returns A complete data-URL-safe HTML document with no renderer script.
 */
export function terminalDocument(title: string, xtermStyles: string): string {
  if (/<\/style/iu.test(xtermStyles)) throw new Error('terminal stylesheet contains a closing style tag')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
  <title>${escapeHtml(title)}</title>
  <style>
${xtermStyles}
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #101114; color: #f4f4f5; }
    body { display: grid; grid-template-rows: 42px minmax(0, 1fr); }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 14px; border-bottom: 1px solid #2a2c31; background: #17181c; user-select: none; }
    header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; letter-spacing: 0; }
    #terminal-status { flex: none; color: #9297a1; font: 12px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0; }
    #terminal { min-width: 0; min-height: 0; padding: 10px 8px 8px 12px; }
    #terminal .xterm { height: 100%; }
    #terminal .xterm-viewport { scrollbar-color: #454952 transparent; scrollbar-width: thin; }
  </style>
</head>
<body>
  <header><strong>${escapeHtml(title)}</strong><span id="terminal-status">正在启动...</span></header>
  <main id="terminal" aria-label="本机终端"></main>
</body>
</html>`
}
