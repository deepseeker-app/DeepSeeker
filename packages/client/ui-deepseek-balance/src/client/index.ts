/** Browser half: locale dictionaries plus one additive sidebar footer action. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DeepSeekBalanceCard, type DeepSeekBalanceInjected } from './DeepSeekBalanceCard.tsx'
import { en, NS, zh, type DeepSeekBalanceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'deepseek-balance': DeepSeekBalanceKey
  }
}

export type { DeepSeekBalanceCardProps, DeepSeekBalanceInjected } from './DeepSeekBalanceCard.tsx'

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deepseek-balance: dictionaries')
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'deepseek-balance',
      order: 10,
      locale: NS,
      inject: (): DeepSeekBalanceInjected => ({
        expandSidebar: () => { ctx.layout.toggleSidebar() },
      }),
    }, DeepSeekBalanceCard))
}
