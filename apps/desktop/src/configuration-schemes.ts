/** Desktop-owned configuration schemes with isolated Harness homes. */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const STATE_VERSION = 1
const DEFAULT_SCHEME_ID = 'default'
const DEFAULT_SCHEME_LABEL = '默认'
const STORE_DIRECTORY = 'configuration-schemes'
const STATE_FILENAME = 'state.json'
const METADATA_FILENAME = 'metadata.json'
const HARNESS_HOME_DIRECTORY = 'dsh-home'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const MAX_STATE_BYTES = 64 * 1024
const MAX_LABEL_LENGTH = 40
const SCHEME_ID_PATTERN = /^scheme-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** One user-visible configuration scheme. */
export interface ConfigurationScheme {
  /** Stable private identifier, never shown as the scheme name. */
  readonly id: string
  /** User-controlled display name. */
  readonly label: string
  /** Harness home containing this scheme's settings, credentials and sessions. */
  readonly harnessHome: string
  /** The built-in scheme reuses the user's ordinary Harness home. */
  readonly builtIn: boolean
}

interface StoredScheme {
  readonly id: string
  readonly label: string
}

/** Private selection state persisted by the desktop shell. */
export interface ConfigurationSchemeState {
  readonly version: 1
  readonly active: string
  readonly lastKnownGood: string
  readonly pending?: string
  readonly schemes: readonly StoredScheme[]
}

/** Startup decision made before the loopback Host is spawned. */
export interface ConfigurationSchemeStartup {
  readonly scheme: ConfigurationScheme
  readonly state: ConfigurationSchemeState
  readonly recoveredState: boolean
  readonly rolledBackFrom?: string
}

interface LoadedState {
  readonly state: ConfigurationSchemeState
  readonly recovered: boolean
}

function storeDirectory(userDataPath: string): string {
  return join(resolve(userDataPath), STORE_DIRECTORY)
}

function statePath(userDataPath: string): string {
  return join(storeDirectory(userDataPath), STATE_FILENAME)
}

function schemeDirectory(userDataPath: string, id: string): string {
  assertSchemeId(id)
  if (id === DEFAULT_SCHEME_ID) throw new Error('the built-in configuration scheme has no private directory')
  return join(storeDirectory(userDataPath), id)
}

function metadataPath(userDataPath: string, id: string): string {
  return join(schemeDirectory(userDataPath, id), METADATA_FILENAME)
}

function defaultHarnessHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.DSH_HOME?.trim()
  return resolve(configured === undefined || configured === '' ? join(homedir(), '.dsh') : configured)
}

function harnessHome(userDataPath: string, id: string, environment: NodeJS.ProcessEnv = process.env): string {
  return id === DEFAULT_SCHEME_ID
    ? defaultHarnessHome(environment)
    : join(schemeDirectory(userDataPath, id), HARNESS_HOME_DIRECTORY)
}

function assertSchemeId(id: string): void {
  if (id !== DEFAULT_SCHEME_ID && !SCHEME_ID_PATTERN.test(id)) {
    throw new Error(`invalid configuration scheme identifier: ${JSON.stringify(id)}`)
  }
}

/** Normalize and validate one user-visible scheme name. */
export function normalizeConfigurationSchemeLabel(input: string): string {
  if (/[\0-\x1f\x7f]/u.test(input)) {
    throw new Error(`配置方案名称应为 1-${String(MAX_LABEL_LENGTH)} 个字符，且不能包含控制字符。`)
  }
  const label = input.trim().replace(/\s+/gu, ' ')
  if (label === '' || label.length > MAX_LABEL_LENGTH) {
    throw new Error(`配置方案名称应为 1-${String(MAX_LABEL_LENGTH)} 个字符，且不能包含控制字符。`)
  }
  return label
}

function defaultState(discovered: readonly StoredScheme[] = []): ConfigurationSchemeState {
  return {
    version: STATE_VERSION,
    active: DEFAULT_SCHEME_ID,
    lastKnownGood: DEFAULT_SCHEME_ID,
    schemes: [...discovered],
  }
}

function parseMetadata(text: string, expectedId: string): StoredScheme | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const metadata = value as Record<string, unknown>
    if (metadata.id !== expectedId || typeof metadata.label !== 'string') return undefined
    return { id: expectedId, label: normalizeConfigurationSchemeLabel(metadata.label) }
  } catch {
    return undefined
  }
}

/** Recover user-created schemes from their private per-scheme metadata. */
function discoverSchemes(userDataPath: string): StoredScheme[] {
  const root = storeDirectory(userDataPath)
  const discovered: StoredScheme[] = []
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SCHEME_ID_PATTERN.test(entry.name)) continue
      const path = metadataPath(userDataPath, entry.name)
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) continue
      const metadata = parseMetadata(readFileSync(path, 'utf8'), entry.name)
      if (metadata !== undefined) discovered.push(metadata)
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  return discovered.sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

function parseState(text: string, discovered: readonly StoredScheme[]): ConfigurationSchemeState {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('state must be an object')
  const state = value as Record<string, unknown>
  if (state.version !== STATE_VERSION
    || typeof state.active !== 'string'
    || typeof state.lastKnownGood !== 'string'
    || (state.pending !== undefined && typeof state.pending !== 'string')
    || !Array.isArray(state.schemes)) {
    throw new Error('state fields are invalid')
  }
  assertSchemeId(state.active)
  assertSchemeId(state.lastKnownGood)
  if (state.pending !== undefined) assertSchemeId(state.pending)

  const records = new Map<string, StoredScheme>()
  for (const item of state.schemes) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('scheme entry is invalid')
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') throw new Error('scheme entry is invalid')
    assertSchemeId(candidate.id)
    if (candidate.id === DEFAULT_SCHEME_ID || records.has(candidate.id)) throw new Error('scheme entry is duplicated')
    records.set(candidate.id, { id: candidate.id, label: normalizeConfigurationSchemeLabel(candidate.label) })
  }
  for (const metadata of discovered) records.set(metadata.id, metadata)
  return {
    version: STATE_VERSION,
    active: state.active,
    lastKnownGood: state.lastKnownGood,
    ...(state.pending === undefined ? {} : { pending: state.pending }),
    schemes: [...records.values()],
  }
}

function loadState(userDataPath: string): LoadedState {
  const path = statePath(userDataPath)
  const discovered = discoverSchemes(userDataPath)
  let text: string
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_STATE_BYTES) {
      return { state: defaultState(discovered), recovered: true }
    }
    text = readFileSync(path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: defaultState(discovered), recovered: discovered.length > 0 }
    }
    throw cause
  }
  try {
    return { state: parseState(text, discovered), recovered: false }
  } catch {
    return { state: defaultState(discovered), recovered: true }
  }
}

function unlinkIfPresent(filename: string): void {
  try {
    unlinkSync(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}

function writePrivateJson(filename: string, value: unknown): void {
  const directory = dirname(filename)
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`private configuration path is unsafe: ${directory}`)
  chmodSync(directory, PRIVATE_DIRECTORY_MODE)
  const temporary = join(directory, `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    })
    chmodSync(temporary, PRIVATE_FILE_MODE)
    renameSync(temporary, filename)
  } finally {
    unlinkIfPresent(temporary)
  }
}

function writeState(userDataPath: string, state: ConfigurationSchemeState): void {
  writePrivateJson(statePath(userDataPath), state)
}

function hasScheme(state: ConfigurationSchemeState, id: string): boolean {
  return id === DEFAULT_SCHEME_ID || state.schemes.some(scheme => scheme.id === id)
}

function schemeFromState(
  userDataPath: string,
  state: ConfigurationSchemeState,
  id: string,
  environment: NodeJS.ProcessEnv = process.env,
): ConfigurationScheme {
  assertSchemeId(id)
  if (id === DEFAULT_SCHEME_ID) {
    return {
      id,
      label: DEFAULT_SCHEME_LABEL,
      harnessHome: harnessHome(userDataPath, id, environment),
      builtIn: true,
    }
  }
  const record = state.schemes.find(scheme => scheme.id === id)
  if (record === undefined) throw new Error(`配置方案不存在：${id}`)
  return {
    ...record,
    harnessHome: harnessHome(userDataPath, id, environment),
    builtIn: false,
  }
}

/** List the built-in and user-created schemes without changing selection. */
export function listConfigurationSchemes(
  userDataPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): readonly ConfigurationScheme[] {
  const state = loadState(userDataPath).state
  return [
    schemeFromState(userDataPath, state, DEFAULT_SCHEME_ID, environment),
    ...state.schemes.map(scheme => schemeFromState(userDataPath, state, scheme.id, environment)),
  ]
}

/** Read the selected scheme while recovering malformed private state. */
export function readConfigurationSchemeState(userDataPath: string): ConfigurationSchemeState {
  return loadState(userDataPath).state
}

/** Consume a pending selection, rolling invalid or unconfirmed state back before Host startup. */
export function beginConfigurationSchemeStartup(
  userDataPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): ConfigurationSchemeStartup {
  const loaded = loadState(userDataPath)
  const current = loaded.state
  let recoveredState = loaded.recovered
  let rolledBackFrom: string | undefined
  const lastKnownGood = hasScheme(current, current.lastKnownGood)
    ? current.lastKnownGood
    : DEFAULT_SCHEME_ID
  let selected = current.pending ?? current.active
  if (current.pending === undefined && current.active !== lastKnownGood) {
    rolledBackFrom = current.active
    selected = lastKnownGood
    recoveredState = true
  } else if (!hasScheme(current, selected)) {
    rolledBackFrom = selected
    selected = lastKnownGood
    recoveredState = true
  }
  const next: ConfigurationSchemeState = {
    version: STATE_VERSION,
    active: selected,
    lastKnownGood,
    schemes: current.schemes,
  }
  writeState(userDataPath, next)
  return {
    scheme: schemeFromState(userDataPath, next, selected, environment),
    state: next,
    recoveredState,
    ...(rolledBackFrom === undefined ? {} : { rolledBackFrom }),
  }
}

/** Persist a validated selection for the next Electron launch. */
export function requestConfigurationSchemeSwitch(userDataPath: string, id: string): ConfigurationSchemeState {
  const current = loadState(userDataPath).state
  if (!hasScheme(current, id)) throw new Error('要切换的配置方案不存在。')
  const { pending: _pending, ...settled } = current
  const next: ConfigurationSchemeState = current.active === id && current.lastKnownGood === id
    ? settled
    : { ...current, pending: id }
  writeState(userDataPath, next)
  return next
}

/** Promote the running scheme only after its loopback Host reaches readiness. */
export function markConfigurationSchemeHealthy(userDataPath: string, id: string): ConfigurationSchemeState {
  const current = loadState(userDataPath).state
  if (current.active !== id || !hasScheme(current, id)) throw new Error('无法确认未运行的配置方案。')
  const next: ConfigurationSchemeState = {
    version: STATE_VERSION,
    active: id,
    lastKnownGood: id,
    schemes: current.schemes,
  }
  writeState(userDataPath, next)
  return next
}

/** Restore selection state after a candidate Host fails before readiness. */
export function markConfigurationSchemeFailed(userDataPath: string, id: string): ConfigurationSchemeState {
  const current = loadState(userDataPath).state
  if (current.active !== id) throw new Error('无法回退未运行的配置方案。')
  const fallback = hasScheme(current, current.lastKnownGood)
    ? current.lastKnownGood
    : DEFAULT_SCHEME_ID
  const next: ConfigurationSchemeState = {
    version: STATE_VERSION,
    active: fallback,
    lastKnownGood: fallback,
    schemes: current.schemes,
  }
  writeState(userDataPath, next)
  return next
}

/** Create an isolated scheme without selecting it. */
export function createConfigurationScheme(userDataPath: string, input: string): ConfigurationScheme {
  const label = normalizeConfigurationSchemeLabel(input)
  const current = loadState(userDataPath).state
  const labels = [DEFAULT_SCHEME_LABEL, ...current.schemes.map(scheme => scheme.label)]
  if (labels.some(existing => existing.localeCompare(label, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
    throw new Error(`已经有一个叫“${label}”的配置方案。`)
  }
  const id = `scheme-${randomUUID()}`
  const root = storeDirectory(userDataPath)
  mkdirSync(root, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const rootStat = lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('配置方案目录不安全。')
  chmodSync(root, PRIVATE_DIRECTORY_MODE)
  const directory = schemeDirectory(userDataPath, id)
  mkdirSync(directory, { recursive: false, mode: PRIVATE_DIRECTORY_MODE })
  try {
    mkdirSync(harnessHome(userDataPath, id), { mode: PRIVATE_DIRECTORY_MODE })
    writePrivateJson(metadataPath(userDataPath, id), { version: 1, id, label })
    const next: ConfigurationSchemeState = {
      ...current,
      schemes: [...current.schemes, { id, label }],
    }
    writeState(userDataPath, next)
    return schemeFromState(userDataPath, next, id)
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true })
    throw cause
  }
}

/** Remove a just-created scheme that never became active or pending. */
export function discardNewConfigurationScheme(userDataPath: string, id: string): void {
  const current = loadState(userDataPath).state
  const exists = current.schemes.some(scheme => scheme.id === id)
  if (!exists || current.active === id || current.pending === id || current.lastKnownGood === id) {
    throw new Error('只能清理尚未使用的新配置方案。')
  }
  const next: ConfigurationSchemeState = {
    ...current,
    schemes: current.schemes.filter(scheme => scheme.id !== id),
  }
  writeState(userDataPath, next)
  rmSync(schemeDirectory(userDataPath, id), { recursive: true, force: true })
}

/** Permanently delete one inactive user-created scheme and its private Harness home. */
export function deleteConfigurationScheme(userDataPath: string, id: string): void {
  const current = loadState(userDataPath).state
  if (id === DEFAULT_SCHEME_ID) throw new Error('内置默认方案不能删除。')
  const record = current.schemes.find(scheme => scheme.id === id)
  if (record === undefined) throw new Error('配置方案不存在。')
  if (current.active === id || current.lastKnownGood === id) {
    throw new Error('当前正在使用的配置方案不能删除。请先切换到其他方案。')
  }
  if (current.pending === id) throw new Error('待切换的配置方案不能删除。')

  const directory = schemeDirectory(userDataPath, id)
  let stat
  try {
    stat = lstatSync(directory)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  if (stat !== undefined && (!stat.isDirectory() || stat.isSymbolicLink())) {
    throw new Error('配置方案目录不安全，已停止删除。')
  }

  const next: ConfigurationSchemeState = {
    ...current,
    schemes: current.schemes.filter(scheme => scheme.id !== id),
  }
  if (stat === undefined) {
    writeState(userDataPath, next)
    return
  }

  const tombstone = join(storeDirectory(userDataPath), `.deleted-${id}-${randomUUID()}`)
  renameSync(directory, tombstone)
  try {
    writeState(userDataPath, next)
  } catch (cause) {
    renameSync(tombstone, directory)
    throw cause
  }
  rmSync(tombstone, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

/** Rename one user-created scheme without disturbing its Harness data. */
export function renameConfigurationScheme(userDataPath: string, id: string, input: string): ConfigurationScheme {
  const label = normalizeConfigurationSchemeLabel(input)
  const current = loadState(userDataPath).state
  const record = current.schemes.find(scheme => scheme.id === id)
  if (record === undefined) throw new Error('内置默认方案不能重命名。')
  if ([DEFAULT_SCHEME_LABEL, ...current.schemes.filter(scheme => scheme.id !== id).map(scheme => scheme.label)]
    .some(existing => existing.localeCompare(label, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
    throw new Error(`已经有一个叫“${label}”的配置方案。`)
  }
  const previousMetadata = { version: 1, id, label: record.label }
  writePrivateJson(metadataPath(userDataPath, id), { version: 1, id, label })
  try {
    const next: ConfigurationSchemeState = {
      ...current,
      schemes: current.schemes.map(scheme => scheme.id === id ? { id, label } : scheme),
    }
    writeState(userDataPath, next)
    return schemeFromState(userDataPath, next, id)
  } catch (cause) {
    writePrivateJson(metadataPath(userDataPath, id), previousMetadata)
    throw cause
  }
}
