/**
 * Web shell boot kernel — the face consumed by the apps/web entry. Everything
 * here is machinery that cannot itself be a loader entry, and none of it
 * value-imports a plugin package (shell self-sufficiency rule: the
 * loading page must work while — especially when — plugins fail). The one
 * sanctioned exception is the modules package (bootstrap
 * identity): the module system cannot arrive through itself, so its class
 * and its client-half wrapper are shell-bundled and the kernel adopts its
 * plugin entry once cordis is up.
 *
 * AppWebEntry.run(), module face first, then plugin face: parse
 * `window.__DSH_BOOT__` into the two-view BootManifest (wire boundary)
 * → build the module system over the module-view rows → render the loading
 * page → prefetch every `immediately` row in parallel with mounting the
 * vendored cordis Loader (`internal` contract injection BEFORE any entry exists —
 * the bare-import fallback in tree.import must never run in a browser) →
 * await the prefetch tier, THEN adopt the modules entry and create one
 * loader entry per plugin-view row plus the shell-own app-shell assembly
 * entry → loader.await() + a full fiber sweep (all ACTIVE, else fail
 * listing who/what/which service) → flip the settled signal so AppRoot
 * switches to the real UI in one pass.
 *
 * Entry creation waits for the whole immediately tier: materialization runs
 * synchronous cross-package require edges (e.g. locale → runtime/client) that
 * fiber inject waiting cannot protect — a bundle's factory must be
 * registered before any dependent entry materializes. Per-row prefetch
 * failures still resolve silently (the create-side import reloads and
 * owns the loud failure), so the barrier never turns one bad bundle into a
 * boot-wide fail-fast.
 *
 * Composition lives in the host graph; the shell makes zero composition
 * decisions (the app-shell assembly is itself a graph entry, the only
 * shell-own module registered with the module system).
 */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRoot, type Root } from 'react-dom/client'
import * as ModulesClient from '@deepseek-ai/dsh-client-modules/client'
import {
  ClientModuleSystem, parseBootManifest,
  type BootManifest, type ClientModuleSystemOptions, type DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import * as AppShell from './app-shell.ts'
import { APP_SHELL_ID, type AppShellService } from './app-shell.ts'
import { AppRoot } from './AppRoot.tsx'
import { getStaticModules } from './seed.ts'
import { STATE_LABELS, createLoaderStatusStore, createSignal } from './loader-status.ts'
import './base.css'

/** Browser-location face used by the legacy pair-link redirect. */
export interface BootLocation {
  /** Current absolute page URL. */
  href: string
  /** Navigate without retaining the unpaired desktop page in history. */
  replace(url: string): void
}

/** Module transport and location hooks used by browser tests. */
export interface BootSeams extends Pick<ClientModuleSystemOptions, 'loadBundle'> {
  /** Optional location override for the pre-plugin pair redirect. */
  location?: BootLocation
  /** Test-only override for the local plugin activation deadline. */
  pluginBootTimeoutMs?: number
}

const DEFAULT_PLUGIN_BOOT_TIMEOUT_MS = 15_000

/** Bound plugin activation so one pending fiber cannot leave the shell spinning forever. */
export async function waitForPluginBoot(
  task: Promise<void>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(timeoutError()) }, timeoutMs)
  })
  try {
    await Promise.race([task, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Convert an old root pair link into the standalone mobile entry before the
 * desktop manifest or connection plugins start. New QR codes already target
 * `/m`; this keeps previously issued links from entering the desktop boot.
 */
export function legacyMobilePairRedirect(href: string): string | undefined {
  const url = new URL(href)
  if (url.pathname !== '/' || !url.searchParams.has('pair')) return undefined
  url.pathname = '/m'
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The modules package's own graph row id. The kernel adopts that entry
 * itself (its wrapper is statically registered — shell-bundled code, never
 * fetched), so the plugin-row loop must skip it: the vendored Group.create
 * does not deduplicate by name, and a second fiber would provide 'modules'
 * twice.
 */
const MODULES_ID = '@deepseek-ai/dsh-client-modules'

/**
 * The web shell kernel: mounts the loading page into a DOM element and runs
 * the two-stage boot over the host graph. Fields hold only what must exist
 * before cordis does — the parsed manifest, the module system, and the
 * loading-page UI handles; everything else lives in plugins.
 */
export class AppWebEntry {
  private readonly el: HTMLElement
  private readonly seams: BootSeams | undefined
  private readonly status = createLoaderStatusStore()
  private readonly settled = createSignal(false)
  private readonly error = createSignal<string | undefined>(undefined)
  private readonly appShell = createSignal<AppShellService | undefined>(undefined)
  // Assigned by run() before any private method or settled-gated closure reads them.
  private ctx!: Context
  private modules!: ClientModuleSystem
  private manifest!: BootManifest
  private root: Root | undefined

  /**
   * Hold the mount point; all work happens in {@link run}.
   * @param el - mount point (the app's #root).
   * @param seams - Optional module transport overrides for test environments.
   */
  constructor(el: HTMLElement, seams?: BootSeams) {
    this.el = el
    this.seams = seams
  }

  /**
   * Run the boot chain to settlement. Boot-chain failures resolve (not
   * reject): the loading page stays up and renders the failure report (the
   * fail-loud surface the kernel owns). Rejects only when the boot manifest
   * is missing or malformed — there is nothing to boot against.
   * @returns resolves once the UI settled or the failure report rendered.
   */
  async run(): Promise<void> {
    const location = this.seams?.location ?? window.location
    const redirect = legacyMobilePairRedirect(location.href)
    if (redirect !== undefined) {
      location.replace(redirect)
      return
    }

    this.manifest = parseBootManifest((globalThis as DshWindow).__DSH_BOOT__)

    const moduleSeams = this.seams?.loadBundle === undefined
      ? {}
      : { loadBundle: this.seams.loadBundle }
    this.modules = new ClientModuleSystem({
      modules: this.manifest.modules, staticModules: getStaticModules(), ...moduleSeams,
    })
    // The app-shell assembly is the only shell-own module: every other graph
    // row is a plugin bundle arriving through fetch.
    this.modules.registerStatic(APP_SHELL_ID, AppShell)
    // Adoption handoff, supply side: register the modules
    // package's own client half under its bare package name (= graph row id
    // = entry name — a suffixed key would miss the statics branch and
    // trigger a real fetch), and put the instance on the kernel slot the
    // wrapper's apply reads to provide ctx.modules.
    this.modules.registerStatic(MODULES_ID, ModulesClient)
    ;(globalThis as DshWindow).__DSH_MODULES__ = this.modules

    this.root = createRoot(this.el)
    this.root.render(
      <AppRoot
        settled={this.settled}
        status={this.status}
        error={this.error}
        appShell={this.appShell}
      />,
    )

    // The immediately tier prefetches in parallel with Loader mounting;
    // runPluginBoot awaits it before creating entries (see module comment:
    // cross-package synchronous require edges need every immediately-tier
    // factory registered before any materialization).
    const prefetching = this.prefetchImmediateTier()
    this.ctx = new Context()
    try {
      await this.runPluginBoot(prefetching)
      const appShell = this.ctx.get('appShell')
      if (appShell === undefined) {
        throw new Error('web boot: appShell service missing after settled')
      }
      this.appShell.set(appShell)
      this.settled.set(true)
    } catch (reason) {
      // Stay on the loading page; surface the sweep report (fail loud).
      console.error(reason)
      this.error.set(reason instanceof Error ? reason.message : String(reason))
    }
  }

  /** Unmount the shell (loading page or settled UI). */
  dispose(): void {
    this.root?.unmount()
  }

  /** Prefetch the immediately tier (factory registration only; failures defer to the import path). */
  private async prefetchImmediateTier(): Promise<void> {
    await Promise.all(this.manifest.plugins
      .filter(row => row.immediately)
      .map(row => this.modules.prefetch(row.id).catch(() => {
        // Import reloads and reports this loudly per entry; swallowing
        // here keeps one failing prefetch from masking the others.
      })))
  }

  /** Plugin face: mount the Loader, inject the `internal` contract, adopt modules, create the graph entries, settle, sweep. */
  private async runPluginBoot(prefetching: Promise<void>): Promise<void> {
    const ctx = this.ctx
    await ctx.plugin(Loader)
    const loader = ctx.loader
    // Inject the module system BEFORE any entry exists: tree.import falls back
    // to a bare dynamic import when internal is undefined, which in a browser
    // is a guaranteed loud failure — correct as a tripwire, never as a path.
    loader.internal = this.modules as never

    // Status projection: AppRoot displays fiber truth. Every internal/status
    // transition under an entry re-projects that entry's row from its ROOT
    // fiber (child plugin fibers share the same entry).
    ctx.on('internal/status', (fiber) => {
      const entry = fiber.entry
      if (entry === undefined || entry.fiber === undefined) return
      this.status.set(entry.options.name, STATE_LABELS[entry.fiber.state])
    })
    ctx.on('internal/service', (service, value) => {
      if (service !== 'appShell') return
      this.appShell.set(value as AppShellService | undefined)
    })

    // Barrier before any entry exists: entry creation materializes bundles,
    // and materialization runs synchronous cross-package require edges that
    // need every immediately-tier factory already registered (module
    // comment). Resolves even when individual prefetches failed.
    await prefetching

    // Adoption handoff, plugin side: the modules entry is created first —
    // its wrapper apply reads the kernel slot and provides ctx.modules (the
    // provide lives on the plugin face; see MODULES_ID for why the row loop
    // must then skip it).
    const rows = [MODULES_ID, ...this.manifest.plugins.map(row => row.id).filter(id => id !== MODULES_ID), APP_SHELL_ID]
    // Entry creation order carries no semantics (fiber inject waiting owns
    // activation order); creating concurrently lets non-prefetched bundle
    // loads parallelize. The app-shell assembly entry is appended by the
    // kernel: it is shell-own code (host graph rows are all plugin bundles),
    // and mounting the assembly is not a composition decision — it rides the
    // same entry lifecycle so the sweep and status cover it uniformly.
    const activation = (async () => {
      await Promise.all(rows.map(async (name) => {
        this.status.set(name, 'loading')
        const id = await loader.create({ name })
        // A failed import leaves the entry fiberless (Entry._init logs and
        // returns); project it as failed — no fiber means no status event.
        if (loader.resolve(id).fiber === undefined) {
          this.status.set(name, 'failed')
        }
      }))
      await loader.await()
    })()
    await waitForPluginBoot(
      activation,
      this.seams?.pluginBootTimeoutMs ?? DEFAULT_PLUGIN_BOOT_TIMEOUT_MS,
      () => this.pluginBootTimeoutError(),
    )
    this.assertEntriesActive()
  }

  /** Build the same fiber sweep report used after settlement while activation is still pending. */
  private pluginBootTimeoutError(): Error {
    try {
      this.assertEntriesActive()
    } catch (reason) {
      return reason instanceof Error ? reason : new Error(String(reason))
    }
    return new Error('web boot: plugin activation timed out')
  }

  /**
   * Sweep every loader entry after the tree quiesced: an entry without a
   * fiber failed its import; a fiber not ACTIVE is FAILED (apply threw) or
   * PENDING (a required service never arrived — cordis inject waiting has no
   * timeout, so this sweep is the fail-loud compensation).
   */
  private assertEntriesActive(): void {
    const ctx = this.ctx
    const failures: string[] = []
    for (const entry of ctx.loader.entries()) {
      const name = entry.options.name
      if (entry.fiber === undefined) {
        failures.push(entry._initTask === undefined
          ? `${name}: import failed (see console for the import error)`
          : `${name}: loading (import or startup still in progress)`)
        continue
      }
      const state = STATE_LABELS[entry.fiber.state]
      if (state === 'active') continue
      if (state === 'pending') {
        const missing = Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)
        failures.push(`${name}: pending (waiting for service${missing.length === 1 ? '' : 's'}: ${missing.join(', ') || 'unknown'})`)
      } else {
        failures.push(`${name}: ${state}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`web boot: ${String(failures.length)} entr${failures.length === 1 ? 'y' : 'ies'} did not activate\n${failures.join('\n')}`)
    }
  }
}
