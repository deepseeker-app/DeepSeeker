/** Desktop runtime staging helpers. */

import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeLinks, packageManagerInvocation, removeAppleDouble } from '../scripts/stage-runtime.ts'

const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop runtime staging', () => {
  it('runs pnpm through the Windows command processor', () => {
    expect(packageManagerInvocation(['install', '--frozen-lockfile'], 'win32', 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', 'install', '--frozen-lockfile'],
    })
    expect(packageManagerInvocation(['deploy'], 'win32', '')).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', 'deploy'],
    })
  })

  it.each(['darwin', 'linux'] as const)('spawns pnpm directly on %s', (platform) => {
    expect(packageManagerInvocation(['install'], platform)).toEqual({ command: 'pnpm', args: ['install'] })
  })

  it('materializes a directory link without deleting or modifying its target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-stage-runtime-'))
    fixtures.push(root)
    const source = join(root, 'source-package')
    const nodeModules = join(root, 'staging', 'node_modules')
    const dependency = join(nodeModules, 'dependency')
    await mkdir(source, { recursive: true })
    await mkdir(nodeModules, { recursive: true })
    await writeFile(join(source, 'index.js'), 'source')
    await symlink(source, dependency, process.platform === 'win32' ? 'junction' : 'dir')

    await materializeLinks(nodeModules)
    await writeFile(join(dependency, 'index.js'), 'materialized')

    expect((await lstat(dependency)).isSymbolicLink()).toBe(false)
    expect(await readFile(join(dependency, 'index.js'), 'utf8')).toBe('materialized')
    expect(await readFile(join(source, 'index.js'), 'utf8')).toBe('source')
  })

  it('removes nested AppleDouble sidecars without deleting ordinary dotfiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-stage-runtime-'))
    fixtures.push(root)
    await mkdir(join(root, 'package', '._metadata'), { recursive: true })
    await writeFile(join(root, '._package.json'), 'sidecar')
    await writeFile(join(root, 'package', '._client.js'), 'sidecar')
    await writeFile(join(root, 'package', '._metadata', 'part'), 'sidecar')
    await writeFile(join(root, 'package', '.env'), 'kept')
    await writeFile(join(root, 'package', 'client.js'), 'kept')

    await removeAppleDouble(root)

    expect(await readdir(root)).toEqual(['package'])
    expect((await readdir(join(root, 'package'))).sort()).toEqual(['.env', 'client.js'])
    expect(await readFile(join(root, 'package', '.env'), 'utf8')).toBe('kept')
  })
})
