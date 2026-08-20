import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

describe('DeepSeek balance browser plugin', () => {
  it('registers locale and a teardown-safe real sidebar slot contribution', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const toggleSidebar = vi.fn()
    const dictionaries = new Map<string, unknown>()
    ctx.provide('layout', { toggleSidebar } as never)
    ctx.provide('locale', {
      register: (namespace: string, value: unknown) => {
        dictionaries.set(namespace, value)
        return () => { dictionaries.delete(namespace) }
      },
    } as never)

    expect(inject).toEqual(['slots', 'layout', 'locale'])
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(dictionaries.get(NS)).toEqual({ zh, en })
    const entry = ctx.slots.entries('sidebar.footer.action')[0]!
    expect(entry.options).toMatchObject({ id: 'deepseek-balance', order: 10 })
    expect(entry.locale).toBe(NS)
    const injected = (entry.inject as () => { expandSidebar: () => void })()
    injected.expandSidebar()
    expect(toggleSidebar).toHaveBeenCalledOnce()

    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(dictionaries.has(NS)).toBe(false)
  })
})
