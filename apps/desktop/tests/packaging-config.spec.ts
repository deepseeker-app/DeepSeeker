import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface DesktopPackage {
  readonly version: string
  readonly description: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly scripts: Readonly<Record<string, string>>
  readonly build: {
    readonly appId: string
    readonly productName: string
    readonly afterPack: string
    readonly asarUnpack: readonly string[]
    readonly electronDist: string
    readonly extraResources: readonly {
      readonly from: string
      readonly to: string
    }[]
    readonly mac: {
      readonly hardenedRuntime: boolean
      readonly icon: string
      readonly notarize: boolean
    }
    readonly win: {
      readonly icon: string
      readonly target: readonly {
        readonly target: string
        readonly arch: readonly string[]
      }[]
    }
    readonly nsis: {
      readonly oneClick: boolean
      readonly perMachine: boolean
      readonly allowToChangeInstallationDirectory: boolean
      readonly createDesktopShortcut: boolean
      readonly createStartMenuShortcut: boolean
      readonly shortcutName: string
      readonly artifactName: string
    }
  }
}

interface RootPackage {
  readonly scripts: Readonly<Record<string, string>>
}

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const workspaceConfiguration = readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
const builderPatch = readFileSync(resolve(repositoryRoot, 'patches/app-builder-lib@26.15.3.patch'), 'utf8')
const stageRuntime = readFileSync(resolve(desktopRoot, 'scripts/stage-runtime.ts'), 'utf8')
const packageDesktop = readFileSync(resolve(desktopRoot, 'scripts/package-desktop.ts'), 'utf8')
const windowsReleaseWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/release-windows.yml'),
  'utf8',
)
const pagesWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/deepseeker-pages.yml'),
  'utf8',
)
const upstreamE2eWorkflow = readFileSync(
  resolve(repositoryRoot, '.github/workflows/e2e.yml'),
  'utf8',
)
const siteApp = readFileSync(resolve(repositoryRoot, 'apps/site/src/App.jsx'), 'utf8')
const desktopPackage = JSON.parse(
  readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'),
) as DesktopPackage
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as RootPackage

describe('desktop packaging configuration', () => {
  it('ships the DeepSeeker product identity', () => {
    expect(desktopPackage.version).toBe('0.2.0')
    expect(desktopPackage.description).toBe('DeepSeeker desktop agent powered by DeepSeek Harness')
    expect(desktopPackage.build.appId).toBe('com.deepseeker.desktop')
    expect(desktopPackage.build.productName).toBe('DeepSeeker')
  })

  it('packages the installed Electron distribution', () => {
    expect(desktopPackage.build.electronDist).toBe('node_modules/electron/dist')
    expect(workspaceConfiguration).toContain("'app-builder-lib@26.15.3>@electron/get': '3.1.0'")
  })

  it('ships the native PTY and bundles the sandboxed xterm preload', () => {
    expect(desktopPackage.dependencies).toEqual(expect.objectContaining({
      'node-pty': '^1.1.0',
      '@xterm/xterm': '^6.0.0',
      '@xterm/addon-fit': '^0.11.0',
    }))
    expect(desktopPackage.build.asarUnpack).toContain('node_modules/node-pty/**/*')
    const buildConfig = readFileSync(resolve(desktopRoot, 'tsdown.config.ts'), 'utf8')
    expect(buildConfig).toContain("entry: { 'terminal-preload': 'lib/types/terminal-preload.js' }")
    expect(buildConfig).toContain("format: ['cjs']")
    expect(buildConfig).toContain("alwaysBundle: ['@xterm/addon-fit', '@xterm/xterm']")
  })

  it('maps the staged Host node_modules directory as the copy root', () => {
    expect(desktopPackage.build.extraResources).toEqual(expect.arrayContaining([
      { from: 'runtime-host/package.json', to: 'host/package.json' },
      { from: 'runtime-host/node_modules', to: 'host/node_modules' },
    ]))
    expect(desktopPackage.build.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(stageRuntime).toContain("'--config.allow-unused-patches=true'")
    const deploy = stageRuntime.indexOf("'--filter', deployPackage, 'deploy', '--legacy'")
    const restore = stageRuntime.indexOf("['install', '--frozen-lockfile']")
    expect(deploy).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(deploy)
  })

  it('unlocks the temporary signing Keychain with its own password', () => {
    expect(workspaceConfiguration).toContain(
      'app-builder-lib@26.15.3: patches/app-builder-lib@26.15.3.patch',
    )
    expect(builderPatch).toContain('cscPasswords, keychainPassword')
    expect(builderPatch).toContain('"-k", keychainPassword, keychainFile')
  })

  it('keeps the supplied image byte-for-byte and shares it across macOS and Windows', () => {
    const icon = readFileSync(resolve(desktopRoot, 'build/icon.png'))

    expect(createHash('sha256').update(icon).digest('hex'))
      .toBe('cb344c36152b51860406fe69cbcd1d63a44f22132b896310a3230584def7a4e7')
    expect(desktopPackage.build.mac.icon).toBe('build/icon.png')
    expect(desktopPackage.build.win.icon).toBe('build/icon.png')
  })

  it('builds and stages the complete workspace before local packaging', () => {
    for (const name of ['package', 'dist']) {
      expect(desktopPackage.scripts[name]).toContain('pnpm --workspace-root run build')
      expect(desktopPackage.scripts[name]).toContain('scripts/stage-runtime.ts')
      expect(desktopPackage.scripts[name]).toContain('scripts/ensure-electron-runtime.ts')
    }
    expect(desktopPackage.scripts.package).toContain('scripts/package-desktop.ts')
    expect(desktopPackage.scripts.package).not.toContain('release-preflight.ts')
  })

  it('assembles macOS app bundles on internal temporary storage and returns one ZIP artifact', () => {
    expect(packageDesktop).toContain("mkdtempSync(join(tmpdir(), 'deepseeker-package.')")
    expect(packageDesktop).toContain('`--config.directories.output=${builderOutput}`')
    expect(packageDesktop).toContain("'--config.mac.identity=null'")
    expect(packageDesktop).toContain("'--config.mac.notarize=false'")
    expect(packageDesktop).toContain("run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath]")
    expect(packageDesktop).toContain("run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]")
    expect(packageDesktop).toContain("'-c', '-k', '--norsrc', '--keepParent'")
    expect(packageDesktop).toContain("'--keepParent', appPath, temporaryArchive")
    expect(packageDesktop).toContain("run('unzip', ['-tq', temporaryArchive]")
    const staleArtifactCleanup = packageDesktop.indexOf('rmSync(artifactPath, { force: true })')
    expect(staleArtifactCleanup).toBeLessThan(packageDesktop.indexOf("run('pnpm', [", staleArtifactCleanup))
    const adHocSign = packageDesktop.indexOf("run('codesign', ['--force'")
    expect(adHocSign).toBeLessThan(packageDesktop.indexOf("run('ditto'", adHocSign))
    expect(packageDesktop).toContain('copyFileSync(temporaryArchive, artifactPath)')
    expect(packageDesktop).toContain('await sha256File(artifactPath)')
    expect(packageDesktop).toContain('`${artifactPath}.sha256`')
    expect(packageDesktop).toContain('`${checksum}  ${artifactName}\\n`')
    expect(stageRuntime).toContain('await removeAppleDouble(staging)')
  })

  it('makes the macOS DMG path signed, hardened, and notarized', () => {
    const command = desktopPackage.scripts['dist:mac']

    expect(command).toBe('node --import tsx scripts/release-mac.ts')
    expect(desktopPackage.build.mac.hardenedRuntime).toBe(true)
    expect(desktopPackage.build.mac.notarize).toBe(true)
  })

  it('exposes generic and macOS release commands at the repository root', () => {
    expect(rootPackage.scripts['dist:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist')
    expect(rootPackage.scripts['dist:mac:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist:mac')
    expect(rootPackage.scripts['dist:win:desktop'])
      .toBe('pnpm --filter @deepseek-ai/dsh-desktop run dist:win')
  })

  it('builds a stable-name per-user Windows NSIS installer', () => {
    expect(desktopPackage.build.win.target).toEqual([{
      target: 'nsis',
      arch: ['x64'],
    }])
    expect(desktopPackage.build.nsis).toEqual(expect.objectContaining({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'DeepSeeker',
      artifactName: 'DeepSeeker-windows-x64-setup.${ext}',
    }))
    expect(desktopPackage.scripts['dist:win']).toContain('scripts/stage-runtime.ts')
    expect(desktopPackage.scripts['dist:win']).toContain('electron-builder --win nsis --x64')
  })

  it('builds the verified NSIS artifact without release write credentials', () => {
    expect(windowsReleaseWorkflow).toContain('runs-on: windows-latest')
    expect(windowsReleaseWorkflow).toContain('permissions:\n  contents: read')
    expect(windowsReleaseWorkflow).toContain('persist-credentials: false')
    expect(windowsReleaseWorkflow).toContain("format('refs/tags/{0}', inputs.tag)")
    expect(windowsReleaseWorkflow).toContain('pnpm install --frozen-lockfile')
    expect(windowsReleaseWorkflow).toContain('pnpm run dist:win:desktop')
    expect(windowsReleaseWorkflow).toContain('$env:RELEASE_TAG -cne $expected')
    expect(windowsReleaseWorkflow).toContain('DeepSeeker-windows-x64-setup.exe')
    expect(windowsReleaseWorkflow).toContain('$peOffset = $reader.ReadUInt32()')
    expect(windowsReleaseWorkflow).toContain("throw 'Installer does not have a Windows PE signature'")
    expect(windowsReleaseWorkflow).toContain("Start-Process -FilePath $installer -ArgumentList @('/S', \"/D=$installDir\") -Wait -PassThru")
    expect(windowsReleaseWorkflow).toContain("$env:ELECTRON_RUN_AS_NODE = '1'")
    expect(windowsReleaseWorkflow).toContain('-RedirectStandardOutput $runtimeStdout -RedirectStandardError $runtimeStderr')
    expect(windowsReleaseWorkflow).not.toContain('$electronVersion = & $executable')
    expect(windowsReleaseWorkflow).toContain("Get-ChildItem $installDir -Filter 'Uninstall*.exe'")
    expect(windowsReleaseWorkflow).toContain("throw 'Silent uninstall left the installed application executable behind'")
    expect(windowsReleaseWorkflow).toContain('uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4')
  })

  it('grants release write access only after the verified artifact is downloaded', () => {
    expect(windowsReleaseWorkflow).toContain('release:\n    needs: build')
    expect(windowsReleaseWorkflow).toContain('permissions:\n      contents: write')
    expect(windowsReleaseWorkflow).toContain('uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4')
    expect(windowsReleaseWorkflow).toContain('working-directory: apps/desktop/dist')
    expect(windowsReleaseWorkflow).toContain("sed 's/\\r$//' DeepSeeker-windows-x64-setup.exe.sha256 | sha256sum --check -")
    expect(windowsReleaseWorkflow).toContain('uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3')
    expect(windowsReleaseWorkflow).toContain('tag_name: ${{ env.RELEASE_TAG }}')
    expect(windowsReleaseWorkflow).toContain('draft: true')
  })

  it('deploys Pages only for a complete matching desktop release', () => {
    expect(pagesWorkflow).toContain('workflow_dispatch:')
    expect(pagesWorkflow).toContain('uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4')
    expect(pagesWorkflow).toContain('persist-credentials: false')
    expect(pagesWorkflow).toContain('uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4')
    expect(pagesWorkflow).toContain('Refuse a site with incomplete download assets\n        env:\n          GH_TOKEN: ${{ github.token }}')
    expect(pagesWorkflow).not.toContain('runs-on: windows-2025\n    env:\n      GH_TOKEN:')
    expect(pagesWorkflow).toContain('$release.tag_name -cne $expectedTag')
    for (const name of [
      'DeepSeeker-mac-arm64.zip',
      'DeepSeeker-mac-arm64.zip.sha256',
      'DeepSeeker-windows-x64-setup.exe',
      'DeepSeeker-windows-x64-setup.exe.sha256',
    ]) {
      expect(pagesWorkflow).toContain(name)
    }
    expect(pagesWorkflow).toContain('Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath')
    expect(pagesWorkflow).toContain('Get-Content $checksumPath -Raw -Encoding ascii')
    expect(pagesWorkflow).toContain('$Matches[2] -cne $pair.Package')
    expect(pagesWorkflow).toContain('"sha256:$($Matches[1])" -ne $packageAsset.digest')
  })

  it('keeps the upstream real-API workflow off the public DeepSeeker main branch', () => {
    expect(upstreamE2eWorkflow.match(/branches: \[master\]/gu)).toHaveLength(2)
    expect(upstreamE2eWorkflow).not.toContain('branches: [main, master]')
    expect(upstreamE2eWorkflow).not.toContain('schedule:')
  })

  it('keeps website downloads on this repository latest release with stable artifact names', () => {
    expect(siteApp).toContain('const GITHUB_URL = "https://github.com/deepseeker-app/DeepSeeker"')
    expect(siteApp).toContain('`${GITHUB_URL}/releases/latest/download/DeepSeeker-mac-arm64.zip`')
    expect(siteApp).toContain('`${GITHUB_URL}/releases/latest/download/DeepSeeker-windows-x64-setup.exe`')
    expect(siteApp).not.toContain('/releases/download/')
  })

  it('pins every desktop release action to a reviewed commit while retaining its major tag', () => {
    for (const workflow of [windowsReleaseWorkflow, pagesWorkflow]) {
      const actions = workflow.split('\n').map(line => line.trim()).filter(line => /^(?:- )?uses:/u.test(line))
      expect(actions).toHaveLength(6)
      for (const action of actions) {
        expect(action).toMatch(/^(?:- )?uses: [^@\s]+@[0-9a-f]{40} # v[0-9]+$/u)
      }
    }
  })
})
