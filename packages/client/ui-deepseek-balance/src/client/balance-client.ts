import {
  DEEPSEEK_BALANCE_ROUTE,
  type DeepSeekBalance,
  type DeepSeekBalanceErrorCode,
} from '../api.ts'

/** Stable client error carrying only a renderable code. */
export class DeepSeekBalanceClientError extends Error {
  constructor(readonly code: DeepSeekBalanceErrorCode) {
    super(code)
    this.name = 'DeepSeekBalanceClientError'
  }
}

function isBalance(value: unknown): value is DeepSeekBalance {
  if (typeof value !== 'object' || value === null) return false
  const balance = value as Partial<DeepSeekBalance>
  return typeof balance.isAvailable === 'boolean'
    && (balance.currency === 'CNY' || balance.currency === 'USD')
    && typeof balance.totalBalance === 'number' && Number.isFinite(balance.totalBalance)
    && typeof balance.grantedBalance === 'number' && Number.isFinite(balance.grantedBalance)
    && typeof balance.toppedUpBalance === 'number' && Number.isFinite(balance.toppedUpBalance)
    && typeof balance.updatedAt === 'string'
}

function isErrorCode(value: unknown): value is DeepSeekBalanceErrorCode {
  return value === 'missing_key' || value === 'invalid_key' || value === 'unavailable'
}

/**
 * Fetch and validate the Host projection.
 * @param signal - aborts the browser request when the card unmounts.
 * @returns the validated balance value.
 */
export async function loadDeepSeekBalance(signal: AbortSignal): Promise<DeepSeekBalance> {
  const response = await fetch(DEEPSEEK_BALANCE_ROUTE, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new DeepSeekBalanceClientError('unavailable')
  }
  if (typeof body !== 'object' || body === null) throw new DeepSeekBalanceClientError('unavailable')
  const result = body as { ok?: unknown; balance?: unknown; code?: unknown }
  if (response.ok && result.ok === true && isBalance(result.balance)) return result.balance
  throw new DeepSeekBalanceClientError(isErrorCode(result.code) ? result.code : 'unavailable')
}
