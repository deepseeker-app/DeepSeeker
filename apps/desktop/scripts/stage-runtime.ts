/** Materialize the packaged desktop Host dependency closure. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const staging = join(desktopRoot, 'runtime-host')
const deployRoot = resolve(desktopRoot, 'runtime')
const deployPackage = '@deepseek-ai/dsh-desktop-runtime'
const entry = join(staging, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const frontend = join(staging, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
const workspaceState = join(repositoryRoot, 'node_modules/.pnpm-workspace-state-v1.json')

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

export interface PackageManagerInvocation {
  readonly command: string
  readonly args: readonly string[]
}

/** Build a pnpm invocation that does not ask Node to spawn a Windows command shim directly. */
export function packageManagerInvocation(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  commandProcessor: string | undefined = process.env.ComSpec,
): PackageManagerInvocation {
  if (platform !== 'win32') return { command: 'pnpm', args }
  return {
    command: commandProcessor || 'cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm.cmd', ...args],
  }
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) accept()
      else reject(new Error(`desktop runtime staging failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}): ${command} ${args.join(' ')}`))
    })
  })
}

async function runPackageManager(args: readonly string[]): Promise<void> {
  const invocation = packageManagerInvocation(args)
  await run(invocation.command, invocation.args)
}

async function manifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(path, 'utf8')) as Manifest
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/**
 * Replace dependency links with copied directories without following links during removal.
 * @param nodeModules - Staged node_modules directory to materialize.
 * @returns Completion after no dependency links remain.
 */
export async function materializeLinks(nodeModules: string): Promise<void> {
  for (let link = await findSymlink(nodeModules); link !== undefined; link = await findSymlink(nodeModules)) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const bin = segments.lastIndexOf('.bin')
    if (bin >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, bin + 1)), { recursive: true, force: true })
      continue
    }
    const source = await realpath(link)
    await unlink(link)
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
    })
  }
}

/**
 * Remove macOS AppleDouble sidecars copied from an external-volume workspace.
 * @param directory - Materialized runtime directory to clean recursively.
 * @returns Completion after every sidecar below the directory is absent.
 */
export async function removeAppleDouble(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name.startsWith('._')) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) await removeAppleDouble(path)
  }
}

async function restoreLegacyHoists(): Promise<void> {
  const deployed = await manifest(join(staging, 'package.json'))
  const sourceModules = join(deployRoot, 'node_modules')
  for (const dependency of Object.keys(deployed.dependencies ?? {})) {
    const destination = join(staging, 'node_modules', dependency)
    if (existsSync(destination)) continue
    const source = join(sourceModules, dependency)
    if (!existsSync(source)) throw new Error(`desktop runtime dependency is missing after deploy: ${dependency}`)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
    })
  }
}

async function deploy(): Promise<void> {
  const savedWorkspaceState = existsSync(workspaceState) ? await readFile(workspaceState) : undefined
  const failures: unknown[] = []
  try {
    await runPackageManager([
      '--config.verify-deps-before-run=false', '--config.allow-unused-patches=true',
      '--filter', deployPackage, 'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true', staging,
    ])
  } catch (cause) {
    failures.push(cause)
  }
  try {
    if (savedWorkspaceState === undefined) await rm(workspaceState, { force: true })
    else await writeFile(workspaceState, savedWorkspaceState)
  } catch (cause) {
    failures.push(cause)
  }
  try {
    // Legacy deploy temporarily rewrites the active hoist layout; relink every source importer before returning.
    await runPackageManager(['install', '--frozen-lockfile'])
  } catch (cause) {
    failures.push(cause)
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'desktop runtime deploy or workspace restoration failed')
}

async function main(): Promise<void> {
  await run(process.execPath, [
    '--import', 'tsx', 'scripts/verify-runtime-closure.ts',
    '--manifest', 'apps/desktop/runtime/package.json',
  ])
  await rm(staging, { recursive: true, force: true })
  await deploy()
  await restoreLegacyHoists()
  await materializeLinks(join(staging, 'node_modules'))
  await removeAppleDouble(staging)
  if (!existsSync(entry)) throw new Error(`desktop Host entry missing after staging: ${entry}`)
  if (!existsSync(frontend)) throw new Error(`desktop Web frontend missing after staging: ${frontend}`)
  console.log(`desktop runtime staged at ${staging}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main()
}
