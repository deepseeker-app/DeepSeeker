/** Bounded renderer-readiness probe for the sandboxed desktop BrowserWindow. */

const READY_EXPRESSION = "document.documentElement.getAttribute('data-dsh-app-ready') === 'true'"
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_PROBE_TIMEOUT_MS = 1_000

/** BrowserWindow webContents operations used by the readiness probe. */
export interface RendererWebContents {
  /** Whether Electron already destroyed this renderer. */
  isDestroyed(): boolean
  /** Evaluate a read-only expression in the isolated renderer. */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

/** Timing overrides used by focused tests. */
export interface RendererReadinessOptions {
  /** Complete startup deadline. */
  readonly timeoutMs?: number
  /** Delay between completed probes. */
  readonly pollIntervalMs?: number
  /** Bound for one renderer evaluation. */
  readonly probeTimeoutMs?: number
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function probeRenderer(contents: RendererWebContents, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const evaluation = Promise.resolve()
    .then(() => contents.executeJavaScript(READY_EXPRESSION, false))
    .then(value => ({ kind: 'value' as const, value: value === true }))
    .catch((cause: unknown) => ({ kind: 'error' as const, cause }))
  const timeout = new Promise<{ kind: 'error'; cause: Error }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: 'error', cause: new Error('renderer readiness probe timed out') })
    }, timeoutMs)
  })
  const outcome = await Promise.race([evaluation, timeout])
  if (timer !== undefined) clearTimeout(timer)
  if (outcome.kind === 'error') throw outcome.cause
  return outcome.value
}

function detailOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Wait until the Web shell confirms that React committed the assembled UI.
 * @param contents - Main-window renderer to probe.
 * @param options - Optional total, polling, and per-probe bounds.
 * @returns Once the renderer publishes the ready marker.
 * @throws When the renderer is destroyed or never publishes readiness before the deadline.
 */
export async function waitForRendererReady(
  contents: RendererWebContents,
  options: RendererReadinessOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let lastFailure: unknown

  while (Date.now() < deadline) {
    if (contents.isDestroyed()) throw new Error('desktop renderer was destroyed before it became ready')
    const remaining = deadline - Date.now()
    try {
      if (await probeRenderer(contents, Math.max(1, Math.min(probeTimeoutMs, remaining)))) return
    } catch (cause) {
      lastFailure = cause
    }
    const wait = Math.min(pollIntervalMs, deadline - Date.now())
    if (wait > 0) await delay(wait)
  }

  const suffix = lastFailure === undefined ? '' : `: ${detailOf(lastFailure)}`
  throw new Error(`desktop renderer did not become ready within ${timeoutMs} ms${suffix}`)
}
