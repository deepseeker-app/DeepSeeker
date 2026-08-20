/** Host HTTP bridge for browser-client RPC. */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { clientRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES, type FetchHandler } from './http-bridge.ts'
import {
  assertTrustedAuthority,
  hasSameOriginBrowserMarkers,
  isLoopbackApiRequest,
  isTrustedApiRequest,
} from './api-request-trust.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Optional authenticated request decision supplied by remote-web-ui.
     * @mode bail
     * @param request - original Node HTTP request, including the paired-device cookie.
     */
    'remote-web-ui/authorize-http'(request: IncomingMessage): 'allow' | 'deny' | undefined
    /** Broadcast after paired-device authorization state changes. */
    'remote-web-ui/authorization-changed'(): void
  }
}

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /**
   * Require an explicit `remote-web-ui/authorize-http` decision for every
   * non-loopback HTTP request and WebSocket upgrade.
   */
  requireRemoteAuthorization?: boolean
  /** Maximum buffered JSON body for every `/api` request. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  requireRemoteAuthorization: z.boolean().default(false),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Methods gated to loopback even on a trusted-host deployment. Directory
 * browsing, directory creation, and workspace creation can select arbitrary
 * host filesystem roots; native dialogs act on the host machine. The settings
 * and credential domains mutate the user's configuration and secret store,
 * and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, explicitly not authentication, so the whole
 * configuration plane stays loopback-same-origin until a real authentication
 * layer exists. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.listDirectory',
  'host.createDirectory',
  'host.openPath',
  'workspace.create',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const requireRemoteAuthorization = config?.requireRemoteAuthorization ?? false
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const pathname = new URL(request.url).pathname
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  })
  const remoteFetchHandler = restrictRemoteWorkspaceRoots(fetchHandler)
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      if (!isAuthorizedApiRequest(ctx, req, trustedHosts, requireRemoteAuthorization)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      const loopback = isLoopbackApiRequest(req)
      const method = apiMethod(req.url)
      if (!loopback
        && ((method !== undefined && PRIVILEGED_METHODS.has(method))
          || connection.requiresLoopbackAuthority(API_PATH, method))) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, loopback ? fetchHandler : remoteFetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const remoteDownlinks = new Map<Duplex, IncomingMessage>()
    const recheckRemoteDownlink = (socket: Duplex, request: IncomingMessage): boolean => {
      let authorized = false
      try {
        authorized = isAuthorizedApiRequest(ctx, request, trustedHosts, requireRemoteAuthorization)
      } catch {
        // A failing live authorizer must not leave a remote event stream open.
      }
      if (authorized) return true
      remoteDownlinks.delete(socket)
      socket.destroy()
      return false
    }
    const recheckRemoteDownlinks = (): void => {
      for (const [socket, request] of remoteDownlinks) {
        if (socket.destroyed) remoteDownlinks.delete(socket)
        else recheckRemoteDownlink(socket, request)
      }
    }
    const registerDownlink = (
      path: string,
      handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => void,
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          if (!isAuthorizedApiRequest(ctx, req, trustedHosts, requireRemoteAuthorization)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          if (isLoopbackApiRequest(req)) {
            handle(req, socket, head)
            return
          }
          const forget = (): void => { remoteDownlinks.delete(socket) }
          remoteDownlinks.set(socket, req)
          socket.once('close', forget)
          if (!recheckRemoteDownlink(socket, req)) {
            socket.off('close', forget)
            return
          }
          try {
            handle(req, socket, head)
          } catch (error) {
            socket.off('close', forget)
            forget()
            throw error
          }
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(
      () => apiCtx.on('remote-web-ui/authorization-changed', recheckRemoteDownlinks),
      'client-connection: remote WebSocket authorization',
    )
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
  })
}

function isAuthorizedApiRequest(
  ctx: Context,
  request: IncomingMessage,
  trustedHosts: readonly string[],
  requireRemoteAuthorization: boolean,
): boolean {
  // Cloudflare Tunnel originates from a loopback socket too, so both socket
  // and Host are required before the desktop shortcut applies.
  if (isLoopbackApiRequest(request)) return true
  if (!hasSameOriginBrowserMarkers(request)) return false
  const paired = ctx.bail(ctx, 'remote-web-ui/authorize-http', request)
  if (paired !== undefined) return paired === 'allow'
  if (requireRemoteAuthorization) return false

  // Preserve legacy trusted-host deployments when no authenticated remote
  // authorizer is mounted. A remote peer spoofing a loopback Host is excluded:
  // real loopback was already accepted above, and `isTrustedApiRequest(req, [])`
  // identifies the Host-only shortcut that must not be used here.
  return isTrustedApiRequest(request, trustedHosts)
    && !isTrustedApiRequest(request, [])
}

/** Extract one unary endpoint name from a Node request URL. */
function apiMethod(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const pathname = new URL(url, 'http://dsh.internal').pathname
  return pathname.startsWith(`${API_PATH}/`) ? pathname.slice(API_PATH.length + 1) : undefined
}

/** Keep paired clients on registered workspaces instead of caller-chosen roots. */
function restrictRemoteWorkspaceRoots(delegate: FetchHandler): FetchHandler {
  return {
    async fetch(request): Promise<Response> {
      const pathname = new URL(request.url).pathname
      if (request.method !== 'POST' || pathname !== `${API_PATH}/session.create`) {
        return delegate.fetch(request)
      }

      let body: unknown
      try {
        body = await request.clone().json()
      } catch {
        return delegate.fetch(request)
      }
      const envelope = clientRequestSchema.safeParse(body)
      if (envelope.success
        && envelope.data.method === 'session.create'
        && hasOwnCwd(envelope.data.payload)) {
        return new Response('forbidden', { status: 403 })
      }
      return delegate.fetch(request)
    },
  }
}

function hasOwnCwd(payload: unknown): boolean {
  return payload !== null
    && typeof payload === 'object'
    && Object.prototype.hasOwnProperty.call(payload, 'cwd')
}
