/** Build an unsigned desktop artifact without writing an app bundle to an external volume. */

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function run(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function findMacApp(outputRoot: string): string {
  for (const directory of readdirSync(outputRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const directoryPath = join(outputRoot, directory.name)
    if (directory.name.endsWith('.app')) return directoryPath
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('.app')) return join(directoryPath, entry.name)
    }
  }
  throw new Error(`Electron Builder did not produce a macOS app under ${outputRoot}`)
}

/** Build the current platform package, using internal temporary storage for macOS app assembly. */
export function packageDesktop(): void {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.platform !== 'darwin') {
    run('pnpm', ['exec', 'electron-builder', '--dir'], desktopRoot)
    return
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'deepseeker-package.'))
  const builderOutput = join(temporaryRoot, 'builder')
  const artifactDirectory = join(desktopRoot, 'dist')
  const artifactName = `DeepSeeker-mac-${process.arch}.zip`
  const temporaryArchive = join(temporaryRoot, artifactName)
  const artifactPath = join(artifactDirectory, artifactName)

  try {
    mkdirSync(builderOutput)
    run('pnpm', [
      'exec', 'electron-builder', '--dir',
      `--config.directories.output=${builderOutput}`,
    ], desktopRoot)
    const appPath = findMacApp(builderOutput)
    run('ditto', ['-c', '-k', '--norsrc', '--keepParent', appPath, temporaryArchive], desktopRoot)
    run('unzip', ['-tq', temporaryArchive], desktopRoot)
    mkdirSync(artifactDirectory, { recursive: true })
    rmSync(artifactPath, { force: true })
    copyFileSync(temporaryArchive, artifactPath)
    const megabytes = (statSync(artifactPath).size / 1_048_576).toFixed(1)
    console.log(`Unsigned package ready: ${artifactPath} (${megabytes} MB, contains ${basename(appPath)})`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageDesktop()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
