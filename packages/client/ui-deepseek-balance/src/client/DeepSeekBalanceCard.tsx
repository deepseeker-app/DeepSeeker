import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { IconLinkOutline14, IconRefreshOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DeepSeekBalance, DeepSeekBalanceErrorCode } from '../api.ts'
import { DeepSeekBalanceClientError, loadDeepSeekBalance } from './balance-client.ts'
import { NS, type DeepSeekBalanceKey } from './locales.ts'
import css from './DeepSeekBalanceCard.module.css'

const REFRESH_MS = 60_000
const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export interface DeepSeekBalanceInjected {
  expandSidebar: () => void
}

export type DeepSeekBalanceCardProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>
  & DeepSeekBalanceInjected

function errorKey(code: DeepSeekBalanceErrorCode): DeepSeekBalanceKey {
  return `error.${code}`
}

function formatMoney(balance: DeepSeekBalance, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: balance.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(balance.totalBalance)
}

function formatPart(value: number, currency: DeepSeekBalance['currency'], locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

/** Sidebar balance card. Remote data and refresh lifecycle stay component-local. */
export function DeepSeekBalanceCard({ wide, expandSidebar, t }: DeepSeekBalanceCardProps) {
  const [balance, setBalance] = useState<DeepSeekBalance>()
  const [error, setError] = useState<DeepSeekBalanceErrorCode>()
  const [loading, setLoading] = useState(true)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const request = useRef<AbortController>()
  const locale = document.documentElement.lang.startsWith('en') ? 'en-US' : 'zh-CN'
  const closeTopUp = useCallback(() => { setTopUpOpen(false) }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (request.current !== undefined) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    try {
      setBalance(await loadDeepSeekBalance(controller.signal))
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof DeepSeekBalanceClientError ? caught.code : 'unavailable')
      }
    } finally {
      if (request.current === controller) request.current = undefined
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => {
      window.clearInterval(interval)
      request.current?.abort()
      request.current = undefined
    }
  }, [refresh])

  if (!wide) {
    return (
      <button type="button" className={css.rail} onClick={expandSidebar} aria-label={t('rail')} title={t('rail')}>
        <span aria-hidden>¥</span>
      </button>
    )
  }

  const low = balance !== undefined && balance.isAvailable
    && balance.totalBalance < (balance.currency === 'CNY' ? 10 : 2)
  const status = balance === undefined
    ? undefined
    : !balance.isAvailable
      ? t('notAvailable')
      : low ? t('low') : t('available')
  const updated = balance === undefined
    ? undefined
    : t('updated', { time: new Date(balance.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })

  return (
    <section className={css.card} aria-label={t('title')} data-low={low ? 'true' : undefined}>
      <div className={css.heading}>
        <span>{t('title')}</span>
        {status !== undefined && <span className={low ? css.warning : css.status}>{status}</span>}
      </div>

      {balance !== undefined ? (
        <>
          <strong className={css.total}>{formatMoney(balance, locale)}</strong>
          <dl className={css.breakdown}>
            <div><dt>{t('toppedUp')}</dt><dd>{formatPart(balance.toppedUpBalance, balance.currency, locale)}</dd></div>
            <div><dt>{t('granted')}</dt><dd>{formatPart(balance.grantedBalance, balance.currency, locale)}</dd></div>
          </dl>
        </>
      ) : (
        <p className={css.placeholder}>{error === undefined ? t('loading') : t(errorKey(error))}</p>
      )}

      {balance !== undefined && error !== undefined && <p className={css.error} role="alert">{t(errorKey(error))}</p>}

      <div className={css.actions}>
        <button type="button" className={css.topUp} onClick={() => { setTopUpOpen(true) }}>
          <IconLinkOutline14 />
          {t('topUp')}
        </button>
        <button
          type="button"
          className={css.refresh}
          onClick={() => { void refresh() }}
          disabled={loading}
          aria-label={t('refresh')}
          title={t('refresh')}
        >
          <IconRefreshOutline14 className={loading ? css.spinning : undefined} />
        </button>
      </div>
      {updated !== undefined && <span className={css.updated}>{updated}</span>}

      <Modal
        open={topUpOpen}
        onClose={closeTopUp}
        title={t('topUpTitle')}
        closeLabel={t('close')}
        description={t('topUpDescription')}
        className={css.topUpDialog ?? ''}
      >
        <div className={css.topUpBody}>
          <div className={css.qrFrame} role="img" aria-label={t('qrLabel')}>
            <QRCodeSVG value={TOP_UP_URL} size={184} level="M" marginSize={0} />
          </div>
          <strong className={css.qrHeading}>{t('scanTopUp')}</strong>
          <p className={css.topUpNote}>{t('topUpNote')}</p>
          <a className={css.openTopUp} href={TOP_UP_URL} target="_blank" rel="noreferrer">
            <IconLinkOutline14 />
            {t('openTopUp')}
          </a>
        </div>
      </Modal>
    </section>
  )
}
