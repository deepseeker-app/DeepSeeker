/** Same-origin route exposed by the Host half. */
export const DEEPSEEK_BALANCE_ROUTE = '/deepseeker/deepseek-balance'

/** Currency values currently documented by the DeepSeek balance API. */
export type DeepSeekBalanceCurrency = 'CNY' | 'USD'

/** Browser-safe balance projection. No credential or upstream body crosses this route. */
export interface DeepSeekBalance {
  isAvailable: boolean
  currency: DeepSeekBalanceCurrency
  totalBalance: number
  grantedBalance: number
  toppedUpBalance: number
  updatedAt: string
}

/** Stable failures rendered by the browser half. */
export type DeepSeekBalanceErrorCode = 'missing_key' | 'invalid_key' | 'unavailable'

/** Same-origin response envelope for a balance value or stable failure code. */
export type DeepSeekBalanceResponse =
  | { ok: true; balance: DeepSeekBalance }
  | { ok: false; code: DeepSeekBalanceErrorCode }
