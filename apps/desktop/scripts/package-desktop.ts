/** Build a local desktop artifact without writing an app bundle to an external volume. */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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

async function sha256File(filename: string): Promise<string> {
  const digest = createHash('sha256')
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filename)
    stream.on('data', chunk => digest.update(chunk))
    stream.once('error', rejectPromise)
    stream.once('end', resolvePromise)
  })
  return digest.digest('hex')
}

/** Build the current platform package, including a verified ad-hoc signature on macOS. */
export async function packageDesktop(): Promise<void> {
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
  const checksumPath = `${artifactPath}.sha256`

  try {
    mkdirSync(artifactDirectory, { recursive: true })
    rmSync(artifactPath, { force: true })
    rmSync(checksumPath, { force: true })
    mkdirSync(builderOutput)
    run('pnpm', [
      'exec', 'electron-builder', '--dir',
      `--config.directories.output=${builderOutput}`,
      '--config.mac.identity=null',
      '--config.mac.notarize=false',
    ], desktopRoot)
    const appPath = findMacApp(builderOutput)
    run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath], desktopRoot)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], desktopRoot)
    run('ditto', ['-c', '-k', '--norsrc', '--keepParent', appPath, temporaryArchive], desktopRoot)
    run('unzip', ['-tq', temporaryArchive], desktopRoot)
    copyFileSync(temporaryArchive, artifactPath)
    const checksum = await sha256File(artifactPath)
    writeFileSync(checksumPath, `${checksum}  ${artifactName}\n`, { encoding: 'ascii', mode: 0o600 })
    const megabytes = (statSync(artifactPath).size / 1_048_576).toFixed(1)
    console.log(
      `Ad-hoc signed package ready: ${artifactPath} (${megabytes} MB, contains ${basename(appPath)}); checksum: ${checksumPath}`,
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  packageDesktop().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
