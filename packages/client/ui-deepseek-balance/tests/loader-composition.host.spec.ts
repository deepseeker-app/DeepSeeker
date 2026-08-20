import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import * as BalancePlugin from '../src/index.ts'

describe('DeepSeek balance real Loader composition', () => {
  it('boots behind credential and web-server services and owns its route', async () => {
    const ctx = new Context()
    await ctx.plugin(Loader)
    let route: WebRoute | undefined
    const modules = new Map<string, unknown>([
      ['test-web-server', {
        apply(serviceCtx: Context) {
          serviceCtx.provide('webServer', {
            register: (next: WebRoute) => {
              route = next
              return () => { route = undefined }
            },
          } as never)
        },
      }],
      ['test-credentials', {
        apply(serviceCtx: Context) {
          serviceCtx.provide('credentials', { resolve: async () => undefined } as never)
        },
      }],
      ['@deepseek-ai/dsh-client-ui-deepseek-balance', BalancePlugin],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    await ctx.loader.create({ name: 'test-web-server' })
    await ctx.loader.create({ name: 'test-credentials' })
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-ui-deepseek-balance' })
    await ctx.loader.await()
    expect(route).toMatchObject({ kind: 'exact', path: '/deepseeker/deepseek-balance' })

    await ctx.fiber.dispose()
    expect(route).toBeUndefined()
  })
})
