// A paired non-loopback browser can acknowledge onboarding through the same
// authenticated API path the phone workbench uses.
import type { Browser, BrowserContext, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    const loopbackUrl = new URL(scaffold.baseUrl)
    loopbackUrl.hostname = '127.0.0.1'
    const issueResponse = await context.request.post(`${loopbackUrl.origin}/api/pair/issue`, { data: {} })
    expect(issueResponse.status()).toBe(200)
    const issued: unknown = await issueResponse.json()
    if (typeof issued !== 'object' || issued === null || !('ok' in issued) || issued.ok !== true
      || !('token' in issued) || typeof issued.token !== 'string') {
      throw new Error('pair token missing')
    }
    expect(issued.ok).toBe(true)
    const acceptResponse = await context.request.post(`${scaffold.baseUrl}/api/pair/accept`, {
      data: { token: issued.token },
    })
    expect(acceptResponse.status()).toBe(200)
    expect(await acceptResponse.json()).toMatchObject({ ok: true })
    expect(await context.cookies(scaffold.baseUrl)).toContainEqual(expect.objectContaining({
      name: 'dsh_pair',
      httpOnly: true,
    }))

    page = await context.newPage()
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await context?.close()
    await browser?.close()
    await scaffold?.close()
  })

  it('persists the acknowledgement through a paired remote session', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-remote-welcome'))
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await page.locator('html[data-dsh-app-ready="true"]').waitFor({ timeout: 15_000 })
    await expect.poll(() => welcome.count(), { timeout: 15_000 }).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
