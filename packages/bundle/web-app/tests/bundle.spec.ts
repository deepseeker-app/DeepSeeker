/** The Web bundle manifest and patch own DeepSeeker's shipped browser roster. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const externalRows = [
  ['ui-web-ui-compat', '@linxin666/dsh-web-ui-all'],
  ['ui-web-ui-settings', '@linxin666/dsh-client-ui-web-ui-settings'],
  ['ui-dsh-aionui-panel', '@linxin666/dsh-client-ui-aionui-panel'],
  ['ui-task-board', '@linxin666/dsh-client-ui-task-board'],
  ['ui-git-graph', '@linxin666/dsh-client-ui-git-graph'],
  ['pet', '@linxin666/dsh-pet'],
  ['remote-web-ui', '@linxin666/dsh-remote-web-ui'],
  ['live-stats', '@linxin666/dsh-live-stats'],
  ['ssh', '@linxin666/dsh-ssh'],
  ['describe-image', '@linxin666/dsh-tool-describe-image'],
  ['ui-skin-center', '@linxin666/dsh-client-ui-skin-center'],
] as const

describe('dsh-web-app bundle', () => {
  it('pins and mounts the complete DeepSeeker feature suite', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-deepseek-balance']).toBe('workspace:^')
    expect(manifest.dependencies?.['@linxin666/dsh-web-ui-all']).toBe('0.1.12')
    expect(manifest.dependencies?.['@linxin666/dsh-tool-describe-image']).toBe('0.1.12')

    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('web-app patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Array<{
      id?: string
      name?: string
      config?: Record<string, unknown>
    }> =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Array<{
          id?: string
          name?: string
          config?: Record<string, unknown>
        }> }).insert ?? []
        : [],
    )
    const mounted = rows
      .filter(row => row.name?.startsWith('@linxin666/'))
      .map(row => [row.id, row.name])
    expect(mounted).toEqual(externalRows)
    expect(rows).toContainEqual({
      id: 'ui-deepseek-balance',
      name: '@deepseek-ai/dsh-client-ui-deepseek-balance',
    })
    expect(rows.find(row => row.id === 'connection')?.config).toMatchObject({
      requireRemoteAuthorization: true,
    })
    expect(rows.find(row => row.id === 'ssh')?.config).toEqual({ surface: 'host' })
    expect(rows.find(row => row.id === 'describe-image')?.config).toEqual({ surface: 'host' })
  })

  it('keeps the git graph dock registration inside one plugin lifecycle', () => {
    const clientBundle = readFileSync(
      fileURLToPath(import.meta.resolve('@linxin666/dsh-client-ui-git-graph/client')),
      'utf8',
    )
    const registrationStart = clientBundle.indexOf('//#region src/client/index.ts')
    const registrationEnd = clientBundle.indexOf('//#endregion', registrationStart)
    expect(registrationStart).toBeGreaterThanOrEqual(0)
    expect(registrationEnd).toBeGreaterThan(registrationStart)
    const registration = clientBundle.slice(registrationStart, registrationEnd)

    expect(registration).not.toContain('setTimeout(')
    expect(registration).not.toContain('conversation.input.selector.context')
    expect(registration.match(/scope\.slots\.inject\("conversation\.input\.dock"/g)).toHaveLength(1)
  })

  it('ships cross-tab shared event streams for every built-in SSE plugin', () => {
    const bundle = (specifier: string): string => readFileSync(
      fileURLToPath(import.meta.resolve(specifier)),
      'utf8',
    )
    const aion = bundle('@linxin666/dsh-client-ui-aionui-panel/client')
    const git = bundle('@linxin666/dsh-client-ui-git-graph/client')
    const taskBoard = bundle('@linxin666/dsh-client-ui-task-board/client')

    expect(aion).toContain('"sharedEventSource"')
    expect(aion).toContain('key: `aionui-panel:${root}`')
    expect(aion).toContain('eventName: "change"')
    expect(aion).toContain('subscribePanelEventsShared(ctx, root')

    expect(git).toContain('"sharedEventSource"')
    expect(git).toContain('key: `git:${path}`')
    expect(git).toContain('eventName: "change"')
    expect(git).toContain('subscribeChangesShared(ctx, resolved.path')

    expect(taskBoard).toContain('"sharedEventSource"')
    expect(taskBoard).toContain('key: "task-board"')
    expect(taskBoard).toContain('new HostTaskStore({ eventSource: taskBoardEventSource(ctx) })')
  })
})
