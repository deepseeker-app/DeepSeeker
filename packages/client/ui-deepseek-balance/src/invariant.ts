/** Package-owned invariant companion for the DeepSeek balance surface. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-deepseek-balance'

export const name = 'client-ui-deepseek-balance-invariant'
export const inject = ['invariants']

/** No runtime invariant: route uniqueness and slot ownership are enforced by their registries. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
