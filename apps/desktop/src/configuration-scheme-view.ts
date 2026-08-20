/** Static, sandbox-friendly configuration-scheme manager document. */

import type { ConfigurationScheme } from './configuration-schemes.ts'

const ACTION_ORIGIN = 'https://deepseeker.local'
const ACTION_ROOT = '/configuration-schemes/'

export type ConfigurationSchemeAction =
  | { readonly type: 'close' }
  | { readonly type: 'create'; readonly label: string }
  | { readonly type: 'delete'; readonly id: string }
  | { readonly type: 'rename'; readonly id: string; readonly label: string }
  | { readonly type: 'select'; readonly id: string }

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function schemeRows(schemes: readonly ConfigurationScheme[], currentId: string): string {
  return schemes.map((scheme) => {
    const id = encodeURIComponent(scheme.id)
    const label = escapeHtml(scheme.label)
    const current = scheme.id === currentId
    const name = scheme.builtIn
      ? `<strong>${label}</strong><span>现有 DeepSeeker 数据</span>`
      : `<form action="${ACTION_ORIGIN}${ACTION_ROOT}rename" method="get">
          <input type="hidden" name="id" value="${escapeHtml(scheme.id)}">
          <input aria-label="配置方案名称" name="label" maxlength="40" value="${label}" required>
          <button type="submit" class="quiet">改名</button>
        </form>`
    const action = current
      ? '<span class="current">正在使用</span>'
      : `<div class="scheme-actions">
          <a class="switch" href="${ACTION_ORIGIN}${ACTION_ROOT}select?id=${id}">切换</a>
          ${scheme.builtIn ? '' : `<a class="delete" href="${ACTION_ORIGIN}${ACTION_ROOT}delete?id=${id}">删除</a>`}
        </div>`
    return `<li><div class="scheme-name">${name}</div>${action}</li>`
  }).join('')
}

/** Build a self-contained manager page that needs no preload or renderer capability. */
export function configurationSchemeDocument(
  schemes: readonly ConfigurationScheme[],
  currentId: string,
): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action ${ACTION_ORIGIN}; base-uri 'none'">
  <title>配置方案</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
    main { width: min(620px, 100%); margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 0; }
    .lead { margin: 0 0 22px; color: GrayText; font-size: 13px; line-height: 1.55; }
    ul { margin: 0; padding: 0; list-style: none; border-top: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    li { min-height: 62px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
    .scheme-name { min-width: 0; flex: 1; }
    .scheme-name strong { display: block; font-size: 14px; font-weight: 600; }
    .scheme-name span { display: block; margin-top: 3px; color: GrayText; font-size: 12px; }
    form { display: flex; align-items: center; gap: 8px; width: 100%; }
    input { min-width: 0; flex: 1; height: 34px; padding: 0 10px; border: 1px solid color-mix(in srgb, CanvasText 22%, transparent); border-radius: 6px; background: Canvas; color: CanvasText; font: inherit; }
    button, a { height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 0 13px; border-radius: 6px; font: 13px/1 inherit; text-decoration: none; cursor: pointer; }
    button { border: 0; background: #f59e0b; color: #15100a; font-weight: 600; }
    button.quiet, a.switch { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: transparent; color: CanvasText; font-weight: 500; }
    .scheme-actions { flex: none; display: flex; align-items: center; gap: 4px; }
    a.delete { color: #dc2626; }
    .current { flex: none; color: #16a34a; font-size: 12px; }
    .create { margin-top: 24px; }
    .create label { display: block; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
    .footer { margin-top: 20px; text-align: right; }
    .footer a { color: GrayText; }
    :focus-visible { outline: 2px solid #f59e0b; outline-offset: 2px; }
  </style>
</head>
<body>
  <main>
    <h1>配置方案</h1>
    <p class="lead">每套方案都有自己的模型、密钥、插件和会话。切换时 DeepSeeker 会先检查配置，再重启一次。</p>
    <ul>${schemeRows(schemes, currentId)}</ul>
    <section class="create">
      <label for="new-label">新建配置方案</label>
      <form action="${ACTION_ORIGIN}${ACTION_ROOT}create" method="get">
        <input id="new-label" name="label" maxlength="40" placeholder="比如：工作、个人、测试" required autofocus>
        <button type="submit">新建</button>
      </form>
    </section>
    <div class="footer"><a href="${ACTION_ORIGIN}${ACTION_ROOT}close">关闭</a></div>
  </main>
</body>
</html>`
}

/** Parse an allowlisted manager navigation into one native action. */
export function parseConfigurationSchemeAction(raw: string): ConfigurationSchemeAction | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.origin !== ACTION_ORIGIN || !url.pathname.startsWith(ACTION_ROOT)) return null
  const action = url.pathname.slice(ACTION_ROOT.length)
  if (action === 'close') return { type: 'close' }
  if (action === 'create') return { type: 'create', label: url.searchParams.get('label') ?? '' }
  if (action === 'delete') return { type: 'delete', id: url.searchParams.get('id') ?? '' }
  if (action === 'select') return { type: 'select', id: url.searchParams.get('id') ?? '' }
  if (action === 'rename') {
    return {
      type: 'rename',
      id: url.searchParams.get('id') ?? '',
      label: url.searchParams.get('label') ?? '',
    }
  }
  return null
}
