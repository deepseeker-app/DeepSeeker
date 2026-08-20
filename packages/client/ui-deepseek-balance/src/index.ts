/**
 * DeepSeek balance plugin, Host half. It resolves the configured API key for
 * every request, calls DeepSeek's official balance endpoint, and exposes only
 * a normalized balance record to the same-origin browser.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  DEEPSEEK_BALANCE_ROUTE,
  type DeepSeekBalance,
  type DeepSeekBalanceCurrency,
  type DeepSeekBalanceResponse,
} from './api.ts'

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const KEY_REF = credentialRef('DEEPSEEK_API_KEY')
const MONEY = /^\d+(?:\.\d{1,8})?$/

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'client-ui-deepseek-balance'
/** Host services required by the route. */
export const inject = ['webServer', 'credentials']

interface UpstreamBalanceInfo {
  currency: DeepSeekBalanceCurrency
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMoney(value: unknown): number {
  if (typeof value !== 'string' || !MONEY.test(value)) throw new TypeError('invalid money value')
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new TypeError('money value is not finite')
  return parsed
}

function parseInfo(value: unknown): UpstreamBalanceInfo | undefined {
  if (!isRecord(value) || (value.currency !== 'CNY' && value.currency !== 'USD')) return undefined
  return {
    currency: value.currency,
    total_balance: String(value.total_balance),
    granted_balance: String(value.granted_balance),
    topped_up_balance: String(value.topped_up_balance),
  }
}

/**
 * Normalize the documented upstream response and reject malformed money.
 * @param payload - decoded JSON returned by DeepSeek.
 * @param updatedAt - timestamp attached to the normalized projection.
 * @returns a validated browser-safe balance record.
 */
export function parseBalancePayload(payload: unknown, updatedAt = new Date().toISOString()): DeepSeekBalance {
  if (!isRecord(payload) || typeof payload.is_available !== 'boolean' || !Array.isArray(payload.balance_infos)) {
    throw new TypeError('invalid balance response')
  }
  const infos = payload.balance_infos.map(parseInfo).filter(info => info !== undefined)
  const selected = infos.find(info => info.currency === 'CNY') ?? infos[0]
  if (selected === undefined) {
    if (!payload.is_available) {
      return {
        isAvailable: false,
        currency: 'CNY',
        totalBalance: 0,
        grantedBalance: 0,
        toppedUpBalance: 0,
        updatedAt,
      }
    }
    throw new TypeError('balance response has no supported currency')
  }
  return {
    isAvailable: payload.is_available,
    currency: selected.currency,
    totalBalance: parseMoney(selected.total_balance),
    grantedBalance: parseMoney(selected.granted_balance),
    toppedUpBalance: parseMoney(selected.topped_up_balance),
    updatedAt,
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: DeepSeekBalanceResponse,
  head: boolean,
): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(json),
  })
  res.end(head ? undefined : json)
}

async function resolveBalance(ctx: Context): Promise<DeepSeekBalanceResponse> {
  let credential
  try {
    credential = await ctx.credentials.resolve(KEY_REF)
  } catch {
    ctx.logger.warn('deepseek-balance: credential lookup failed')
    return { ok: false, code: 'unavailable' }
  }
  if (credential === undefined) return { ok: false, code: 'missing_key' }

  try {
    const response = await fetch(DEEPSEEK_BALANCE_URL, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${credential.value}`,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'invalid_key' }
    }
    if (!response.ok) return { ok: false, code: 'unavailable' }
    return { ok: true, balance: parseBalancePayload(await response.json()) }
  } catch {
    ctx.logger.warn('deepseek-balance: upstream request failed')
    return { ok: false, code: 'unavailable' }
  }
}

/** Register the read-only same-origin balance route with body-level account states. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DEEPSEEK_BALANCE_ROUTE,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const result = await resolveBalance(ctx)
      sendJson(res, 200, result, req.method === 'HEAD')
    },
  }), 'ui-deepseek-balance: balance route')
}
