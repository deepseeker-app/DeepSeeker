import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginConfigurationSchemeStartup,
  createConfigurationScheme,
  deleteConfigurationScheme,
  discardNewConfigurationScheme,
  listConfigurationSchemes,
  markConfigurationSchemeFailed,
  markConfigurationSchemeHealthy,
  normalizeConfigurationSchemeLabel,
  readConfigurationSchemeState,
  renameConfigurationScheme,
  requestConfigurationSchemeSwitch,
} from '../src/configuration-schemes.ts'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseeker-schemes-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('configuration-scheme names and storage', () => {
  it('normalizes human names and rejects empty, long or controlled labels', () => {
    expect(normalizeConfigurationSchemeLabel('  我的   工作  ')).toBe('我的 工作')
    expect(() => normalizeConfigurationSchemeLabel('')).toThrow('1-40')
    expect(() => normalizeConfigurationSchemeLabel('x'.repeat(41))).toThrow('1-40')
    expect(() => normalizeConfigurationSchemeLabel('work\nunsafe')).toThrow('控制字符')
  })

  it('creates isolated Harness homes and preserves the ordinary home as default', () => {
    const userData = temporaryRoot()
    const ordinaryHome = join(temporaryRoot(), 'ordinary-dsh')
    const environment = { DSH_HOME: ordinaryHome }
    const created = createConfigurationScheme(userData, '工作')

    expect(created.label).toBe('工作')
    expect(created.builtIn).toBe(false)
    expect(created.harnessHome).toContain(join('configuration-schemes', created.id, 'dsh-home'))
    expect(existsSync(created.harnessHome)).toBe(true)
    expect(listConfigurationSchemes(userData, environment)).toEqual([
      expect.objectContaining({ id: 'default', label: '默认', harnessHome: ordinaryHome, builtIn: true }),
      expect.objectContaining({ id: created.id, label: '工作', builtIn: false }),
    ])
    expect(() => createConfigurationScheme(userData, '工作')).toThrow('已经有')

    const statePath = join(userData, 'configuration-schemes', 'state.json')
    const metadataPath = join(userData, 'configuration-schemes', created.id, 'metadata.json')
    expect(statSync(statePath).mode & 0o777).toBe(0o600)
    expect(statSync(metadataPath).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(userData, 'configuration-schemes')).isSymbolicLink()).toBe(false)
  })

  it('renames user schemes but keeps the built-in default fixed', () => {
    const userData = temporaryRoot()
    const created = createConfigurationScheme(userData, '个人')

    expect(renameConfigurationScheme(userData, created.id, '测试').label).toBe('测试')
    expect(listConfigurationSchemes(userData).map(scheme => scheme.label)).toEqual(['默认', '测试'])
    expect(() => renameConfigurationScheme(userData, 'default', '另一个默认')).toThrow('不能重命名')
  })

  it('deletes an inactive user scheme together with its private Harness home', () => {
    const userData = temporaryRoot()
    const created = createConfigurationScheme(userData, '临时')
    writeFileSync(join(created.harnessHome, 'private-data.json'), '{"secret":true}', 'utf8')

    deleteConfigurationScheme(userData, created.id)

    expect(listConfigurationSchemes(userData).map(scheme => scheme.id)).toEqual(['default'])
    expect(existsSync(join(userData, 'configuration-schemes', created.id))).toBe(false)
    expect(readConfigurationSchemeState(userData).schemes).toEqual([])
  })

  it('refuses to delete the default, active or pending scheme', () => {
    const userData = temporaryRoot()
    const active = createConfigurationScheme(userData, '工作')
    const pending = createConfigurationScheme(userData, '测试')

    expect(() => { deleteConfigurationScheme(userData, 'default') }).toThrow('默认方案不能删除')
    requestConfigurationSchemeSwitch(userData, active.id)
    beginConfigurationSchemeStartup(userData)
    markConfigurationSchemeHealthy(userData, active.id)
    expect(() => { deleteConfigurationScheme(userData, active.id) }).toThrow('正在使用')
    requestConfigurationSchemeSwitch(userData, pending.id)
    expect(() => { deleteConfigurationScheme(userData, pending.id) }).toThrow('待切换')
  })

  it('never follows a replaced scheme directory while deleting', () => {
    const userData = temporaryRoot()
    const outside = temporaryRoot()
    const marker = join(outside, 'keep.txt')
    writeFileSync(marker, 'keep', 'utf8')
    const created = createConfigurationScheme(userData, '可疑目录')
    const directory = join(userData, 'configuration-schemes', created.id)
    rmSync(directory, { recursive: true, force: true })
    symlinkSync(outside, directory, 'dir')

    expect(() => { deleteConfigurationScheme(userData, created.id) }).toThrow('目录不安全')
    expect(readFileSync(marker, 'utf8')).toBe('keep')
  })
})

describe('configuration-scheme startup safety', () => {
  it('switches only through pending state and promotes the scheme after readiness', () => {
    const userData = temporaryRoot()
    const work = createConfigurationScheme(userData, '工作')

    expect(requestConfigurationSchemeSwitch(userData, work.id)).toEqual(expect.objectContaining({
      active: 'default',
      pending: work.id,
      lastKnownGood: 'default',
    }))
    const startup = beginConfigurationSchemeStartup(userData)
    expect(startup.scheme.id).toBe(work.id)
    expect(startup.state).toEqual(expect.objectContaining({
      active: work.id,
      lastKnownGood: 'default',
    }))
    expect(startup.state.pending).toBeUndefined()

    expect(markConfigurationSchemeHealthy(userData, work.id)).toEqual(expect.objectContaining({
      active: work.id,
      lastKnownGood: work.id,
    }))
  })

  it('rolls a failed candidate back without deleting either scheme', () => {
    const userData = temporaryRoot()
    const work = createConfigurationScheme(userData, '工作')
    requestConfigurationSchemeSwitch(userData, work.id)
    beginConfigurationSchemeStartup(userData)

    expect(markConfigurationSchemeFailed(userData, work.id)).toEqual(expect.objectContaining({
      active: 'default',
      lastKnownGood: 'default',
    }))
    expect(listConfigurationSchemes(userData).map(scheme => scheme.id)).toContain(work.id)
  })

  it('rolls an unconfirmed candidate back on the launch after a crash', () => {
    const userData = temporaryRoot()
    const work = createConfigurationScheme(userData, '工作')
    requestConfigurationSchemeSwitch(userData, work.id)

    const crashedStartup = beginConfigurationSchemeStartup(userData)
    expect(crashedStartup.scheme.id).toBe(work.id)
    expect(crashedStartup.state).toEqual(expect.objectContaining({
      active: work.id,
      lastKnownGood: 'default',
    }))

    const recoveredStartup = beginConfigurationSchemeStartup(userData)
    expect(recoveredStartup.recoveredState).toBe(true)
    expect(recoveredStartup.rolledBackFrom).toBe(work.id)
    expect(recoveredStartup.scheme.id).toBe('default')
    expect(recoveredStartup.state.active).toBe('default')
    expect(recoveredStartup.state.lastKnownGood).toBe('default')
    expect(readConfigurationSchemeState(userData)).toEqual(expect.objectContaining({
      active: 'default',
      lastKnownGood: 'default',
    }))
  })

  it('repairs an unconfirmed active selection written by an older launch', () => {
    const userData = temporaryRoot()
    const work = createConfigurationScheme(userData, '工作')
    const statePath = join(userData, 'configuration-schemes', 'state.json')
    const current = readConfigurationSchemeState(userData)
    writeFileSync(statePath, `${JSON.stringify({
      ...current,
      active: work.id,
      lastKnownGood: 'default',
    })}\n`, 'utf8')

    const startup = beginConfigurationSchemeStartup(userData)

    expect(startup.recoveredState).toBe(true)
    expect(startup.rolledBackFrom).toBe(work.id)
    expect(startup.scheme.id).toBe('default')
    expect(readConfigurationSchemeState(userData)).toEqual(expect.objectContaining({
      active: 'default',
      lastKnownGood: 'default',
    }))
  })

  it('recovers corrupted selection state from per-scheme metadata', () => {
    const userData = temporaryRoot()
    const personal = createConfigurationScheme(userData, '个人')
    const statePath = join(userData, 'configuration-schemes', 'state.json')
    writeFileSync(statePath, '{broken', 'utf8')

    const startup = beginConfigurationSchemeStartup(userData)
    expect(startup.recoveredState).toBe(true)
    expect(startup.scheme.id).toBe('default')
    expect(listConfigurationSchemes(userData).map(scheme => scheme.id)).toContain(personal.id)
    expect(() => { JSON.parse(readFileSync(statePath, 'utf8')) }).not.toThrow()
  })

  it('cleans up only a newly created, unused scheme', () => {
    const userData = temporaryRoot()
    const scratch = createConfigurationScheme(userData, '临时')
    discardNewConfigurationScheme(userData, scratch.id)

    expect(listConfigurationSchemes(userData).map(scheme => scheme.id)).toEqual(['default'])
    expect(existsSync(join(userData, 'configuration-schemes', scratch.id))).toBe(false)
    expect(() => { discardNewConfigurationScheme(userData, 'default') }).toThrow('只能清理')
    expect(readConfigurationSchemeState(userData).active).toBe('default')
  })
})
