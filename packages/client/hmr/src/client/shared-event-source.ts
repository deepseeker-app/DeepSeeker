/** Cross-tab ownership for the HMR SSE connection. */

export interface SharedEventSourceOptions {
  /** Same-origin SSE endpoint. */
  url: string
  /** Stable name shared by every tab that consumes the endpoint. */
  key: string
  /** SSE event name; defaults to the standard `message` event. */
  eventName?: string
  /** Delivers one raw SSE message in every tab. */
  onMessage(data: string): void
  /** Reports coordination failure before this tab falls back to its own connection. */
  onCoordinationError(error: unknown): void
}

const CHANNEL_PREFIX = 'dsh:shared-event-source:'
const LOCK_PREFIX = 'dsh:shared-event-source-owner:'

/**
 * Keep one EventSource open per browser profile and relay its messages to the
 * other same-origin tabs. Chromium allows only a small number of HTTP/1.1
 * connections per origin; one HMR stream per tab can otherwise starve normal
 * settings and pairing requests.
 * @param options - Shared endpoint identity and per-tab delivery callbacks.
 * @returns A disposer that releases ownership and closes this tab's resources.
 */
export function subscribeSharedEventSource(options: SharedEventSourceOptions): () => void {
  const eventName = options.eventName ?? 'message'
  const coordinationKey = `${options.key}:${eventName}`
  let source: EventSource | undefined
  let sourceListener: ((event: MessageEvent<string>) => void) | undefined
  const closeSource = (): void => {
    if (source === undefined) return
    if (sourceListener !== undefined) source.removeEventListener(eventName, sourceListener)
    source.close()
    source = undefined
    sourceListener = undefined
  }
  const openSource = (relay?: BroadcastChannel): void => {
    source = new EventSource(options.url)
    sourceListener = (event: MessageEvent<string>) => {
      options.onMessage(event.data)
      relay?.postMessage(event.data)
    }
    source.addEventListener(eventName, sourceListener)
  }

  const locks = (navigator as unknown as { locks?: LockManager }).locks
  if (typeof BroadcastChannel === 'undefined' || locks === undefined) {
    openSource()
    return closeSource
  }

  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${coordinationKey}`)
  const onBroadcast = (event: MessageEvent<unknown>): void => {
    if (typeof event.data === 'string') options.onMessage(event.data)
  }
  channel.addEventListener('message', onBroadcast)

  let disposed = false
  let releaseOwner: (() => void) | undefined
  const controller = new AbortController()
  void locks.request(
    `${LOCK_PREFIX}${coordinationKey}`,
    { mode: 'exclusive', signal: controller.signal },
    async () => {
      openSource(channel)
      await new Promise<void>((resolve) => { releaseOwner = resolve })
      closeSource()
    },
  ).catch((error: unknown) => {
    if (disposed || controller.signal.aborted) return
    options.onCoordinationError(error)
    openSource()
  })

  return () => {
    if (disposed) return
    disposed = true
    controller.abort()
    releaseOwner?.()
    closeSource()
    channel.removeEventListener('message', onBroadcast)
    channel.close()
  }
}
