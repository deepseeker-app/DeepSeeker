/** Locale namespace owned by the balance surface. */
export const NS = 'deepseek-balance'

/** Chinese source-of-truth dictionary. */
export const zh = {
  'title': 'DeepSeek 余额',
  'rail': '查看 DeepSeek 余额',
  'loading': '正在读取余额',
  'available': '账户可用',
  'notAvailable': '余额查询暂不可用',
  'low': '余额有点低',
  'granted': '赠送余额',
  'toppedUp': '充值余额',
  'refresh': '刷新',
  'topUp': '去充值',
  'topUpTitle': 'DeepSeek 充值',
  'topUpDescription': '扫码或打开 DeepSeek 官方充值页。',
  'scanTopUp': '扫码打开充值页',
  'topUpNote': '充值金额和支付方式以 DeepSeek 官网为准。',
  'openTopUp': '打开 DeepSeek 官网',
  'qrLabel': 'DeepSeek 官方充值页二维码',
  'close': '关闭',
  'updated': '更新于 {time}',
  'error.missing_key': '还没配置 DeepSeek API Key',
  'error.invalid_key': 'API Key 无效，请到设置里检查',
  'error.unavailable': '余额暂时没取到',
} as const

/** Keys shared by both balance dictionaries. */
export type DeepSeekBalanceKey = keyof typeof zh

/** English dictionary kept key-identical to the Chinese source. */
export const en: Record<DeepSeekBalanceKey, string> = {
  'title': 'DeepSeek balance',
  'rail': 'View DeepSeek balance',
  'loading': 'Loading balance',
  'available': 'Account available',
  'notAvailable': 'Balance lookup unavailable',
  'low': 'Balance is running low',
  'granted': 'Granted',
  'toppedUp': 'Topped up',
  'refresh': 'Refresh',
  'topUp': 'Top up',
  'topUpTitle': 'Top up DeepSeek',
  'topUpDescription': 'Scan or open DeepSeek\'s official top-up page.',
  'scanTopUp': 'Scan to open the top-up page',
  'topUpNote': 'Confirm the amount and payment method on DeepSeek.',
  'openTopUp': 'Open DeepSeek',
  'qrLabel': 'QR code for DeepSeek\'s official top-up page',
  'close': 'Close',
  'updated': 'Updated at {time}',
  'error.missing_key': 'DeepSeek API Key is not configured',
  'error.invalid_key': 'API Key is invalid; check Settings',
  'error.unavailable': 'Could not load the balance',
}
